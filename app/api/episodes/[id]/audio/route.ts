import { env } from "cloudflare:workers";
import { json, ownedJob, userIdFrom } from "../../../_episodes";
import { verifiedAudioOutput } from "../../../../../lib/episode-v2/audio";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const userId = userIdFrom(request);
  if (!userId) return json({ error: "Sign in to listen to this episode." }, 401);
  if (!env.BUCKET) return json({ error: "Audio storage is unavailable." }, 503);
  const { id } = await context.params;
  let job;
  try { job = await ownedJob(id, userId); }
  catch { return json({ error: "The saved episode could not be loaded safely." }, 503); }
  if (!job) return json({ error: "Episode not found." }, 404);
  const audition = new URL(request.url).searchParams.get("preview") === "audition";
  const audioKey = audition && job.pipelineVersion === 2 ? job.state.audioPipeline?.current?.audition?.key
    : typeof job.audioKey === "string" ? job.audioKey : null;
  if (!audioKey || (!audition && job.status !== "ready") || (audition && job.pipelineVersion !== 2)) return json({ error: "Episode audio is not ready." }, 404);

  let verified;
  if (job.pipelineVersion === 2) {
    try { verified = await verifiedAudioOutput(job, audition, env.BUCKET); }
    catch { return json({ error: "Saved audio does not match the approved script or is unavailable." }, 409); }
  }

  const metadata = await env.BUCKET.head(audioKey);
  if (!metadata) return json({ error: "Episode audio is unavailable." }, 404);
  if (verified && metadata.size !== verified.bytes) return json({ error: "Saved audio size does not match." }, 409);
  const rangeHeader = request.headers.get("range");
  const baseHeaders = new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
    "Content-Type": metadata.httpMetadata?.contentType || "audio/mpeg",
    "Content-Disposition": 'inline; filename="episode.mp3"',
  });
  if (!rangeHeader) {
    const full = await env.BUCKET.get(audioKey);
    if (!full) return json({ error: "Episode audio is unavailable." }, 404);
    baseHeaders.set("Content-Length", String(metadata.size));
    return new Response(full.body, { headers: baseHeaders });
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${metadata.size}` } });
  let start: number;
  let end: number;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix < 1) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${metadata.size}` } });
    }
    start = Math.max(0, metadata.size - suffix);
    end = metadata.size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : metadata.size - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= metadata.size) {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${metadata.size}` } });
  }
  end = Math.min(end, metadata.size - 1);
  const length = end - start + 1;
  const partial = await env.BUCKET.get(audioKey, { range: { offset: start, length } });
  if (!partial) return json({ error: "Episode audio is unavailable." }, 404);
  baseHeaders.set("Content-Length", String(length));
  baseHeaders.set("Content-Range", `bytes ${start}-${end}/${metadata.size}`);
  return new Response(partial.body, { status: 206, headers: baseHeaders });
}
