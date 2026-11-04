import test from "node:test";
import assert from "node:assert/strict";
import { base64url, createMobileSession, MobileAuthError, verifyAppleIdentityToken, verifyMobileSession, type MobileAccount } from "../lib/mobile/auth.ts";

const now = Date.parse("2026-11-04T16:00:00Z"), nowSeconds = now / 1000;
const nonce = "a".repeat(64), audience = "com.example.stillcurious";
const encoder = new TextEncoder();
const keys = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const publicJWK = { ...await crypto.subtle.exportKey("jwk", keys.publicKey), kid: "apple-offline-fixture", alg: "RS256", use: "sig" };
async function identity(overrides: Record<string, unknown> = {}, headerOverrides: Record<string, unknown> = {}) {
  const header = { alg: "RS256", kid: publicJWK.kid, ...headerOverrides };
  const body = { iss: "https://appleid.apple.com", aud: audience, sub: "apple-subject-offline", iat: nowSeconds - 10, exp: nowSeconds + 600, nonce, ...overrides };
  const message = [header, body].map(value => base64url(encoder.encode(JSON.stringify(value)))).join(".");
  return `${message}.${base64url(new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, encoder.encode(message))))}`;
}
const mockFetch: typeof fetch = async (url, init) => {
  assert.equal(url, "https://appleid.apple.com/auth/keys");
  assert.equal(init?.redirect, "error");
  return Response.json({ keys: [publicJWK] });
};
const options = { audience, expectedNonceHash: nonce, nowMs: now, fetch: mockFetch };
const isIdentityError = (e: unknown) => e instanceof MobileAuthError && e.code === "invalid_identity";

test("mobile Apple sign-in verifies an RSA signature, fixed issuer/audience and server nonce", async () => {
  const verified = await verifyAppleIdentityToken(await identity({ email: "not-retained@example.invalid", name: "Not retained" }), options);
  assert.deepEqual(verified, { provider: "apple", subject: "apple-subject-offline" });
  assert.equal(Object.isFrozen(verified), true);
});

test("mobile identity tokens reject tampering, wrong audiences/nonces/issuer and expired/future claims", async () => {
  const token = await identity();
  const parts = token.split(".");
  parts[1] = base64url(encoder.encode(JSON.stringify({ iss: "https://appleid.apple.com", aud: audience, sub: "attacker", nonce, iat: nowSeconds, exp: nowSeconds + 100 })));
  await assert.rejects(verifyAppleIdentityToken(parts.join("."), options), isIdentityError);
  for (const claims of [
    { aud: "other.app" }, { aud: [audience] }, { nonce: "b".repeat(64) }, { nonce: undefined }, { iss: "https://attacker.invalid" },
    { exp: nowSeconds }, { exp: nowSeconds - 1 }, { iat: nowSeconds + 61 }, { iat: nowSeconds + 700 }, { sub: "" }, { exp: "9999999999" },
  ]) await assert.rejects(verifyAppleIdentityToken(await identity(claims), options), isIdentityError);
});

test("mobile identity verification rejects algorithm confusion and token-selected key URLs before fetching", async () => {
  let calls = 0;
  for (const header of [{ alg: "HS256" }, { alg: "none" }, { jku: "https://attacker.invalid/keys" }, { x5u: "https://attacker.invalid/cert" }, { crit: ["evil"] }, { b64: false }]) {
    await assert.rejects(verifyAppleIdentityToken(await identity({}, header), { ...options, fetch: async () => { calls++; throw new Error(); } }), isIdentityError);
  }
  assert.equal(calls, 0);
  await assert.rejects(verifyAppleIdentityToken(await identity({}, { kid: "unknown" }), options), isIdentityError);
  await assert.rejects(verifyAppleIdentityToken(await identity(), { ...options, fetch: async () => Response.json({ keys: [publicJWK, publicJWK] }) }), isIdentityError);
});

test("mobile identity configuration and key-service errors fail closed without reflecting upstream secrets", async () => {
  await assert.rejects(verifyAppleIdentityToken(await identity(), { ...options, audience: "" }), e => e instanceof MobileAuthError && e.code === "configuration");
  await assert.rejects(verifyAppleIdentityToken(await identity(), { ...options, expectedNonceHash: "raw-unhashed-challenge" }), e => e instanceof MobileAuthError && e.code === "configuration");
  await assert.rejects(verifyAppleIdentityToken(await identity(), { ...options, fetch: async () => { throw new Error("secret-upstream-details"); } }), e => e instanceof MobileAuthError && e.code === "unavailable" && !e.message.includes("secret-upstream"));
});

const account: MobileAccount = { id: "server-account-id", appAccountToken: "e19b0480-ad4d-4a9b-b5df-683a690c2c46", sessionVersion: 2, active: true };
const sessionOptions = { secret: base64url(crypto.getRandomValues(new Uint8Array(32))), nowMs: now };
const isSessionError = (e: unknown) => e instanceof MobileAuthError && e.code === "invalid_session";

test("mobile sessions authenticate only a server account and perform authoritative revocation lookup", async () => {
  const token = await createMobileSession(account, sessionOptions);
  let lookups = 0;
  const verified = await verifyMobileSession(token, sessionOptions, async id => { lookups++; assert.equal(id, account.id); return account; });
  assert.deepEqual(verified, account); assert.equal(lookups, 1);
  assert.equal(Object.isFrozen(verified), true);
  for (const current of [null, { ...account, active: false }, { ...account, sessionVersion: 3 }, { ...account, appAccountToken: crypto.randomUUID() }, { ...account, id: "different" }]) {
    await assert.rejects(verifyMobileSession(token, sessionOptions, async () => current), isSessionError);
  }
});

test("mobile sessions reject bad signatures/expiry and never query the account for unauthenticated claims", async () => {
  const token = await createMobileSession(account, sessionOptions, 60);
  let lookups = 0;
  const lookup = async () => { lookups++; return account; };
  await assert.rejects(verifyMobileSession(token, { ...sessionOptions, nowMs: now + 60_000 }, lookup), isSessionError);
  const pieces = token.split("."); pieces[1] = base64url(encoder.encode(JSON.stringify({ sub: "attacker" })));
  await assert.rejects(verifyMobileSession(pieces.join("."), sessionOptions, lookup), isSessionError);
  await assert.rejects(verifyMobileSession(token, { ...sessionOptions, secret: base64url(crypto.getRandomValues(new Uint8Array(32))) }, lookup), isSessionError);
  assert.equal(lookups, 0);
});

test("mobile session configuration rejects weak secrets, invalid accounts and excessive lifetimes", async () => {
  for (const secret of ["", "weak-secret", base64url(new Uint8Array(31))]) await assert.rejects(createMobileSession(account, { ...sessionOptions, secret }), e => e instanceof MobileAuthError && e.code === "configuration");
  for (const ttl of [0, 59, 86_401, 1.5]) await assert.rejects(createMobileSession(account, sessionOptions, ttl), MobileAuthError);
  await assert.rejects(createMobileSession({ ...account, active: false }, sessionOptions), MobileAuthError);
  await assert.rejects(createMobileSession({ ...account, appAccountToken: "request-body-value" }, sessionOptions), MobileAuthError);
});

test("session lookup outages are unavailable rather than silently accepting a token", async () => {
  await assert.rejects(verifyMobileSession(await createMobileSession(account, sessionOptions), sessionOptions, async () => { throw new Error("database details"); }), e => e instanceof MobileAuthError && e.code === "unavailable" && !e.message.includes("database"));
});

test("invalid injected clocks cannot bypass identity/session expiry checks", async () => {
  const token = await createMobileSession(account, sessionOptions);
  for (const nowMs of [NaN, Infinity, -1, 1.5]) {
    await assert.rejects(verifyAppleIdentityToken(await identity(), { ...options, nowMs }), e => e instanceof MobileAuthError && e.code === "configuration");
    await assert.rejects(createMobileSession(account, { ...sessionOptions, nowMs }), e => e instanceof MobileAuthError && e.code === "configuration");
    await assert.rejects(verifyMobileSession(token, { ...sessionOptions, nowMs }, async () => account), e => e instanceof MobileAuthError && e.code === "configuration");
  }
});
