import test from "node:test";
import assert from "node:assert/strict";
import { activateMobileSubscription, MobileSubscriptionError, reserveMobileEpisode, type AppleSubscriptionVerifier, type EpisodeAllowanceRepository, type SubscriptionConfiguration, type SubscriptionRepository, type VerifiedSubscription } from "../lib/mobile/subscriptions.ts";
import type { MobileAccount } from "../lib/mobile/auth.ts";

const now = Date.parse("2026-11-04T16:00:00Z");
const account: MobileAccount = { id: "server-account", appAccountToken: "e19b0480-ad4d-4a9b-b5df-683a690c2c46", sessionVersion: 0, active: true };
const configuration: SubscriptionConfiguration = { bundleId: "com.example.stillcurious", appAppleId: 123456789, productId: "stillcurious.monthly", environment: "Production" };
const jws = "opaque.signed.transaction";
function verified() {
  return { verificationContext: configuration, transaction: { bundleId: configuration.bundleId, productId: configuration.productId,
    environment: "Production", type: "Auto-Renewable Subscription", inAppOwnershipType: "PURCHASED", appAccountToken: account.appAccountToken,
    transactionId: "2000000123456789", originalTransactionId: "2000000123456000", purchaseDate: now - 1000, expiresDate: now + 60_000, signedDate: now },
    state: "active" as const, checkedAt: now };
}
function verifier(result: unknown = verified()): AppleSubscriptionVerifier {
  return { async verifyAndRefresh(input) { assert.equal(input, jws); return result as Awaited<ReturnType<AppleSubscriptionVerifier["verifyAndRefresh"]>>; } };
}
function repository() {
  const saved: VerifiedSubscription[] = [];
  const repository: SubscriptionRepository = { async activate(value) { saved.push(value); return "activated"; } };
  return { saved, repository };
}
const errorCode = (code: string) => (e: unknown) => e instanceof MobileSubscriptionError && e.code === code;

test("StoreKit activation saves current server-verified, account-bound renewal before acknowledgement", async () => {
  const h = repository();
  const result = await activateMobileSubscription(jws, account, configuration, verifier(), h.repository, now);
  assert.equal(h.saved.length, 1); assert.deepEqual(h.saved[0], result);
  assert.equal(result.accountId, account.id); assert.equal(result.originalTransactionId, "2000000123456000");
  assert.equal(result.periodStart, now - 1000); assert.equal(Object.isFrozen(result), true);
  assert.equal("signedTransaction" in result, false);
});

test("unconfigured verifier, product/application identifiers and inactive account cannot activate", async () => {
  const h = repository();
  await assert.rejects(activateMobileSubscription(jws, account, configuration, undefined, h.repository, now), errorCode("configuration"));
  for (const config of [{ ...configuration, appAppleId: 0 }, { ...configuration, productId: "" }, { ...configuration, bundleId: "" }]) {
    await assert.rejects(activateMobileSubscription(jws, account, config, verifier(), h.repository, now), errorCode("configuration"));
  }
  await assert.rejects(activateMobileSubscription(jws, { ...account, active: false }, configuration, verifier(), h.repository, now), errorCode("configuration"));
  assert.equal(h.saved.length, 0);
});

test("invalid signatures and mismatched verifier application context never persist entitlements", async () => {
  const h = repository();
  await assert.rejects(activateMobileSubscription(jws, account, configuration, { async verifyAndRefresh() { throw new Error("untrusted secret body"); } }, h.repository, now), errorCode("verification"));
  for (const patch of [{ appAppleId: 111 }, { bundleId: "another.app" }, { environment: "Sandbox" }, { productId: "another.product" }]) {
    await assert.rejects(activateMobileSubscription(jws, account, configuration, verifier({ ...verified(), verificationContext: { ...configuration, ...patch } }), h.repository, now), errorCode("verification"));
  }
  assert.equal(h.saved.length, 0);
});

test("purchase validation rejects another app/product/environment, family sharing and malformed periods", async () => {
  const h = repository();
  for (const patch of [{ bundleId: "another.app" }, { productId: "another.product" }, { environment: "Sandbox" }, { type: "Consumable" },
    { inAppOwnershipType: "FAMILY_SHARED" }, { transactionId: "not-an-apple-id" }, { originalTransactionId: undefined }, { expiresDate: now - 2000 },
    { purchaseDate: now + 61_000 }, { signedDate: now + 61_000 }, { expiresDate: "999999999999" }, { signedDate: undefined }]) {
    await assert.rejects(activateMobileSubscription(jws, account, configuration, verifier({ ...verified(), transaction: { ...verified().transaction, ...patch } }), h.repository, now), errorCode("verification"));
  }
  assert.equal(h.saved.length, 0);
});

test("subscription activation rejects account-token swaps and existing original-transaction ownership", async () => {
  const h = repository();
  for (const appAccountToken of [undefined, "", crypto.randomUUID()]) {
    await assert.rejects(activateMobileSubscription(jws, account, configuration, verifier({ ...verified(), transaction: { ...verified().transaction, appAccountToken } }), h.repository, now), errorCode("ownership"));
  }
  await assert.rejects(activateMobileSubscription(jws, account, configuration, verifier(), { async activate() { return "different_owner"; } }, now), errorCode("ownership"));
  assert.equal(h.saved.length, 0);
});

test("expired/refunded/revoked/nonactive subscriptions and stale status cannot unlock creation", async () => {
  const h = repository();
  for (const state of ["grace_period", "billing_retry", "expired", "revoked"]) {
    await assert.rejects(activateMobileSubscription(jws, account, configuration, verifier({ ...verified(), state }), h.repository, now), errorCode("inactive"));
  }
  for (const patch of [{ expiresDate: now }, { revocationDate: now - 1 }]) {
    await assert.rejects(activateMobileSubscription(jws, account, configuration, verifier({ ...verified(), transaction: { ...verified().transaction, ...patch } }), h.repository, now), errorCode("inactive"));
  }
  for (const checkedAt of [now - 60_001, now + 1001]) {
    await assert.rejects(activateMobileSubscription(jws, account, configuration, verifier({ ...verified(), checkedAt }), h.repository, now), errorCode("verification"));
  }
  assert.equal(h.saved.length, 0);
});

test("persistence failures and stale activations are not acknowledged as successful purchases", async () => {
  await assert.rejects(activateMobileSubscription(jws, account, configuration, verifier(), { async activate() { throw new Error("DB details"); } }, now), errorCode("unavailable"));
  await assert.rejects(activateMobileSubscription(jws, account, configuration, verifier(), { async activate() { return "stale"; } }, now), errorCode("verification"));
});

async function entitlement() { return activateMobileSubscription(jws, account, configuration, verifier(), repository().repository, now); }
test("episode allowances require explicit server policy and current verified status", async () => {
  let calls = 0;
  const repo: EpisodeAllowanceRepository = { async reserveEpisode() { calls++; return "reserved"; } };
  const subscription = await entitlement();
  for (const limit of [undefined, 0, -1, 1.1, 10_001]) await assert.rejects(reserveMobileEpisode(subscription, "episode", limit, repo, now), errorCode("configuration"));
  await assert.rejects(reserveMobileEpisode({ ...subscription, periodEnd: now }, "episode", 2, repo, now), errorCode("inactive"));
  await assert.rejects(reserveMobileEpisode({ ...subscription, checkedAt: now - 60_001 }, "episode", 2, repo, now), errorCode("inactive"));
  await assert.rejects(reserveMobileEpisode(subscription, "../episode", 2, repo, now), errorCode("verification"));
  assert.equal(calls, 0);
});

test("quota repository receives an idempotent account/period reservation before provider work", async () => {
  const subscription = await entitlement(), reserved = new Set<string>();
  const repo: EpisodeAllowanceRepository = { async reserveEpisode(input) {
    assert.equal(input.accountId, account.id); assert.equal(input.transactionId, subscription.transactionId); assert.equal(input.episodeLimit, 2);
    const key = `${input.accountId}:${input.transactionId}:${input.episodeId}`;
    if (reserved.has(key)) return "already_reserved";
    if (reserved.size >= input.episodeLimit) return "exhausted";
    reserved.add(key); return "reserved";
  } };
  await Promise.all([reserveMobileEpisode(subscription, "episode-one", 2, repo, now), reserveMobileEpisode(subscription, "episode-one", 2, repo, now)]);
  await reserveMobileEpisode(subscription, "episode-two", 2, repo, now);
  await assert.rejects(reserveMobileEpisode(subscription, "episode-three", 2, repo, now), errorCode("quota"));
  assert.equal(reserved.size, 2);
  await assert.rejects(reserveMobileEpisode(subscription, "episode-four", 2, { async reserveEpisode() { return "inactive"; } }, now), errorCode("inactive"));
});

test("malformed structural entitlements, account records and clocks cannot reach repositories", async () => {
  const subscription = await entitlement(); let calls = 0;
  const repo: EpisodeAllowanceRepository = { async reserveEpisode() { calls++; return "reserved"; } };
  for (const patch of [{ periodStart: NaN }, { periodEnd: NaN }, { checkedAt: NaN }, { periodEnd: undefined },
    { periodStart: 1.5 }, { periodStart: now + 1001 }, { accountId: "" }, { appAccountToken: "wrong" }, { transactionId: "wrong" }, { environment: "Xcode" }]) {
    await assert.rejects(reserveMobileEpisode({ ...subscription, ...patch } as VerifiedSubscription, "episode", 1, repo, now), errorCode("inactive"));
  }
  for (const nowMs of [NaN, Infinity, -1, 1.5]) {
    await assert.rejects(reserveMobileEpisode(subscription, "episode", 1, repo, nowMs), errorCode("configuration"));
    await assert.rejects(activateMobileSubscription(jws, account, configuration, verifier(), repository().repository, nowMs), errorCode("configuration"));
  }
  await assert.rejects(activateMobileSubscription(jws, { ...account, id: "" }, configuration, verifier(), repository().repository, now), errorCode("configuration"));
  assert.equal(calls, 0);
});
