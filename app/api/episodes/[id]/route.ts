import { json, ownedJob, publicJob, userIdFrom } from "../../_episodes";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const userId = userIdFrom(request);
  if (!userId) return json({ error: "Sign in to view this episode." }, 401);
  const { id } = await context.params;
  let job;
  try { job = await ownedJob(id, userId); }
  catch { return json({ error: "The saved episode could not be read safely." }, 503); }
  if (!job) return json({ error: "Episode not found." }, 404);
  return json(publicJob(job));
}
