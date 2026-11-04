import { env } from "cloudflare:workers";
import { transcriptExport } from "../../../../../lib/episode-v2/exports";
import { readArtifact } from "../../../../../lib/episode-v2/persistence";
import { latestArtifactRef } from "../../../../../lib/episode-v2/stage-helpers";
import { json, ownedJob, userIdFrom } from "../../../_episodes";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const userId = userIdFrom(request);
  if (!userId) return json({ error: "Sign in to download this transcript." }, 401);
  const { id } = await context.params;
  try {
    const job = await ownedJob(id, userId);
    if (!job) return json({ error: "Episode not found." }, 404);
    if (job.pipelineVersion !== 2 || !latestArtifactRef(job, "transcript")) return json({ error: "A V2 transcript is not available yet." }, 404);
    const exported = await transcriptExport(job, ref => readArtifact(job, ref, env.BUCKET));
    return json(exported, 200, { "Content-Disposition": `attachment; filename="transcript-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}.json"` });
  } catch { return json({ error: "The saved transcript could not be downloaded safely." }, 503); }
}
