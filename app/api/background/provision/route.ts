import { env } from 'cloudflare:workers';
import { serviceAuthorized, provisionDriver } from '../../../../lib/background-driver';
export const dynamic='force-dynamic';
export async function POST(request:Request) {
  if(!await serviceAuthorized(request,env.BACKGROUND_PROVISION_SECRET)) return new Response('Forbidden',{status:403});
  try { return Response.json(await provisionDriver(env),{headers:{'Cache-Control':'no-store'}}); }
  catch(error) { return Response.json({error:error instanceof Error && /^(Cloudflare deployment HTTP|Background settings missing|Cloudflare connection missing)/.test(error.message)?error.message:'Background provisioning failed'},{status:503}); }
}
