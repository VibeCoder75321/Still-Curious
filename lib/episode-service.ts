/* eslint-disable @typescript-eslint/no-explicit-any */
import { concatenateMp3, validateMp3 } from "./mp3.ts";
import { buildDialogueChunks, type DialogueChunk } from "./dialogue.ts";

type Turn = { id: string; speaker: "host"|"expert1"|"expert2"|"expert3"; text: string; factual: boolean; claim_ids: string[]; delivery?: string };
type Source = { id: string; title: string; url: string; accessed_on: string; locator: string };
type Claim = { id: string; statement: string; source_ids: string[] };
type Job = { id: string; userId: string; topic: string; title?: string; lengthMinutes: number; status: string; stage: string; progress?: any; state: any; audioKey?: string; audio?: any; createdAt: string | number; updatedAt: string | number; error?: string };
type DialoguePlan = { model: string; voices: Record<Turn["speaker"], string>; scriptHash: string; chunks: DialogueChunk[] };
type Env = { OPENAI_API_KEY?: string; ELEVENLABS_API_KEY?: string; OPENAI_MODEL?: string; OPENAI_SCRIPT_MODEL?: string; ELEVEN_MODEL?: string; ELEVEN_DIALOGUE_MODEL?: string; BUCKET?: {put(key: string, value: ArrayBuffer|Uint8Array|string, options?: any): Promise<any>; get(key: string): Promise<{arrayBuffer(): Promise<ArrayBuffer>}|null>}; ELEVEN_VOICE_HOST?: string; ELEVEN_VOICE_EXPERT1?: string; ELEVEN_VOICE_EXPERT2?: string; ELEVEN_VOICE_EXPERT3?: string };

const MAX_OPENAI_CALLS = 10, MAX_TTS_CHARS = 5000, MIN_TURNS = 8, MAX_TURNS = 36, WORD_MIN = 550, WORD_MAX = 700;
const OPENAI_TIMEOUT = 45_000, ELEVEN_TIMEOUT = 45_000, ELEVEN_DIALOGUE_TIMEOUT = 90_000;
const now = () => new Date().toISOString();
const wordCount = (s: string) => (s.match(/[\p{L}\p{N}’'-]+/gu) || []).length;
const json = (v: unknown) => JSON.stringify(v, null, 2);

type ProviderFailure = { provider: "openai" | "elevenlabs"; status: number; code?: string; requestId?: string };
type ErrorAction = { label: string; url: string };
class PipelineError extends Error {
  ambiguous = false;
  providerError?: ProviderFailure;
  errorAction?: ErrorAction;
  constructor(message: string, ambiguous = false) { super(message); this.ambiguous = ambiguous; }
}

async function openaiFailure(res: Response): Promise<PipelineError> {
  // Provider messages can echo input or credentials. Persist only known codes and
  // a request ID, and supply our own actionable copy instead of the raw body.
  let data: any = {};
  try { data = await res.json(); } catch { /* HTTP status remains useful. */ }
  const known = new Set(["credit_balance_exhausted", "insufficient_quota", "organization_spend_limit_exceeded", "project_spend_limit_exceeded", "organization_usage_limit_exceeded", "usage_limit_exceeded", "rate_limit_exceeded", "slow_down", "invalid_api_key", "model_not_found", "server_is_overloaded", "server_error"]);
  const code = known.has(data?.error?.code) ? data.error.code
    : data?.error?.type === "insufficient_quota" ? "insufficient_quota" : undefined;
  const billing = { label: "Open API billing", url: "https://platform.openai.com/settings/organization/billing" };
  const limits = { label: "Open API limits", url: "https://platform.openai.com/settings/organization/limits" };
  let message = `OpenAI could not complete this step (HTTP ${res.status}).`;
  let action: ErrorAction | undefined;
  if (code === "credit_balance_exhausted") {
    message = "The OpenAI API account has no credits. Add API credits, then create this episode again.";
    action = billing;
  } else if (["organization_spend_limit_exceeded", "project_spend_limit_exceeded", "organization_usage_limit_exceeded"].includes(code || "")) {
    message = "The OpenAI API account reached a spending or usage limit. Check its limits before creating this episode again.";
    action = limits;
  } else if (code === "insufficient_quota" || code === "usage_limit_exceeded") {
    message = "OpenAI API credits or usage limits need attention. Check API billing before creating this episode again.";
    action = billing;
  } else if (code === "rate_limit_exceeded" || code === "slow_down") {
    message = "OpenAI is temporarily limiting requests. Wait a little before creating this episode again.";
  } else if (res.status === 429) {
    message = "OpenAI could not accept this request. Check API credits and limits before trying again.";
    action = billing;
  } else if (res.status === 401 || code === "invalid_api_key") {
    message = "OpenAI API authentication needs attention. The app owner needs to check its configured key.";
  } else if (res.status === 403 || code === "model_not_found") {
    message = "The configured OpenAI model is unavailable to this project. The app owner needs to check model access.";
  } else if (res.status === 400) {
    message = "OpenAI rejected the generation settings. The app needs a configuration fix.";
  } else if (res.status >= 500) {
    message = "OpenAI could not complete this step. It was not retried because the request may have been processed.";
  }
  const error = new PipelineError(message, res.status >= 500);
  const requestId = res.headers.get("x-request-id");
  error.providerError = { provider: "openai", status: res.status, ...(code ? { code } : {}), ...(requestId && /^req_[a-zA-Z0-9_-]{1,100}$/.test(requestId) ? { requestId } : {}) };
  error.errorAction = action;
  return error;
}

async function timedFetch(url: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), ms);
  try { return await fetch(url, { ...init, signal: controller.signal }); }
  catch { throw new PipelineError("Provider request failed or timed out; it was not retried", true); }
  finally { clearTimeout(timer); }
}

function extractText(data: any): string {
  if (typeof data.output_text === "string") return data.output_text;
  return (data.output || []).flatMap((item: any) => item.content || []).filter((c: any) => c.type === "output_text").map((c: any) => c.text).join("\n");
}

function parseStructuredText(text: string): any {
  const trimmed = text.trim();
  // Accept an enclosing Markdown fence from older saved/provider responses.
  // Never guess at braces inside prose or repair incomplete JSON.
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/i.exec(trimmed);
  try { return JSON.parse(fenced ? fenced[1] : trimmed); }
  catch { throw new PipelineError("The research or writing response had an unreadable format. No audio was generated."); }
}

async function openai(env: Env, prompt: string, opts: { model?: string; research?: boolean; schemaName?: string; schema?: any; maxTokens?: number } = {}): Promise<any> {
  if (!env.OPENAI_API_KEY) throw new PipelineError("OpenAI is not configured");
  const body: any = { model: opts.model || env.OPENAI_MODEL || "gpt-4.1-mini", input: prompt, max_output_tokens: opts.maxTokens || 6000 };
  if (opts.research) {
    body.tools = [{ type: "web_search", search_context_size: "medium" }];
    body.tool_choice = "required";
    body.max_tool_calls = 1;
    body.include = ["web_search_call.action.sources"];
  }
  if (opts.schema) {
    body.text = { format: { type: "json_schema", name: opts.schemaName || "episode_stage", strict: true, schema: opts.schema } };
  }
  const res = await timedFetch("https://api.openai.com/v1/responses", { method: "POST", headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }, OPENAI_TIMEOUT);
  if (!res.ok) throw await openaiFailure(res);
  let data: any; try { data = await res.json(); } catch { throw new PipelineError("OpenAI returned unreadable data", true); }
  if (data.status && data.status !== "completed") throw new PipelineError("OpenAI stopped before completing this step. No audio was generated.");
  if ((data.output || []).some((item: any) => (item.content || []).some((c: any) => c.type === "refusal"))) throw new PipelineError("OpenAI could not produce a response for this topic. Try a broader question.");
  const text = extractText(data);
  if (!text) throw new PipelineError("OpenAI returned no usable content");
  return { value: parseStructuredText(text), raw: data };
}

const schema = (properties: any, required = Object.keys(properties)) => ({ type: "object", additionalProperties: false, properties, required });
const str = { type: "string" };
const outlineSchema = schema({ title: str, premise: str, segments: { type: "array", items: schema({ title: str, minutes: { type: "number" }, focus: str }) } });
const researchSourceId = { type: "string", enum: ["s1", "s2", "s3"] };
const researchSchema = schema({ sources: { type: "array", minItems: 3, maxItems: 3, items: schema({ id: researchSourceId, title: str, url: str, locator: str }) }, findings: { type: "array", minItems: 5, items: schema({ id: str, claim: str, source_ids: { type: "array", minItems: 1, items: researchSourceId }, uncertainty: str }) }, limitations: { type: "array", items: str } });
function scriptSchema(claims: Claim[]) {
  const claimId = claims.length ? { type: "string", enum: claims.map(c => c.id) } : str;
  const turn = (factual: boolean) => schema({ id: str, speaker: { type: "string", enum: ["host", "expert1", "expert2", "expert3"] }, text: str, factual: { type: "boolean", enum: [factual] }, claim_ids: { type: "array", minItems: factual ? 1 : 0, items: claimId }, delivery: { type: "string", enum: ["conversational", "settling"] } });
  return schema({ guest_introductions: { type: "array", minItems: 3, maxItems: 3, items: schema({ speaker: { type: "string", enum: ["expert1", "expert2", "expert3"] }, name: str, expertise: str }) }, turns: { type: "array", minItems: MIN_TURNS, maxItems: MAX_TURNS, items: { anyOf: [turn(true), turn(false)] } } });
}

function normalizeWriting(value: any) {
  if (!value.opening) return value; // New scripts use text; retain older word-array drafts.
  const normalize = (t: any) => {
    if (!Array.isArray(t.text_words) || t.text_words.some((word: unknown) => typeof word !== "string" || !word.trim() || /\s/.test(word))) throw new PipelineError("Script word format is invalid");
    const { text_words, ...turn } = t;
    return { ...turn, text: text_words.join(" ") };
  };
  return { guest_introductions: value.guest_introductions, turns: [normalize(value.opening), ...value.turns.map(normalize)] };
}

const reviewSchema = schema({ flags: { type: "array", items: schema({ turn_id: str, issue: str, replacement_text: str }) }, unresolved: { type: "array", items: str } });

const DIALOGUE_STYLE = `Make the conversation personable, composed, and quietly absorbing for a curious adult settling into bed. These are thoughtful people interested in the subject and in what each other says.
Give the three specialists complementary expertise and individual conversational habits suited to this topic: concrete examples and storytelling, precise mechanisms and helpful qualifications, and the history or experimental evidence. Let these habits overlap; avoid caricatures, catchphrases, and interchangeable mini-lectures.
When the dossier supports it, let a guest tell one compact story around an observation, experiment, or historical puzzle: what was puzzling, what someone tried or noticed, what changed, and why that matters. Use a concrete detail already present in the research, not an invented scene, quotation, biography, or firsthand research experience. If the dossier lacks a supported anecdote, use a clearly framed thought experiment that adds no unsupported scientific claims.
Let the host follow the actual previous answer, ask for a term to be explained, or pause on an intriguing detail. Use short, purposeful questions. Let guests respond to each other's reasoning, qualify an analogy, and occasionally reformulate a thought. Differences should concern evidence or interpretation, never manufactured disagreement about an established fact.
Use natural contractions, individual rhythms, restrained warmth, and occasional dry humor arising from the subject. Express wonder through specific details. Avoid generic praise after every answer, repetitive agreement, forced jokes, promotional language, and routine summaries.
Vary contribution lengths freely. A brief interjection or clarification can be only a few words; a useful story or difficult explanation can occupy a sustained turn. Do not rotate speakers mechanically or allocate equal word counts to each answer. Let the next question restore momentum after a longer explanation.`;

function sourceIdentity(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    // Search adds attribution parameters that the model may omit. Those do not
    // identify a different document; preserve every substantive query parameter.
    for (const key of [...url.searchParams.keys()]) if (/^utm_/i.test(key)) url.searchParams.delete(key);
    url.hash = "";
    return url.toString();
  } catch { return null; }
}

function getSourcesFromResponse(raw: any, dossier: any): Source[] {
  const found: any[] = [];
  for (const item of raw.output || []) if (item.type === "web_search_call") {
    const sources = item.action?.sources || item.sources || [];
    for (const s of sources) found.push(s);
  }
  // Citation metadata can also be attached to output text annotations.
  for (const item of raw.output || []) for (const c of item.content || []) for (const a of c.annotations || []) if (a.type === "url_citation") found.push({ url: a.url, title: a.title });
  const unique = new Map<string, any>();
  for (const s of found) { const key = sourceIdentity(s.url); if (key) unique.set(key, s); }
  const sourceList = dossier.sources;
  if (!Array.isArray(sourceList) || sourceList.length < 3) throw new PipelineError("Research did not produce three source citations");
  const sourceIds = sourceList.map((s: any) => s?.id);
  if (sourceIds.some((id: unknown) => typeof id !== "string" || !id.trim()) || new Set(sourceIds).size !== sourceIds.length) throw new PipelineError("Research sources need unique non-empty IDs");
  if (new Set(sourceList.map((s: any) => sourceIdentity(s?.url))).size < 3) throw new PipelineError("Research needs three distinct source documents");
  const allowed = new Map([...unique.entries()]);
  return sourceList.map((s: any) => {
    const key = sourceIdentity(s?.url);
    if (!s || typeof s.id !== "string" || !key || !allowed.has(key)) throw new PipelineError("Research dossier included a source URL not returned by web search");
    const actual = allowed.get(key);
    return { id: s.id, title: String(actual.title || s.title || "Source").slice(0, 240), url: key, accessed_on: now().slice(0,10), locator: String(s.locator || "Web search result").slice(0,300) };
  });
}

function validateDossier(d: any, sources: Source[]) {
  if (!Array.isArray(d.findings) || d.findings.length < 5) throw new PipelineError("Research dossier has too few findings");
  const src = new Set(sources.map(s=>s.id)); const claimIds = new Set<string>();
  const claims: Claim[] = d.findings.map((f: any) => {
    if (!f || typeof f.id !== "string" || claimIds.has(f.id) || typeof f.claim !== "string" || !Array.isArray(f.source_ids) || !f.source_ids.length) throw new PipelineError("Research finding is missing a claim or citation");
    claimIds.add(f.id); if (f.source_ids.some((id: string)=>!src.has(id))) throw new PipelineError("Research finding refers to a missing source");
    return { id: f.id, statement: f.claim, source_ids: f.source_ids };
  });
  return claims;
}

function validateScript(turns: any[], claims: Claim[], guestIntroductions: any[]) {
  if (!Array.isArray(turns) || turns.length < MIN_TURNS || turns.length > MAX_TURNS) throw new PipelineError(`Script must contain ${MIN_TURNS}–${MAX_TURNS} dialogue turns`);
  const ids = new Set<string>(), claimSet = new Set(claims.map(c=>c.id));
  for (const t of turns) {
    if (!t || typeof t.id !== "string" || !/^[a-z][a-z0-9_-]{0,63}$/.test(t.id) || ids.has(t.id) || !["host","expert1","expert2","expert3"].includes(t.speaker) || typeof t.text !== "string" || !t.text.trim() || typeof t.factual !== "boolean" || !Array.isArray(t.claim_ids)) throw new PipelineError("Script turn failed runtime validation");
    ids.add(t.id); if (t.claim_ids.some((id: string)=>!claimSet.has(id))) throw new PipelineError("Script turn refers to an unknown research claim");
    if (t.factual && !t.claim_ids.length) throw new PipelineError("Every factual script turn must cite at least one dossier claim");
  }
  if (turns[0].speaker !== "host") throw new PipelineError("The opening must be spoken by the host");
  const all = turns.map((t:any)=>t.text).join(" "); const words = wordCount(all);
  if (words < WORD_MIN || words > WORD_MAX) throw new PipelineError(`Script is ${words} words; the five-minute range is ${WORD_MIN}–${WORD_MAX} words`);
  if (wordCount(turns[0].text) < 110 || wordCount(turns[0].text) > 150) throw new PipelineError("Opening turn must be 110–150 words, approximately one minute");
  if (new Set(turns.map(t=>t.speaker)).size < 4) throw new PipelineError("All four fictional speakers must contribute");
  if (!Array.isArray(guestIntroductions) || guestIntroductions.length !== 3 || new Set(guestIntroductions.map(g=>g.speaker)).size !== 3) throw new PipelineError("Script must define three distinct fictional experts");
  const opening = turns[0].text.toLocaleLowerCase();
  for (const guest of guestIntroductions) {
    if (!guest || !["expert1","expert2","expert3"].includes(guest.speaker) || typeof guest.name !== "string" || !guest.name.trim() || typeof guest.expertise !== "string" || !guest.expertise.trim() || !opening.includes(guest.name.toLocaleLowerCase())) throw new PipelineError("One-minute opening must introduce all three fictional experts by name and expertise");
  }
  const chars = turns.reduce((n,t)=>n+t.text.length,0); if (chars > MAX_TTS_CHARS) throw new PipelineError("Script exceeds the 5,000-character voice budget");
  return { words, chars };
}

function voice(env: Env, speaker: string) {
  const v: any = { host: env.ELEVEN_VOICE_HOST, expert1: env.ELEVEN_VOICE_EXPERT1, expert2: env.ELEVEN_VOICE_EXPERT2, expert3: env.ELEVEN_VOICE_EXPERT3 };
  if (!v[speaker]) throw new PipelineError(`Voice is not configured for ${speaker}`); return v[speaker];
}
const VOICE_ENV: Record<Turn["speaker"], keyof Env> = {
  host: "ELEVEN_VOICE_HOST", expert1: "ELEVEN_VOICE_EXPERT1", expert2: "ELEVEN_VOICE_EXPERT2", expert3: "ELEVEN_VOICE_EXPERT3",
};
async function scriptHash(turns: Turn[]): Promise<string> {
  return sha256(new TextEncoder().encode(JSON.stringify(turns)));
}
async function createDialoguePlan(env: Env, turns: Turn[]): Promise<DialoguePlan> {
  const voices = Object.fromEntries((Object.keys(VOICE_ENV) as Turn["speaker"][]).map(speaker => [speaker, voice(env, speaker)])) as DialoguePlan["voices"];
  return { model: env.ELEVEN_DIALOGUE_MODEL || "eleven_v4", voices, scriptHash: await scriptHash(turns), chunks: buildDialogueChunks(turns) };
}
async function verifyDialoguePlan(plan: DialoguePlan, turns: Turn[]) {
  if (!plan || typeof plan.model !== "string" || !plan.model || !plan.voices || !Array.isArray(plan.chunks)) throw new PipelineError("Saved conversation audio plan is invalid");
  if (plan.scriptHash !== await scriptHash(turns)) throw new PipelineError("Reviewed script changed after the audio plan was saved");
  const expected = buildDialogueChunks(turns);
  if (JSON.stringify(expected) !== JSON.stringify(plan.chunks)) throw new PipelineError("Saved conversation sections do not match the reviewed script");
  for (const speaker of Object.keys(VOICE_ENV) as Turn["speaker"][]) if (typeof plan.voices[speaker] !== "string" || !plan.voices[speaker]) throw new PipelineError("Saved conversation voice settings are invalid");
}
function safeId(id: string) { return id.replace(/[^a-zA-Z0-9_-]/g, "_"); }
function bucket(env: Env) { if (!env.BUCKET) throw new PipelineError("Episode storage is not configured"); return env.BUCKET; }

async function synth(env: Env, turn: Turn): Promise<Uint8Array> {
  if (!env.ELEVENLABS_API_KEY) throw new PipelineError("ElevenLabs is not configured");
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice(env, turn.speaker))}?output_format=mp3_44100_128`;
  const res = await timedFetch(url, { method: "POST", headers: { "xi-api-key": env.ELEVENLABS_API_KEY, "Content-Type": "application/json", Accept: "audio/mpeg" }, body: JSON.stringify({ text: turn.text, model_id: env.ELEVEN_MODEL || "eleven_multilingual_v2" }) }, ELEVEN_TIMEOUT);
  if (!res.ok) throw new PipelineError(`Speech request failed (${res.status})`, res.status >= 500);
  return new Uint8Array(await res.arrayBuffer());
}

function safeProviderRequestId(value: string | null) {
  return value && /^[A-Za-z0-9_-]{1,120}$/.test(value) ? value : undefined;
}
async function dialogueFailure(res: Response): Promise<PipelineError> {
  let data: any = {};
  try { data = await res.json(); } catch { /* Keep only status and safe headers. */ }
  const known = new Set(["quota_exceeded", "insufficient_quota", "payment_required", "invalid_api_key", "authentication_error", "rate_limit_exceeded", "too_many_requests"]);
  const code = known.has(data?.detail?.status) ? data.detail.status : known.has(data?.error?.code) ? data.error.code : undefined;
  let message = `Conversation speech request failed (HTTP ${res.status}).`;
  if (res.status === 401 || code === "invalid_api_key" || code === "authentication_error") message = "ElevenLabs API authentication needs attention. The app owner needs to check its configured key.";
  else if (res.status === 402 || code === "quota_exceeded" || code === "insufficient_quota" || code === "payment_required") message = "The ElevenLabs account has reached its plan or credit limit. Check its plan and usage before continuing.";
  else if (res.status === 429 || code === "rate_limit_exceeded" || code === "too_many_requests") message = "ElevenLabs is temporarily limiting requests. This section was not retried. Wait a little before trying again.";
  else if (res.status >= 500) message = "ElevenLabs could not complete this section. It was not retried because the request may have been processed.";
  const error = new PipelineError(message, res.status >= 500 || res.status === 408);
  const requestId = safeProviderRequestId(res.headers.get("request-id") || res.headers.get("x-request-id"));
  error.providerError = { provider: "elevenlabs", status: res.status, ...(code ? { code } : {}), ...(requestId ? { requestId } : {}) };
  return error;
}

async function synthDialogue(env: Env, plan: DialoguePlan, chunk: DialogueChunk, previousRequestIds: string[]) {
  if (!env.ELEVENLABS_API_KEY) throw new PipelineError("ElevenLabs is not configured");
  const body: any = {
    model_id: plan.model,
    inputs: chunk.inputs.map(input => ({ text: input.text, voice_id: plan.voices[input.speaker] })),
  };
  if (previousRequestIds.length) body.previous_request_ids = previousRequestIds.slice(-3);
  else if (chunk.previousText) body.previous_text = chunk.previousText;
  if (chunk.futureText) body.future_text = chunk.futureText;
  const res = await timedFetch("https://api.elevenlabs.io/v1/text-to-dialogue?output_format=mp3_44100_128", {
    method: "POST",
    headers: { "xi-api-key": env.ELEVENLABS_API_KEY, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify(body),
  }, ELEVEN_DIALOGUE_TIMEOUT);
  if (!res.ok) throw await dialogueFailure(res);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const rawCharged = res.headers.get("character-cost") ?? res.headers.get("x-character-count");
  const chargedCharacters = rawCharged !== null && /^\d+$/.test(rawCharged) ? Number(rawCharged) : undefined;
  return { bytes, requestId: safeProviderRequestId(res.headers.get("request-id") || res.headers.get("x-request-id")), chargedCharacters };
}

function fail(job: Job, error: unknown): Job {
  job.status = "failed"; job.stage = "failed"; job.error = error instanceof PipelineError ? error.message : "Episode generation could not continue";
  (job as any).errorAmbiguous = error instanceof PipelineError && error.ambiguous;
  if (error instanceof PipelineError && error.providerError) (job as any).providerError = error.providerError;
  if (error instanceof PipelineError && error.errorAction) (job as any).errorAction = error.errorAction;
  job.updatedAt = now(); return job;
}

/** One bounded state transition. At most one paid provider request is made per invocation. */
export async function advanceJob(job: Job, env: Env): Promise<Job> {
  job.state ||= { artifacts: {}, sources: [] }; job.state.artifacts ||= {}; job.state.sources ||= [];
  job.progress ||= {}; job.updatedAt = now();
  if (job.status === "ready" || job.status === "failed") return job;
  try {
    const art = job.state.artifacts; const calls = Number(job.state.openaiCalls || 0);
    const call = async (prompt: string, options: any) => {
      if (calls >= MAX_OPENAI_CALLS) throw new PipelineError("Episode exceeded the ten-call research budget");
      const result = await openai(env, prompt, options);
      job.state.openaiCalls = calls + 1;
      job.state.openaiResponses ||= [];
      const raw = result.raw;
      job.state.openaiResponses.push({ responseId: raw.id || null, model: raw.model || env.OPENAI_MODEL || "gpt-4.1-mini", usage: raw.usage || null, webSearchCalls: (raw.output || []).filter((item: any) => item.type === "web_search_call").length });
      return result;
    };
    switch (job.stage) {
      case "outline": {
        const { value } = await call(`Create a concise production outline for a serious, welcoming science seminar podcast about: ${job.topic}. Five minutes total, about 625 spoken words at 125 wpm. Opening segment exactly 1 minute for welcome, orientation, question, and roadmap; remaining four minutes distributed across historical context, evidence, interpretation, and uncertainty. Return title, premise, and segments whose minutes total 5.`, { schemaName:"episode_outline", schema:outlineSchema });
        const segments = value.segments;
        if (!Array.isArray(segments) || Math.abs(segments.reduce((n:number,s:any)=>n+Number(s.minutes),0)-5) > .01 || Math.abs(Number(segments[0]?.minutes)-1) > .01) throw new PipelineError("Outline must total five minutes with a one-minute opening");
        art.outline = value; job.title = value.title; job.stage = "research"; job.progress = { label: "Outline ready", percent: 15 }; break;
      }
      case "research": {
        const { value, raw } = await call(`Research the outline below. Search the web once and return the research_dossier object. Include at least 5 concrete findings and exactly 3 distinct sources. Assign the sources the IDs s1, s2, and s3, each exactly once. Every finding's source_ids must contain only those same IDs, never search-result citation labels. Prioritize primary literature, reputable institutions, and historical scholarship. Each source has id,title,url,locator; cite only URLs actually returned by your search. Each finding has id,claim,source_ids,uncertainty. Explain limitations and disagreements in each finding's uncertainty and list broader limitations separately. Outline: ${json(art.outline)}`, { research:true, schemaName:"research_dossier", schema:researchSchema, maxTokens: 5000 });
        const searchCalls = (raw.output || []).filter((item:any)=>item.type === "web_search_call").length;
        if (searchCalls !== 1) throw new PipelineError("Research must complete exactly one hosted web-search call");
        const sources = getSourcesFromResponse(raw, value); const claims = validateDossier(value, sources);
        art.dossier = { findings: value.findings, limitations: value.limitations || [], sources };
        art.researchMetadata = { responseId: raw.id || null, model: raw.model || env.OPENAI_MODEL || "gpt-4.1-mini", usage: raw.usage || null, webSearchCalls: (raw.output || []).filter((item:any)=>item.type === "web_search_call").length, sourceUrls: sources.map((s:Source)=>s.url) };
        job.state.sources = sources; art.claims = claims; job.stage = "script"; job.progress = { label: "Research dossier saved", percent: 35 }; break;
      }
      case "script": {
        const { value: writing } = await call(`Write the complete original five-minute podcast as dialogue among exactly four fictional people: a welcoming host and three complementary experts. Cover history, evidence, and uncertainty in a serious, accessible science seminar. No imitation of any real presenter or broadcaster.
${DIALOGUE_STYLE}
Aim for 625 spoken words in the entire episode (target 600–650, allowed 550–700), approximately five minutes at a calm pace. Use a variable number of turns within ${MIN_TURNS}–${MAX_TURNS}; there is no per-answer word budget. Keep all spoken text under 5,000 characters, including spaces and punctuation. The first turn must be the host's approximately one-minute introduction (110–150 words): welcome listeners, establish a striking supported discovery or central puzzle, pose the question, and briefly introduce all three guests by name and relevant expertise. Then address the first substantive question to a guest. Close with a clear sense of what is established and uncertain, followed by brief thanks.
Include exactly three fictional guest_introductions with speaker, name, and expertise. Return guest_introductions and turns, with ordinary spoken text in each turn's text string. Each turn includes id, speaker, text, factual, claim_ids, delivery. factual is true for any factual or historical assertion, including factual premises in questions and anecdotes; false only for greetings, questions without factual assertions, or pure transitions/opinions. Every factual turn must cite one or more dossier claim IDs. Do not add factual claims beyond the dossier. No stage directions, citations spoken aloud, extra narrator, or invented personal credentials or experiences. Outline: ${json(art.outline)} Dossier: ${json(art.dossier)}`, { model:env.OPENAI_SCRIPT_MODEL || "gpt-4.1", schemaName:"episode_script", schema:scriptSchema(art.claims), maxTokens:7000 });
        const value = normalizeWriting(writing);
        // Save a schema-valid draft before deciding whether its length/opening needs one repair.
        art.script = { turns: value.turns, guest_introductions: value.guest_introductions };
        try {
          const metrics = validateScript(value.turns, art.claims, value.guest_introductions);
          art.script = { ...art.script, ...metrics };
          job.stage = "review"; job.progress = { label: "Draft ready for factual review", percent: 50 };
        } catch (e) {
          const repairable = e instanceof PipelineError && (/^Script is \d+ words;/.test(e.message) || e.message === "Opening turn must be 110–150 words, approximately one minute" || e.message === "One-minute opening must introduce all three fictional experts by name and expertise" || e.message === "Script exceeds the 5,000-character voice budget");
          if (!repairable) throw e;
          art.scriptRepair = { attempted: true, reason: e.message, draftSavedAt: now(), completed: false };
          job.stage = "script_repair"; job.progress = { label: "Tuning script length and opening", percent: 48 };
        }
        break;
      }
      case "script_repair": {
        const draft = art.script; const oldTurns: Turn[] = draft?.turns;
        if (!art.scriptRepair?.attempted || art.scriptRepair.completed || !Array.isArray(oldTurns)) throw new PipelineError("Script repair is unavailable or has already been used");
        const { value } = await call(`The draft currently contains ${wordCount(oldTurns.map(t=>t.text).join(" "))} spoken words. Revise this already complete script ONLY to meet its word-count, one-minute opening, and 5,000-character spoken-text budget. Count only the text fields. Target 625 spoken words overall (must be 600–650) and 110–150 words in the first host turn. The opening must introduce all three guest names and their relevant expertise naturally. Preserve variable contribution lengths, brief interjections, sustained explanations, and the conversational character of each speaker; do not make every answer the same length. Do not alter research claims, factual status, claim_ids, speakers, delivery, turn IDs, guest names, or expertise. Change only turn text; do not add unsupported facts. Return the full episode_script JSON. Draft: ${json(draft)} Dossier claims: ${json(art.claims)}`, { model:env.OPENAI_SCRIPT_MODEL || "gpt-4.1", schemaName:"episode_script_repair", schema:scriptSchema(art.claims), maxTokens:7000 });
        if (JSON.stringify(value.guest_introductions) !== JSON.stringify(draft.guest_introductions) || !Array.isArray(value.turns) || value.turns.length !== oldTurns.length) throw new PipelineError("Script repair changed the guest roster or turn structure");
        for (let i = 0; i < oldTurns.length; i++) {
          const before = oldTurns[i], after = value.turns[i];
          if (!after || before.id !== after.id || before.speaker !== after.speaker || before.factual !== after.factual || JSON.stringify(before.claim_ids) !== JSON.stringify(after.claim_ids) || before.delivery !== after.delivery) throw new PipelineError("Script repair changed a protected turn field");
        }
        const metrics = validateScript(value.turns, art.claims, value.guest_introductions);
        art.script = { turns: value.turns, guest_introductions: value.guest_introductions, ...metrics };
        art.scriptRepair = { ...art.scriptRepair, completed: true, completedAt: now() };
        job.stage = "review"; job.progress = { label: "Repaired draft ready for factual review", percent: 50 };
        break;
      }
      case "review": {
        const { value } = await call(`Review the script strictly against the cited research dossier. Only flag factual statements that are unsupported, overstated, contradicted, or materially misleading. For each flag return turn_id, issue, and replacement_text containing the FULL replacement text for that identified turn; alter only the wording needed to correct the flagged factual statement, preserving every unrelated sentence and its wording exactly. The replacement must remain supported by the turn's existing claim_ids. Do not introduce facts or citations. Do not flag style. If no flags, return empty flags. List unresolved concerns separately. Script: ${json(art.script)} Dossier: ${json(art.dossier)}`, { schemaName:"factual_review", schema:reviewSchema });
        if (!Array.isArray(value.flags) || !Array.isArray(value.unresolved)) throw new PipelineError("Factual review response is invalid");
        const edits = new Map<string,string>(); const turns: Turn[] = art.script.turns;
        for (const f of value.flags) {
          const t = turns.find(x=>x.id===f.turn_id); if (!t || typeof f.replacement_text !== "string" || !f.replacement_text.trim() || edits.has(f.turn_id)) throw new PipelineError("Factual review referenced an invalid turn");
          edits.set(f.turn_id, f.replacement_text);
        }
        const reviewed = turns.map(t=>edits.has(t.id) ? { ...t, text: edits.get(t.id)! } : t);
        validateScript(reviewed, art.claims, art.script.guest_introductions);
        art.review = { flags: value.flags, unresolved: value.unresolved, reviewedAt: now() };
        art.script = { ...art.script, turns: reviewed };
        // Any material uncertainty blocks voice spending until a future explicit human-review workflow exists.
        if (value.unresolved.length) throw new PipelineError("Factual review left unresolved concerns; voice generation is blocked");
        if (!art.clips?.length) art.dialoguePlan = await createDialoguePlan(env, reviewed);
        job.stage = "tts"; job.progress = { label: "Review complete", percent: 60, ttsIndex: 0 }; break;
      }
      case "tts": {
        const turns: Turn[] = art.script?.turns; if (!Array.isArray(turns) || !art.review) throw new PipelineError("Reviewed script required before speech");
        validateScript(turns, art.claims, art.script.guest_introductions);
        const index = Number(job.progress.ttsIndex || 0);
        // Existing partially completed jobs keep their original single-turn
        // voice path. New jobs pin a dialogue plan before any speech request.
        if (!art.dialoguePlan && !art.clips?.length) art.dialoguePlan = await createDialoguePlan(env, turns);
        if (art.dialoguePlan) {
          const plan: DialoguePlan = art.dialoguePlan;
          await verifyDialoguePlan(plan, turns);
          const chunks = plan.chunks;
          if (index >= chunks.length) { job.stage = "assembling"; job.progress = { label: "All conversation sections saved", percent: 90 }; break; }
          const chunk = chunks[index];
          art.clips ||= [];
          const saved = art.clips[index];
          if (saved) {
            if (saved.chunkId !== chunk.id || JSON.stringify(saved.turnIds) !== JSON.stringify(chunk.turnIds)) throw new PipelineError("Saved conversation section does not match its audio plan");
            job.progress = { label: `Conversation section ${index+1} of ${chunks.length} saved`, percent: Math.min(89, 60 + Math.round(29*(index+1)/chunks.length)), ttsIndex: index+1, ttsCharacters: Number(job.progress.ttsCharacters||0)+chunk.characters };
            if (index+1 === chunks.length) job.stage = "assembling";
            break;
          }
          const priorRequestIds = art.clips.slice(0, index).filter((clip: any) => typeof clip?.generatedAt === "string" && Date.now() - Date.parse(clip.generatedAt) <= 2 * 60 * 60_000).map((clip: any) => clip?.requestId).filter((id: unknown): id is string => typeof id === "string").slice(-3);
          const result = await synthDialogue(env, plan, chunk, priorRequestIds);
          validateMp3(result.bytes);
          const key = `episodes/${safeId(job.userId)}/${safeId(job.id)}/clips/${safeId(chunk.id)}-${(await scriptHash(turns)).slice(0,12)}.mp3`;
          await bucket(env).put(key, result.bytes, { httpMetadata: { contentType: "audio/mpeg" } });
          art.clips[index] = { key, chunkId: chunk.id, turnIds: chunk.turnIds, sha256: await sha256(result.bytes), characters: chunk.characters, generatedAt: now(), ...(result.requestId ? { requestId: result.requestId } : {}), ...(result.chargedCharacters !== undefined ? { chargedCharacters: result.chargedCharacters } : {}) };
          const totalCharacters = Number(job.progress.ttsCharacters || 0) + chunk.characters;
          if (totalCharacters > MAX_TTS_CHARS) throw new PipelineError("Speech exceeded the 5,000-character budget");
          job.progress = { label: `Conversation section ${index+1} of ${chunks.length} saved`, percent: Math.min(89, 60 + Math.round(29*(index+1)/chunks.length)), ttsIndex: index+1, ttsCharacters: totalCharacters };
          if (index+1 === chunks.length) job.stage = "assembling";
          break;
        }
        // Legacy jobs with already-saved per-turn clips finish using their
        // original voice model and clip layout.
        if (index >= turns.length) { job.stage = "assembling"; job.progress = { label: "All speech clips saved", percent: 90 }; break; }
        const t = turns[index], clip = await synth(env, t);
        validateMp3(clip);
        const key = `episodes/${safeId(job.userId)}/${safeId(job.id)}/clips/${String(index).padStart(2,"0")}-${safeId(t.id)}.mp3`;
        await bucket(env).put(key, clip, { httpMetadata: { contentType: "audio/mpeg" } });
        art.clips ||= []; art.clips[index] = { key, turnId: t.id, sha256: await sha256(clip), characters: t.text.length };
        job.progress = { label: `Voice turn ${index+1} of ${turns.length} saved`, percent: Math.min(89, 60 + Math.round(29*(index+1)/turns.length)), ttsIndex: index+1, ttsCharacters: Number(job.progress.ttsCharacters||0)+t.text.length };
        if (job.progress.ttsCharacters > MAX_TTS_CHARS) throw new PipelineError("Speech exceeded the 5,000-character budget");
        if (index+1 === turns.length) job.stage = "assembling";
        break;
      }
      case "assembling": {
        const clips = art.clips; const turns: Turn[] = art.script?.turns;
        if (!Array.isArray(turns)) throw new PipelineError("Reviewed script required before audio assembly");
        const plan: DialoguePlan | undefined = art.dialoguePlan;
        if (plan) await verifyDialoguePlan(plan, turns);
        const expectedCount = plan ? plan.chunks.length : turns.length;
        if (!Array.isArray(clips) || clips.length !== expectedCount || clips.some((c:any)=>!c?.key)) throw new PipelineError("One or more speech clips are missing");
        if (plan && clips.some((c:any, i:number) => c.chunkId !== plan.chunks[i].id || JSON.stringify(c.turnIds) !== JSON.stringify(plan.chunks[i].turnIds))) throw new PipelineError("Saved conversation sections are out of order or do not match the audio plan");
        if (!plan && clips.some((c:any, i:number) => c.turnId && c.turnId !== turns[i].id)) throw new PipelineError("Saved speech clips are out of order or do not match the script");
        const buffers: Uint8Array[] = [];
        for (const clip of clips) {
          const obj = await bucket(env).get(clip.key); if (!obj) throw new PipelineError("A saved speech clip is missing from storage");
          const bytes = new Uint8Array(await obj.arrayBuffer());
          if (clip.sha256 && await sha256(bytes) !== clip.sha256) throw new PipelineError("A saved speech clip failed its integrity check");
          buffers.push(bytes);
        }
        const mp3 = concatenateMp3(buffers); const audio = validateMp3(mp3);
        if (audio.durationSeconds < 240 || audio.durationSeconds > 390) throw new PipelineError("Assembled episode duration must be between four and six and a half minutes");
        const key = `episodes/${safeId(job.userId)}/${safeId(job.id)}/episode.mp3`;
        await bucket(env).put(key, mp3, { httpMetadata: { contentType:"audio/mpeg", cacheControl:"private, max-age=31536000, immutable" }, customMetadata: { title: art.outline?.title || job.topic, episodeId: job.id } });
        job.audioKey = key; job.audio = { ...audio, contentType:"audio/mpeg", bytes:mp3.byteLength, fileName:`${safeId(job.topic)}.mp3`, ...(plan ? { generation: { mode: "dialogue", model: plan.model, sections: plan.chunks.length } } : {}) };
        job.status = "ready"; job.stage = "ready"; job.progress = { label:"Episode ready", percent:100 }; break;
      }
      default: throw new PipelineError(`Unknown episode stage: ${job.stage}`);
    }
    job.updatedAt = now(); return job;
  } catch (e) { return fail(job, e); }
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer as ArrayBuffer);
  return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
