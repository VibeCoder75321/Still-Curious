import { env } from "cloudflare:workers";
import html from "../../client/setup.html?raw";
import { setupHeaders, setupOwner } from "../../lib/cloudflare-setup";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  if (!setupOwner(request, env)) return new Response("Sign in with the app owner's ChatGPT account to access private setup.", { status: 403, headers: setupHeaders });
  return new Response(html, { headers: { ...setupHeaders, "Content-Type": "text/html; charset=utf-8" } });
}
