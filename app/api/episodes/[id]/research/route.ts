import { json, ownedJob, userIdFrom } from "../../../_episodes";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const userId = userIdFrom(request);
  if (!userId) return json({ error: "Sign in to download this research." }, 401);
  const { id } = await context.params;
  let job;
  try { job = await ownedJob(id, userId); }
  catch { return json({ error: "The saved research could not be read safely." }, 503); }
  if (!job) return json({ error: "Episode not found." }, 404);
  if (job.pipelineVersion === 2) {
    if (!latestArtifactRef(job, "source_records") && !latestArtifactRef(job, "evidence_pack")) return json({ error: "Research is not available yet." }, 404);
    try {
      const exported = await researchExport(job, ref => readArtifact(job, ref, env.BUCKET));
      return json(exported, 200, { "Content-Disposition": `attachment; filename="research-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}.json"` });
    } catch { return json({ error: "The saved research could not be downloaded safely." }, 503); }
  }
  const dossier = job.state?.artifacts?.dossier;
  if (!dossier) return json({ error: "The research dossier is not ready yet." }, 404);
  const filename = `research-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`;
  return new Response(JSON.stringify({ episodeId: id, title: job.title || job.topic, ...dossier }, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
import { env } from "cloudflare:workers";
import { researchExport } from "../../../../../lib/episode-v2/exports";
import { readArtifact } from "../../../../../lib/episode-v2/persistence";
import { latestArtifactRef } from "../../../../../lib/episode-v2/stage-helpers";
