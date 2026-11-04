import { backgroundSchedulerActive } from './episode-v2/scheduler.ts';
export const CONNECTION_OBJECT = "private/settings/cloudflare-connection-v1.json";
export const setupHeaders = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
};
export function setupOwner(request: Request, env: Cloudflare.Env) {
  return !!env.EPISODE_OWNER_USER_ID && request.headers.get("oai-authenticated-user-id")?.trim() === env.EPISODE_OWNER_USER_ID;
}
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: setupHeaders });
async function keyFrom(secret: string) {
  const bytes = Uint8Array.from(atob(secret), c => c.charCodeAt(0));
  if (bytes.length !== 32) throw new Error("Setup unavailable");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}
export async function sealConnection(value: unknown, secret: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(CONNECTION_OBJECT) }, await keyFrom(secret), new TextEncoder().encode(JSON.stringify(value)));
  return JSON.stringify({ version: 1, iv: Array.from(iv), ciphertext: Array.from(new Uint8Array(encrypted)) });
}
export async function openConnection(serialized: string, secret: string) {
  const value = JSON.parse(serialized);
  if (value.version !== 1) throw new Error("Unknown connection format");
  const clear = await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(value.iv), additionalData: new TextEncoder().encode(CONNECTION_OBJECT) }, await keyFrom(secret), new Uint8Array(value.ciphertext));
  return JSON.parse(new TextDecoder().decode(clear)) as { accountId: string; token: string; verifiedAt: string };
}
export async function handleCloudflareSetup(request: Request, env: Cloudflare.Env, fetcher: typeof fetch = fetch) {
  if (!setupOwner(request, env)) return reply({ error: "Only the app owner can access setup." }, 403);
  if (!env.BUCKET || !env.CLOUDFLARE_SETUP_KEY) return reply({ error: "Private setup is not configured yet." }, 503);
  if (request.method === "GET") {
    try {
      const object = await env.BUCKET.get(CONNECTION_OBJECT);
      if (!object) return reply({ connected: false, backgroundActive: false });
      const connection = await openConnection(await object.text(), env.CLOUDFLARE_SETUP_KEY);
      const driver = await env.BUCKET.get('private/settings/background-driver-v1.json');
      return reply({ connected: true, accountId: connection.accountId, verifiedAt: connection.verifiedAt, backgroundConfigured: !!driver, backgroundActive: await backgroundSchedulerActive(env.DB) });
    } catch { return reply({ error: "The saved connection could not be read safely." }, 503); }
  }
  if (request.method !== "POST") return reply({ error: "Method not allowed." }, 405);
  if (request.headers.get("origin") !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") return reply({ error: "Open setup directly in this app." }, 403);
  if (!request.headers.get("content-type")?.startsWith("application/json")) return reply({ error: "Send a JSON request." }, 415);
  let body: { accountId?: unknown; token?: unknown };
  try {
    const reader = request.body?.getReader();
    if (!reader) return reply({ error: "Enter your account ID and API token." }, 400);
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) { const item = await reader.read(); if (item.done) break; size += item.value.length; if (size > 4096) { await reader.cancel(); return reply({ error: "Setup request is too large." }, 413); } chunks.push(item.value); }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch { return reply({ error: "Enter a valid account ID and API token." }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.accountId !== "string" || !/^[a-f0-9]{32}$/i.test(body.accountId.trim()) || typeof body.token !== "string" || !/^[A-Za-z0-9_-]{20,256}$/.test(body.token.trim())) return reply({ error: "Enter the 32-character account ID and an API token, not a Global API Key." }, 400);
  const accountId = body.accountId.trim().toLowerCase(), token = body.token.trim();
  let step = "token";
  const rejected = (status: number, codes: number[] = []) => {
    // Log only fixed stage names and numeric codes, never provider text or credentials.
    console.error(JSON.stringify({ event: "cloudflare_setup_rejected", step, status, codes }));
    const detail = step === "token" ? "Cloudflare rejected the API token. Check that the token value (not its name or ID) was copied, is active, and has no client-IP restriction blocking this server."
      : step === "workers" ? "The token could not access Workers in this account. Check the Account ID and Account Resources selection, and Account → Workers Scripts → Edit."
      : "The token passed the Workers check but could not access Queues. Check Account → Queues → Edit for the same account.";
    return reply({ error: `${detail} [${step}; HTTP ${status}${codes.length ? `; code ${codes.join(",")}` : ""}]`, step, status, codes }, 422);
  };
  const check = async (path: string) => {
    const response = await fetcher("https://api.cloudflare.com/client/v4" + path, { headers: { Authorization: `Bearer ${token}` }, redirect: "manual", signal: AbortSignal.timeout(15000) });
    const result = await response.json().catch(() => null) as { success?: boolean; result?: { status?: string }; errors?: {code?: unknown}[] } | null;
    const codes = Array.isArray(result?.errors) ? result.errors.slice(0, 5).map(e => e?.code).filter((code): code is number => typeof code === "number" && Number.isSafeInteger(code) && code >= 1000 && code <= 999999) : [];
    return { status: response.status, result, codes, ok: response.ok && result?.success === true };
  };
  try {
    // Workers supports manual/follow, not redirect:error. Manual plus the
    // non-2xx check below rejects redirects without forwarding the credential.
    // User-owned and account-owned tokens have separate verification endpoints.
    let verification = await check(token.startsWith("cfat_") ? `/accounts/${accountId}/tokens/verify` : "/user/tokens/verify");
    if (!verification.ok && !token.startsWith("cfat_") && [401, 403].includes(verification.status)) verification = await check(`/accounts/${accountId}/tokens/verify`);
    if (!verification.ok || verification.result?.result?.status !== "active") return rejected(verification.status, verification.codes);
    for (const [stage, path] of [["workers", `/accounts/${accountId}/workers/scripts`], ["queues", `/accounts/${accountId}/queues?page=1&per_page=1`]]) {
      step = stage;
      const access = await check(path);
      if (!access.ok) return rejected(access.status, access.codes);
    }
    step = "save";
    const verifiedAt = new Date().toISOString();
    await env.BUCKET.put(CONNECTION_OBJECT, await sealConnection({ accountId, token, verifiedAt }, env.CLOUDFLARE_SETUP_KEY), { httpMetadata: { contentType: "application/json", cacheControl: "no-store" } });
    return reply({ connected: true, accountId, verifiedAt, backgroundActive: false });
  } catch {
    console.error(JSON.stringify({ event: "cloudflare_setup_failed", step }));
    // Provider bodies and errors can contain credentials; never return or log them.
    return reply({ error: `The ${step === "save" ? "encrypted connection could not be saved" : `${step} check could not reach a valid Cloudflare response`}. [${step}]`, step }, 503);
  }
}
