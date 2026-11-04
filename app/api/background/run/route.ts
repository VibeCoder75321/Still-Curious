import { env } from 'cloudflare:workers';
import { serviceAuthorized } from '../../../../lib/background-driver';
import { runEpisodeScheduler } from '../../../../lib/episode-v2/scheduler';
export const dynamic='force-dynamic';
export async function POST(request:Request) {
  if(!await serviceAuthorized(request,env.BACKGROUND_RUN_SECRET)) return new Response('Forbidden',{status:403});
  // Owners come from stored jobs, never from the caller. Pauses and budgets remain enforced.
  const result=await runEpisodeScheduler(env);
  return Response.json(result,{headers:{'Cache-Control':'no-store'}});
}
