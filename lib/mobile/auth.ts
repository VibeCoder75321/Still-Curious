/** Mobile identities are verified by the server; platform identity headers are never accepted here. */
export class MobileAuthError extends Error {
  readonly code: "configuration" | "invalid_identity" | "invalid_session" | "unavailable";
  constructor(code: MobileAuthError["code"]) {
    super(code === "configuration" ? "Mobile sign-in is not configured." : code === "unavailable" ? "Sign-in verification is temporarily unavailable." : "Sign in again to continue.");
    this.code = code;
  }
}

const encoder = new TextEncoder();
const APPLE_ISSUER = "https://appleid.apple.com";
const APPLE_KEYS_URL = `${APPLE_ISSUER}/auth/keys`;
const SESSION_ISSUER = "still-curious-mobile";
const SESSION_AUDIENCE = "still-curious-ios";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_SESSION_SECONDS = 86_400;

export function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decode(value: string, maxBytes = 16_384): Uint8Array {
  if (!value || value.length > Math.ceil(maxBytes * 4 / 3) + 4 || !/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) throw new Error("Invalid encoding");
  const data = Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), c => c.charCodeAt(0));
  if (data.length > maxBytes || base64url(data) !== value) throw new Error("Invalid encoding");
  return data;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid object");
  return value as Record<string, unknown>;
}

function jwtParts(token: string) {
  if (typeof token !== "string" || token.length > 24_000) throw new Error("Invalid token");
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid token");
  const header = object(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decode(parts[0], 2048))));
  // Unrecognised critical headers cannot be silently ignored.
  if ("crit" in header || "b64" in header || "jku" in header || "x5u" in header) throw new Error("Unsupported header");
  return { header, message: encoder.encode(parts.slice(0, 2).join(".")), signature: decode(parts[2], 2048),
    claims: () => object(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decode(parts[1])))) };
}

function buffer(bytes: Uint8Array): ArrayBuffer { return Uint8Array.from(bytes).buffer; }
function seconds(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value > 0; }
function text(value: unknown, max = 255): value is string { return typeof value === "string" && value.length > 0 && value.length <= max && value === value.trim(); }
function currentSeconds(nowMs = Date.now()): number {
  if (!seconds(nowMs)) throw new MobileAuthError("configuration");
  return Math.floor(nowMs / 1000);
}

export type VerifiedAppleIdentity = Readonly<{ provider: "apple"; subject: string }>;
export type AppleIdentityOptions = {
  audience: string;
  /** SHA-256 hex of a server-issued, single-use random challenge, also sent to Apple's native sign-in request. */
  expectedNonceHash: string;
  nowMs?: number;
  fetch?: typeof fetch;
};

/** Call only after looking up an unexpired server challenge. Consume that challenge atomically before issuing a session. */
export async function verifyAppleIdentityToken(token: string, options: AppleIdentityOptions): Promise<VerifiedAppleIdentity> {
  if (!text(options.audience) || !/^[a-f0-9]{64}$/.test(options.expectedNonceHash)) throw new MobileAuthError("configuration");
  const now = currentSeconds(options.nowMs);
  let parsed: ReturnType<typeof jwtParts>;
  try {
    parsed = jwtParts(token);
    if (parsed.header.alg !== "RS256" || !text(parsed.header.kid, 200)) throw new Error();
  } catch { throw new MobileAuthError("invalid_identity"); }

  let keys: unknown;
  try {
    const response = await (options.fetch ?? fetch)(APPLE_KEYS_URL, { redirect: "error", signal: AbortSignal.timeout(5000), headers: { Accept: "application/json" } });
    if (!response.ok || Number(response.headers.get("content-length")) > 65_536) throw new Error();
    const body = await response.text();
    if (body.length > 65_536) throw new Error();
    keys = object(JSON.parse(body)).keys;
    if (!Array.isArray(keys) || keys.length > 20) throw new Error();
  } catch { throw new MobileAuthError("unavailable"); }

  try {
    const matches = (keys as unknown[]).map(object).filter(key => key.kid === parsed.header.kid && key.kty === "RSA" && key.alg === "RS256" && key.use === "sig");
    if (matches.length !== 1) throw new Error();
    const jwk = matches[0];
    if (!text(jwk.n, 2048) || !text(jwk.e, 32)) throw new Error();
    // Import only the public RSA fields: no token-controlled URL, x5c trust, or alternate algorithm.
    const key = await crypto.subtle.importKey("jwk", { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    if (!await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, buffer(parsed.signature), buffer(parsed.message))) throw new Error();
    const claims = parsed.claims();
    if (claims.iss !== APPLE_ISSUER || claims.aud !== options.audience || !text(claims.sub)
      || !seconds(claims.exp) || claims.exp <= now || !seconds(claims.iat) || claims.iat > now + 60 || claims.iat >= claims.exp
      || claims.nonce !== options.expectedNonceHash) throw new Error();
    return Object.freeze({ provider: "apple", subject: claims.sub });
  } catch { throw new MobileAuthError("invalid_identity"); }
}

export type MobileAccount = Readonly<{ id: string; appAccountToken: string; sessionVersion: number; active: boolean }>;
export type MobileSessionOptions = { secret: string; nowMs?: number };

function validAccount(account: MobileAccount): boolean {
  return !!account && text(account.id) && typeof account.appAccountToken === "string" && UUID.test(account.appAccountToken) && Number.isSafeInteger(account.sessionVersion) && account.sessionVersion >= 0 && account.active === true;
}

async function sessionKey(secret: string) {
  try {
    const bytes = decode(secret, 64);
    if (bytes.length < 32) throw new Error();
    return await crypto.subtle.importKey("raw", buffer(bytes), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  } catch { throw new MobileAuthError("configuration"); }
}

/** Account must come from an atomic server-side identity mapping, never the request body. Store the returned token in iOS Keychain. */
export async function createMobileSession(account: MobileAccount, options: MobileSessionOptions, ttlSeconds = 3600): Promise<string> {
  const key = await sessionKey(options.secret);
  if (!validAccount(account) || !Number.isSafeInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > MAX_SESSION_SECONDS) throw new MobileAuthError("configuration");
  const now = currentSeconds(options.nowMs);
  const claims = { iss: SESSION_ISSUER, aud: SESSION_AUDIENCE, sub: account.id, jti: crypto.randomUUID(),
    version: account.sessionVersion, accountToken: account.appAccountToken.toLowerCase(), iat: now, exp: now + ttlSeconds };
  const body = `${base64url(encoder.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })))}.${base64url(encoder.encode(JSON.stringify(claims)))}`;
  const signature = await crypto.subtle.sign("HMAC", key, buffer(encoder.encode(body)));
  return `${body}.${base64url(new Uint8Array(signature))}`;
}

/** The authoritative account lookup makes deletion/session-version changes revoke previously issued sessions. */
export async function verifyMobileSession(token: string, options: MobileSessionOptions,
  loadAccount: (id: string) => Promise<MobileAccount | null>): Promise<MobileAccount> {
  const key = await sessionKey(options.secret);
  const now = currentSeconds(options.nowMs);
  let claims: Record<string, unknown>;
  try {
    const parsed = jwtParts(token);
    if (parsed.header.alg !== "HS256" || parsed.header.typ !== "JWT" || !await crypto.subtle.verify("HMAC", key, buffer(parsed.signature), buffer(parsed.message))) throw new Error();
    claims = parsed.claims();
    if (claims.iss !== SESSION_ISSUER || claims.aud !== SESSION_AUDIENCE || !text(claims.sub) || !text(claims.jti) || !UUID.test(claims.jti)
      || !seconds(claims.iat) || claims.iat > now || !seconds(claims.exp) || claims.exp <= now || claims.exp - claims.iat > MAX_SESSION_SECONDS || claims.exp <= claims.iat
      || !Number.isSafeInteger(claims.version) || (claims.version as number) < 0 || typeof claims.accountToken !== "string" || !UUID.test(claims.accountToken)) throw new Error();
  } catch { throw new MobileAuthError("invalid_session"); }
  let account: MobileAccount | null;
  try { account = await loadAccount(claims.sub as string); }
  catch { throw new MobileAuthError("unavailable"); }
  if (!account || !validAccount(account) || account.id !== claims.sub || account.sessionVersion !== claims.version || account.appAccountToken.toLowerCase() !== claims.accountToken) throw new MobileAuthError("invalid_session");
  return Object.freeze({ ...account });
}
