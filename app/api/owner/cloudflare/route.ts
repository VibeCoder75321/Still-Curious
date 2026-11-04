import { env } from "cloudflare:workers";
import { handleCloudflareSetup } from "../../../../lib/cloudflare-setup";
export const dynamic = "force-dynamic";
export const GET = (request: Request) => handleCloudflareSetup(request, env);
export const POST = (request: Request) => handleCloudflareSetup(request, env);
