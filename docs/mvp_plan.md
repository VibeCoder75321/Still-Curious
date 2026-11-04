# Bedtime listening MVP

Current implementation: the private Site now has a Worker API, D1 episode records, and R2 audio storage. Five-minute custom episodes are connected with a 5,000-character voice budget; 15/30/45 minutes below describe the intended later product. Provider secrets and the four voices are configured. A full live custom generation still needs verification.

## The listener's path

The first screen makes one quiet choice clear. **Free episodes** holds recordings that are already ready to play; the current catalog has one five-minute sample. Its player starts immediately, with speed and sleep timer controls. **Create your own** asks only for a question/topic and 15, 30, or 45 minutes. When generation is live, the submit button starts a job, shows plain-language progress, and turns into a player with source notes when the audio is ready. Save the episode so it can be resumed after closing the page. A future subscription may charge one credit, displayed *before* starting; today's prototype has no charging or credit accounting.

Do not place research prose, experimental voice selectors, code, or multiple transcripts on this first screen. Keep source notes available under a disclosure; put detailed evidence in the saved dossier.

## A bounded production crew

These are **stages**, not five independent agents holding long parallel conversations. Use a small capable model for the outline, source dossier, segmented dialogue, and skeptical review, with narrow instructions and persisted outputs. A stronger model can be reserved for a failed quality gate or a hard topic.

| Stage | Job | Saved result | Gate |
| --- | --- | --- | --- |
| Scope/outline | Bound the question, choose three complementary fictional specialist roles, allocate minutes and word budgets | `outline.json` | Lengths add to target; credible scope |
| Research | Search once in a bounded batch, inspect primary studies, reviews, or institutions, distinguish observation from interpretation | `dossier.json` with URLs, source IDs, claim IDs, dates, limits | Every substantive claim has a traceable source; otherwise stop |
| Dialogue | Write one segment at a time with host follow-ups, genuine expert differences, clear examples, and a one-minute opening | `draft.json` with speaker turns and claim IDs | Distinct voices, length within range, references resolve |
| Skeptical review | Check assertions against dossier; return only problematic turns and short replacement text | `review.json` | Unsupported or uncertain points are repaired or omitted |
| Voice and assembly | Convert approved turns to four per-speaker TTS requests, concatenate in order, check duration and file health | `episode.mp3`, transcript, source notes | Playable audio and correct turn order |

The production brief asks for the feel of a serious, welcoming academic seminar with a prepared host, three complementary specialists, evidence and history, directed follow-ups, modest humor, and uncertainty made clear. The dialogue is original; it does not impersonate the BBC, *In Our Time*, Melvyn Bragg, or real interviewees.

Cost controls: cache by normalized topic, length, prompt version, and model; use one research pass; write in bounded sections; revise only flagged turns; assemble speech instructions deterministically; cap calls and output tokens; estimate TTS characters before spending; stop at a budget ceiling. A fixed credit price needs real measurements at all three lengths before launch. Failures before delivery should not consume a user's future credit. Show a clear refusal to invent evidence when a source check fails.

## Production integration

The published Site remains static today. Its custom form is disabled unless `/api/capabilities` declares generation available. A hosted server must own the key-bearing requests, jobs, and storage. On Sites, migrate the existing private project to a Worker app; keep D1 metadata for status/owner and R2 for dossiers and audio. POST `/api/episodes` creates a private job, GET `/api/episodes/:id` reports progress and returns the finished audio URL, and an authenticated audio route streams MP3 with seek support. Run generation in resumable, bounded steps rather than assuming one long HTTP request can make 45 minutes of audio. Keep provider keys in runtime secrets; never put them in client code or the repository. ElevenLabs voice IDs and an API credential are still needed. Test with a short episode, then measure actual research, text, TTS, and storage spend before enabling 30- and 45-minute requests.

Current work is a UX prototype and a local pipeline library. It does not yet generate or charge for custom audio. The five-minute free sample is playable now.
