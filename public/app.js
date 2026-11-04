(() => {
  const $ = id => document.getElementById(id);
  const library = globalThis.STILL_CURIOUS_LIBRARY || [];
  const player = $('now-audio'), nowStatus = $('now-status'), speed = $('playback-speed'), timer = $('sleep-timer');
  const form = $('create-form'), createButton = $('create-button'), createStatus = $('create-status');
  const result = $('custom-result'), resultStatus = $('result-status'), resultState = $('result-state');
  const resumeButton = $('resume-button'), pauseButton = $('pause-button'), cancelButton = $('cancel-button');
  const controlIds = ['resume-button', 'pause-button', 'cancel-button', 'start-episode-button', 'generate-audio-button', 'accept-preview-button', 'archive-button'];
  const STORAGE_KEY = 'still-curious-jobs-v2', SPEED_KEY = 'still-curious-speed-v1';
  // Clear pre-reset browser entries once; subsequent episodes use the fresh cache.
  try { localStorage.removeItem('still-curious-jobs-v1'); } catch (_) { /* Storage is optional. */ }
  const rates = [1.2, 1, 0.9, 0.8, 0.7, 0.6];
  const stageLabels = { outline: 'Shaping the conversation', research: 'Gathering sources', script: 'Writing the script', review: 'Reviewing the episode', tts: 'Recording audio', assembling: 'Putting the episode together', ready: 'Ready to listen', failed: 'Needs attention' };
  let textAvailable = false, podcastAvailable = false, backgroundProcessing = false, selectedPlayback = null;
  let activeJobId = null, currentJob = null, busy = false, controlling = false, submitting = false;
  let pausedForVisibility = false, stopRequested = false, loopFinished = Promise.resolve(), timerId = null;
  const savedJobs = new Map(), archivedJobs = new Map();
  let libraryView = 'free', hiddenJobId = null;
  function storedJobs() { try { const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); return Array.isArray(data) ? data.filter(item => typeof item.id === 'string') : []; } catch (_) { return []; } }
  function saveJob(job) {
    savedJobs.set(job.id, job);
    const jobs = storedJobs().filter(item => item.id !== job.id);
    jobs.unshift({ id: job.id, title: job.title || job.topic || 'Your conversation', overview: job.overview || job.topic || '', lengthMinutes: job.lengthMinutes, status: job.status || 'running' });
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs.slice(0, 50))); } catch (_) { /* Server state remains authoritative. */ }
  }
  function updateSaved(job) { saveJob(job); renderSaved(false); }
  async function api(path, options = {}) {
    const response = await fetch(path, { ...options, headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
    if (!(response.headers.get('content-type') || '').toLowerCase().includes('application/json')) throw new Error('The saved episode needs checking.');
    const body = await response.json();
    if (!response.ok) { const error = new Error(body.error || 'The episode service is unavailable.'); error.status = response.status; throw error; }
    return body;
  }
  const selectedLength = () => $('length-15').checked && !$('length-15').disabled ? 15 : 5;
  function updateCreateMode() {
    const textOnly = textAvailable && $('text-only').checked;
    $('preview-first').disabled = textOnly;
    const blocked = [...savedJobs.values()].some(job => job.status === 'running' || (job.status === 'paused' && (job.pause?.code === 'text_checkpoint' ? job.actions?.cancel : job.pause?.code !== 'cancelled')));
    createButton.disabled = busy || controlling || submitting || blocked || !(textOnly ? textAvailable : podcastAvailable);
    createButton.textContent = blocked ? 'Episode in progress' : `Create ${selectedLength()}-minute ${textOnly ? 'script' : 'episode'}`;
    if (blocked && !form.hidden) createStatus.textContent = 'Open your current episode in Your episodes to continue, or stop and archive it.';
  }
  async function checkCapabilities() {
    try {
      const capability = await api('/api/capabilities');
      backgroundProcessing = capability.background_processing === true;
      const lengths = Array.isArray(capability.supported_lengths) ? capability.supported_lengths : [];
      textAvailable = capability.text_pilot === true && lengths.includes(5);
      podcastAvailable = textAvailable && capability.podcast_generation === true;
      $('length-15').disabled = !textAvailable || !lengths.includes(15);
      $('creation-options').hidden = !textAvailable;
      $('text-only').disabled = textAvailable && !podcastAvailable;
      if (textAvailable && !podcastAvailable) $('text-only').checked = true;
      createStatus.textContent = podcastAvailable ? (backgroundProcessing ? 'You can leave this page. Your episode will keep creating in the background.' : 'Keep this page open while your episode is being created.')
        : textAvailable ? 'Script creation is available. Recording is temporarily unavailable.' : 'Creation is currently unavailable. You can still enjoy the library.';
    } catch (_) { createStatus.textContent = 'Creation is currently unavailable. You can still enjoy the library.'; }
    updateCreateMode();
  }
  function durationLabel(seconds) {
    const total = Math.max(0, Math.round(Number(seconds) || 0)), minutes = Math.floor(total / 60), remainder = total % 60;
    return minutes ? `${minutes} min${remainder ? ` ${remainder} sec` : ''}` : `${remainder} sec`;
  }
  function clearTimer() { if (timerId !== null) clearTimeout(timerId); timerId = null; timer.value = '0'; syncPlayer(); }
  function armTimer() {
    if (timerId !== null) clearTimeout(timerId); timerId = null;
    const minutes = Number(timer.value); syncPlayer();
    if (!minutes) { nowStatus.textContent = 'Sleep timer off.'; return; }
    if (player.paused) { nowStatus.textContent = 'The sleep timer will start when you press play.'; return; }
    nowStatus.textContent = `Sleep timer set for ${minutes} minutes.`;
    timerId = setTimeout(() => { timerId = null; player.pause(); timer.value = '0'; syncPlayer(); nowStatus.textContent = 'Sleep timer finished. Playback has paused.'; }, minutes * 60000);
  }
  function applySpeed() {
    const rate = Number(speed.value);
    if (!rates.includes(rate)) speed.value = '1';
    player.defaultPlaybackRate = Number(speed.value); player.playbackRate = Number(speed.value); syncPlayer();
  }
  function clock(seconds) { const n = Math.max(0, Math.floor(Number(seconds) || 0)); return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`; }
  function syncPlayer() {
    $('mini-title').textContent = selectedPlayback?.title || '';
    $('mini-settings').textContent = `${speed.value || '1'}× · ${Number(timer.value) ? `Timer ${timer.value} min` : 'Timer off'}`;
    $('play-toggle').textContent = player.paused ? '▶' : 'Ⅱ';
    $('play-toggle').setAttribute('aria-label', player.paused ? 'Play' : 'Pause');
    const duration = Number.isFinite(player.duration) ? player.duration : selectedPlayback?.durationSeconds || 0;
    $('elapsed').textContent = clock(player.currentTime); $('total-time').textContent = clock(duration);
    $('seek').disabled = !Number.isFinite(player.duration) || player.duration <= 0;
    $('seek').value = duration > 0 ? String(Math.round((player.currentTime || 0) / duration * 1000)) : '0';
    $('seek').setAttribute('aria-valuetext', `${clock(player.currentTime)} of ${clock(duration)}`);
  }
  function showPlayerDetails(open) {
    $('player-details').hidden = !open; $('expand-player').setAttribute('aria-expanded', String(open));
    if (open) $('now-title').focus?.(); else $('expand-player').focus?.();
  }
  $('expand-player').addEventListener('click', () => showPlayerDetails($('player-details').hidden));
  $('collapse-player').addEventListener('click', () => showPlayerDetails(false));
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('player-details').hidden) showPlayerDetails(false); });
  $('play-toggle').addEventListener('click', () => { if (player.paused) player.play()?.catch(() => { nowStatus.textContent = 'Playback could not start. Try again.'; }); else player.pause(); });
  function seekBy(seconds) { if (Number.isFinite(player.duration) && player.duration > 0) { player.currentTime = Math.min(player.duration, Math.max(0, (player.currentTime || 0) + seconds)); syncPlayer(); } }
  $('skip-back').addEventListener('click', () => seekBy(-15)); $('skip-forward').addEventListener('click', () => seekBy(15));
  $('seek').addEventListener('input', () => { if (Number.isFinite(player.duration) && player.duration > 0) { player.currentTime = Number($('seek').value) / 1000 * player.duration; syncPlayer(); } });
  for (const event of ['play', 'pause', 'ended', 'loadedmetadata', 'timeupdate', 'error']) player.addEventListener(event, syncPlayer);
  function chooseLibrary(view) {
    libraryView = view;
    for (const [key, button, panel] of [['free', 'free-tab', 'free-panel'], ['yours', 'yours-tab', 'saved-panel'], ['archive', 'archive-tab', 'archive-panel']]) {
      $(button).setAttribute('aria-pressed', String(view === key)); $(panel).hidden = view !== key;
    }
    $('archive-tab').hidden = view === 'free';
  }
  $('free-tab').addEventListener('click', () => chooseLibrary('free'));
  $('yours-tab').addEventListener('click', () => { chooseLibrary('yours'); renderSaved(); });
  $('archive-tab').addEventListener('click', () => { chooseLibrary(libraryView === 'archive' ? 'yours' : 'archive'); renderSaved(); });
  $('close-result').addEventListener('click', () => { hiddenJobId = currentJob?.id; result.hidden = true; form.hidden = false; createStatus.hidden = false; });
  $('archive-button').addEventListener('click', () => archiveJob(activeJobId));
  async function archiveJob(id, restore = false) {
    if (!id || controlling || submitting) return;
    stopRequested = true; pausedForVisibility = false; controlling = true; updateCreateMode();
    try {
      await loopFinished;
      const updated = await api(`/api/episodes/${encodeURIComponent(id)}/archive`, { method: 'POST', body: JSON.stringify({ action: restore ? 'restore' : 'archive' }) });
      savedJobs.delete(id); archivedJobs.delete(id);
      if (restore) saveJob(updated); else archivedJobs.set(id, updated);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(storedJobs().filter(job => job.id !== id))); } catch (_) {}
      if (activeJobId === id) { activeJobId = null; currentJob = null; result.hidden = true; form.hidden = false; createStatus.hidden = false; }
      await checkCapabilities();
      $('library-status').textContent = restore ? 'Episode restored. Creation has not restarted.' : 'Archived. Your saved work is preserved.';
      await renderSaved(false);
    } catch (error) { $('library-status').textContent = error.status === 409 ? 'This episode is finishing a step. Try archiving again shortly.' : 'The change could not be confirmed. Refresh Your episodes before trying again.'; }
    finally { controlling = false; updateCreateMode(); }
  }
  function renderArchived() {
    const grid = $('archive-list'); grid.replaceChildren();
    if (!archivedJobs.size) { const empty = document.createElement('p'); empty.className = 'status'; empty.textContent = 'No archived episodes.'; grid.append(empty); }
    for (const job of archivedJobs.values()) grid.append(episodeCard({ title: job.title || job.topic, overview: job.overview || job.topic, durationSeconds: job.durationSeconds || (job.lengthMinutes || 5) * 60 }, { label: 'Archived', buttonLabel: 'Restore', select: () => archiveJob(job.id, true) }));
  }
  try { const saved = localStorage.getItem(SPEED_KEY); if (saved && rates.includes(Number(saved))) speed.value = saved; } catch (_) { /* A preference is optional. */ }
  speed.addEventListener('change', () => { applySpeed(); try { localStorage.setItem(SPEED_KEY, speed.value); } catch (_) {} });
  timer.addEventListener('change', armTimer);
  player.addEventListener('play', () => { nowStatus.textContent = 'Playing.'; if (Number(timer.value) && timerId === null) armTimer(); });
  player.addEventListener('pause', () => { if (nowStatus.textContent === 'Playing.') nowStatus.textContent = 'Paused.'; });
  player.addEventListener('ended', () => { clearTimer(); nowStatus.textContent = 'Finished. Take your time.'; });
  player.addEventListener('error', () => { clearTimer(); nowStatus.textContent = 'This recording could not be loaded. Try selecting it again.'; });
  player.addEventListener('loadedmetadata', () => { applySpeed(); if (Number.isFinite(player.duration) && player.duration > 0) $('now-length').textContent = durationLabel(player.duration); });
  function safeExport(url, id, kind) { return typeof url === 'string' && url === `/api/episodes/${encodeURIComponent(id)}/${kind}` ? url : null; }
  function jobAudio(job) {
    const base = `/api/episodes/${encodeURIComponent(job.id)}/audio`;
    if (job.status === 'ready' && job.audio_url === base) return base;
    return job.audition_url === `${base}?preview=audition` ? job.audition_url : null;
  }
  function readingList(episode) {
    $('reading-list').open = false; $('reading-note').textContent = episode.readingNote || '';
    const links = $('reading-links'); links.replaceChildren();
    for (const source of episode.readingList || []) {
      if (typeof source.url !== 'string' || !/^https?:\/\//i.test(source.url)) continue;
      const item = document.createElement('li'), link = document.createElement('a');
      link.href = source.url; link.textContent = source.title || source.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
      item.append(link); links.append(item);
    }
    $('reading-export').hidden = !episode.readingUrl; $('transcript-link').hidden = !episode.transcriptUrl;
    if (episode.readingUrl) { $('reading-export').href = episode.readingUrl; $('reading-export').setAttribute('download', 'reading-list'); }
    if (episode.transcriptUrl) { $('transcript-link').href = episode.transcriptUrl; $('transcript-link').setAttribute('download', 'transcript'); }
  }
  function selectPlayback(episode, play = true) {
    const changed = selectedPlayback?.key !== episode.key || player.getAttribute('src') !== episode.audioUrl;
    if (changed) { clearTimer(); player.pause(); player.src = episode.audioUrl; player.load(); }
    selectedPlayback = episode;
    $('now-playing').hidden = false; $('now-content').hidden = false; $('now-kind').hidden = false;
    $('now-kind').textContent = episode.kindLabel;
    $('now-episode-title').textContent = episode.title; $('now-overview').textContent = episode.overview;
    $('now-length').textContent = Number(episode.durationSeconds) > 0 ? durationLabel(episode.durationSeconds) : 'Length loading…'; player.setAttribute('aria-label', `Play ${episode.title}`);
    readingList(episode); applySpeed(); nowStatus.textContent = player.paused ? 'Ready to play.' : 'Playing.';
    syncPlayer();
    if (play) {
      const attempt = player.play();
      attempt?.catch(() => { nowStatus.textContent = 'Your episode is selected. Press play when you are ready.'; });
    }
  }
  function selectFree(episode) {
    if (!/^\/audio\/[\w.-]+\.mp3$/.test(episode.audioUrl)) return;
    selectPlayback({ ...episode, key: `free:${episode.id}`, kindLabel: episode.kind === 'excerpt' ? 'Opening excerpt' : episode.kind === 'voice_preview' ? 'Voice preview' : 'Free episode' });
  }
  function selectJob(job, play = true) {
    const audioUrl = jobAudio(job); if (!audioUrl) return;
    const readingUrl = safeExport(job.research_url || job.dossier_url || job.research_dossier_url, job.id, 'research');
    selectPlayback({ key: `job:${job.id}:${audioUrl}`, title: job.title || job.topic || 'Your conversation', overview: job.overview || job.topic || 'A conversation made for you.',
      durationSeconds: audioUrl.includes('?') ? job.auditionDurationSeconds || 0 : job.durationSeconds || job.lengthMinutes * 60,
      audioUrl, kindLabel: audioUrl.includes('?') ? 'Voice preview' : 'Your episode', readingList: job.sources || [],
      readingUrl, transcriptUrl: safeExport(job.transcript_url, job.id, 'transcript'),
      readingNote: (job.sources || []).length ? '' : readingUrl ? 'The full Reading List is available with the saved research below.' : 'A Reading List is not available for this recording yet.' }, play);
  }
  function episodeCard(episode, options) {
    const card = document.createElement('article'); card.className = 'episode-card';
    if (options.cover) { const cover = document.createElement('div'); cover.className = `episode-cover ${episode.theme || ''}`; cover.setAttribute('aria-hidden', 'true'); const category = document.createElement('span'); category.className = 'cover-category'; category.textContent = episode.category || 'A conversation for the curious'; cover.append(category); card.append(cover); }
    const body = document.createElement('div'); body.className = 'episode-body';
    const title = document.createElement('h3'); title.className = 'episode-title'; title.textContent = episode.title;
    const overview = document.createElement('p'); overview.className = 'episode-overview'; overview.textContent = episode.overview;
    const bottom = document.createElement('div'); bottom.className = 'episode-bottom';
    const meta = document.createElement('div'), length = document.createElement('p'); length.className = 'episode-length'; length.textContent = durationLabel(episode.durationSeconds); meta.append(length);
    if (options.label) { const label = document.createElement('span'); label.className = 'tile-kind'; label.textContent = options.label; meta.append(label); }
    const listen = document.createElement('button'); listen.type = 'button'; listen.className = 'listen-button'; listen.textContent = options.buttonLabel || 'Play'; listen.setAttribute('aria-label', `${listen.textContent}: ${episode.title}`); listen.addEventListener('click', options.select);
    bottom.append(meta, listen); body.append(title, overview, bottom);
    if (options.secondary) { const extra = document.createElement('div'); extra.className = 'episode-secondary'; const action = document.createElement('button'); action.type = 'button'; action.className = 'text-button'; action.textContent = options.secondary.label; action.addEventListener('click', options.secondary.action); extra.append(action); body.append(extra); }
    card.append(body); return card;
  }
  function renderLibrary() {
    const grid = $('library-grid'); grid.replaceChildren();
    for (const episode of library.filter(item => item.kind !== 'voice_preview')) grid.append(episodeCard(episode, { cover: true, label: episode.kind === 'excerpt' ? 'Opening excerpt' : 'Free episode', select: () => selectFree(episode) }));
  }
  $('voice-preview-button').addEventListener('click', () => { const episode = library.find(item => item.kind === 'voice_preview'); if (episode) selectFree(episode); });
  function presentJob(job) {
    activeJobId = job.id; currentJob = job; result.hidden = hiddenJobId === job.id;
    $('result-title').textContent = job.title || job.topic || 'Your conversation';
    const textReady = job.pipelineVersion === 2 && job.textReady === true, playable = jobAudio(job);
    resultState.textContent = textReady ? 'Script ready' : job.status === 'paused' ? (job.pause?.code === 'cancelled' ? 'Stopped' : job.pause?.code === 'user_paused' ? 'Paused by you' : 'Needs attention') : job.status === 'ready' ? 'Ready to listen' : job.status === 'failed' ? 'Needs attention' : 'Creating';
    $('progress').hidden = true; $('progress-label').hidden = job.status !== 'running';
    $('progress-label').textContent = ({ commission: 'Shaping your episode', research: 'Finding and reading sources', casting: 'Choosing the specialists', preparation: 'Preparing the conversation', conversation: 'Building the conversation', editing: 'Editing the conversation', review: 'Reviewing the episode', tts: 'Recording your episode', assembling: 'Finishing your recording' })[job.stage] || 'Creating your episode';
    form.hidden = !result.hidden && (job.status === 'running' || (job.status === 'paused' && job.pause?.code !== 'cancelled' && !textReady));
    createStatus.hidden = form.hidden;
    $('archive-button').hidden = !!job.archivedAt || !!job.actions?.cancel;
    resumeButton.hidden = !job.actions?.resume; pauseButton.hidden = !job.actions?.pause; cancelButton.hidden = !job.actions?.cancel;
    $('start-episode-button').hidden = !job.actions?.start; $('generate-audio-button').hidden = !job.actions?.authorizeAudio;
    $('accept-preview-button').hidden = !job.actions?.acceptAudition; $('job-listen-button').hidden = !playable;
    if (job.status === 'ready' && playable) {
      resultStatus.textContent = 'Your episode is ready to listen to.';
      if (!selectedPlayback) selectJob(job, false);
    } else if (playable) resultStatus.textContent = 'Your voice preview is ready. Listen, then continue the recording when you are happy with it.';
    else if (textReady) resultStatus.textContent = job.audioAvailable === false ? 'Your reviewed script is ready. Recording is temporarily unavailable.' : 'Your reviewed script is ready. You can read it or record the conversation.';
    else if (job.status === 'paused') resultStatus.textContent = job.pause?.code === 'budget' ? 'This episode reached its creation allowance. You can keep the saved work or archive it.' : job.pause?.reason || 'This episode is paused.';
    else if (job.status === 'failed') resultStatus.textContent = 'This episode could not be completed. Your saved work is preserved.';
    else resultStatus.textContent = backgroundProcessing ? 'Creating your conversation in the background. You can return to Your episodes later.' : 'Creating your conversation. Keep this page open to continue.';
    const transcript = safeExport(job.transcript_url, job.id, 'transcript'), research = safeExport(job.research_url || job.dossier_url, job.id, 'research');
    $('result-transcript').hidden = !transcript; $('result-reading-list').hidden = !research;
    if (transcript) $('result-transcript').href = transcript;
    if (research) $('result-reading-list').href = research;
    updateSaved(job); updateCreateMode();
  }
  async function getJob(id) { return api(`/api/episodes/${encodeURIComponent(id)}`); }
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function runJob(id) {
    if (busy || controlling) return;
    stopRequested = false; pausedForVisibility = false; busy = true; updateCreateMode();
    let finishLoop; loopFinished = new Promise(resolve => { finishLoop = resolve; });
    try {
      let job = await getJob(id); presentJob(job);
      while (job.status === 'running' && !document.hidden && !stopRequested) {
        saveJob(job);
        try { if (!backgroundProcessing) await api(`/api/episodes/${encodeURIComponent(id)}/advance`, { method: 'POST', body: '{}' }); job = await getJob(id); presentJob(job); }
        catch (_) { const refreshed = await getJob(id).catch(() => null); if (refreshed) presentJob(refreshed); resultStatus.textContent = backgroundProcessing ? 'Progress could not be refreshed. Background creation may still be running; reopen Your episodes to check.' : 'Progress could not be refreshed. Reopen this episode to check its saved state.'; return; }
        if (job.status === 'running' && !stopRequested) await pause(2000);
      }
      if (job.status === 'running' && document.hidden && !stopRequested) { pausedForVisibility = true; resultStatus.textContent = backgroundProcessing ? 'Creation continues in the background. Return to see its progress.' : 'Creation is waiting while this page is in the background. It will continue when you return.'; }
    } catch (_) { result.hidden = false; resultState.textContent = 'Needs attention'; resultStatus.textContent = 'Open the saved episode to check its progress before continuing.'; }
    finally { busy = false; updateCreateMode(); finishLoop(); }
  }
  async function controlJob(action) {
    if (!activeJobId || controlling) return;
    const id = activeJobId; stopRequested = true; pausedForVisibility = false; controlling = true; updateCreateMode();
    for (const control of controlIds) $(control).disabled = true;
    let continueRunning = false;
    try {
      await loopFinished;
      const latest = await getJob(id); presentJob(latest);
      const allowed = { pause: 'pause', resume: 'resume', cancel: 'cancel', set_budget: 'start', authorize_audio: 'authorizeAudio', accept_audition: 'acceptAudition' };
      if (latest.pipelineVersion !== 2 || !latest.actions?.[allowed[action]]) return;
      const body = { action, ...(action === 'authorize_audio' ? { auditionFirst: $('preview-first').checked } : {}) };
      const updated = await api(`/api/episodes/${encodeURIComponent(id)}/control`, { method: 'POST', body: JSON.stringify(body) });
      presentJob(updated); continueRunning = updated.status === 'running' && ['resume', 'set_budget', 'authorize_audio', 'accept_audition'].includes(action);
    } catch (_) { const latest = await getJob(id).catch(() => null); if (latest) presentJob(latest); resultStatus.textContent = 'Creation could not continue. Your saved progress is safe; check the available controls before trying again.'; }
    finally { controlling = false; for (const control of controlIds) $(control).disabled = false; updateCreateMode(); }
    if (continueRunning) await runJob(id);
  }
  async function openSaved(id) {
    if (busy || controlling || submitting) return;
    try { hiddenJobId = null; const job = await getJob(id); presentJob(job); if (job.status === 'running' && backgroundProcessing) await runJob(id); } catch (_) { result.hidden = false; resultStatus.textContent = 'This saved episode could not be loaded. Try again later.'; }
  }
  async function renderSaved(fetchRemote = true) {
    if (fetchRemote) { try {
      const response = await api('/api/episodes');
      const archived = new Set(Array.isArray(response.archivedEpisodeIds) ? response.archivedEpisodeIds : []);
      for (const id of archived) savedJobs.delete(id);
      archivedJobs.clear(); for (const job of response.archivedEpisodes || []) archivedJobs.set(job.id, job);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(storedJobs().filter(job => !archived.has(job.id)))); } catch (_) {}
      for (const job of Array.isArray(response.episodes) ? response.episodes : []) if (!archived.has(job.id)) savedJobs.set(job.id, job);
    } catch (_) {} }
    renderArchived();
    const grid = $('saved-list'); grid.replaceChildren();
    const episodes = [...savedJobs.values()], knownIds = new Set(episodes.map(item => item.id));
    for (const local of storedJobs()) if (!knownIds.has(local.id)) episodes.push(local);
    updateCreateMode();
    if (!episodes.length) { const empty = document.createElement('p'); empty.className = 'status'; empty.textContent = 'Your own conversations will appear here.'; grid.append(empty); return; }
    for (const job of episodes) {
      const playable = job.status === 'ready' && !!jobAudio(job);
      const label = job.textReady ? 'Script ready' : playable ? 'Ready to listen' : job.status === 'paused' ? (job.pause?.code === 'cancelled' ? 'Stopped' : job.pause?.code === 'user_paused' ? 'Paused by you' : 'Needs attention') : job.status === 'failed' ? 'Needs attention' : 'Creating';
      grid.append(episodeCard({ title: job.title || job.topic || 'Your conversation', overview: job.overview || job.topic || 'A conversation made for you.', durationSeconds: job.durationSeconds || (job.lengthMinutes || 5) * 60 },
        { label, buttonLabel: playable ? 'Play' : 'View details', select: () => playable ? selectJob(job) : openSaved(job.id), secondary: { label: job.status === 'running' || job.actions?.cancel ? 'Stop and archive' : 'Archive', action: () => archiveJob(job.id) } }));
    }
  }
  form.addEventListener('submit', async event => {
    event.preventDefault(); const textOnly = textAvailable && $('text-only').checked;
    if (busy || controlling || submitting || !(textOnly ? textAvailable : podcastAvailable)) return;
    const topic = $('topic').value.trim(); if (!topic) return;
    submitting = true; hiddenJobId = null; updateCreateMode(); result.hidden = false; form.hidden = true; createStatus.hidden = true; resultStatus.textContent = 'Starting your conversation…';
    const request = { topic, lengthMinutes: selectedLength(), pipelineVersion: 2, textOnly, ...(!textOnly ? { auditionFirst: $('preview-first').checked } : {}) };
    try { const created = await api('/api/episodes', { method: 'POST', body: JSON.stringify(request) }); if (!created.id) throw new Error(); presentJob(created); submitting = false; updateCreateMode(); if (created.status === 'running') await runJob(created.id); }
    catch (error) { form.hidden = false; createStatus.hidden = false; resultState.textContent = 'Needs attention'; resultStatus.textContent = error.status >= 400 && error.status < 500 ? error.message : 'The request was not confirmed. Check Your episodes before starting it again.'; await renderSaved(); }
    finally { submitting = false; updateCreateMode(); }
  });
  resumeButton.addEventListener('click', () => controlJob('resume')); pauseButton.addEventListener('click', () => controlJob('pause')); cancelButton.addEventListener('click', () => archiveJob(activeJobId));
  $('start-episode-button').addEventListener('click', () => controlJob('set_budget'));
  $('generate-audio-button').addEventListener('click', () => controlJob('authorize_audio'));
  $('accept-preview-button').addEventListener('click', () => controlJob('accept_audition'));
  $('job-listen-button').addEventListener('click', () => { if (currentJob) selectJob(currentJob); });
  $('text-only').addEventListener('change', updateCreateMode); $('length-5').addEventListener('change', updateCreateMode); $('length-15').addEventListener('change', updateCreateMode);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && pausedForVisibility && activeJobId && !busy && !controlling && !stopRequested) runJob(activeJobId); });
  renderLibrary(); checkCapabilities(); renderSaved();
})();
