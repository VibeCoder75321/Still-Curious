import type { MobileAccount } from "./auth.ts";

export class MobileSubscriptionError extends Error {
  readonly code: "configuration" | "verification" | "ownership" | "inactive" | "quota" | "unavailable";
  constructor(code: MobileSubscriptionError["code"]) {
    super(({ configuration: "Subscriptions are not configured.", verification: "The purchase could not be verified.", ownership: "This subscription belongs to a different account.",
      inactive: "An active subscription is required.", quota: "Your episode allowance for this subscription period is used.", unavailable: "Subscription verification is temporarily unavailable." })[code]);
    this.code = code;
  }
}

export type StoreEnvironment = "Production" | "Sandbox";
export type SubscriptionConfiguration = { bundleId: string; appAppleId: number; productId: string; environment: StoreEnvironment };
export type AppleSubscriptionTransaction = {
  bundleId?: string; productId?: string; environment?: string; type?: string; inAppOwnershipType?: string;
  appAccountToken?: string; transactionId?: string; originalTransactionId?: string;
  purchaseDate?: number; expiresDate?: number; signedDate?: number; revocationDate?: number;
};

/**
 * This is a SERVER dependency, not client-supplied claims. The deployment adapter MUST:
 * 1. Use Apple's App Store Server Library SignedDataVerifier with trusted Apple roots,
 *    the configured bundle ID/appAppleId/environment and online certificate checks.
 * 2. Verify the submitted JWS, query App Store Server API for CURRENT subscription status,
 *    and cryptographically verify the returned transaction and renewal JWS with that verifier.
 * 3. Return the current transaction for the same originalTransactionId, including revocations.
 * No decode-only fallback is implemented. Until this adapter exists, activation stays disabled.
 */
export interface AppleSubscriptionVerifier {
  verifyAndRefresh(signedTransaction: string): Promise<{
    verificationContext: SubscriptionConfiguration;
    transaction: AppleSubscriptionTransaction;
    state: "active" | "grace_period" | "billing_retry" | "expired" | "revoked";
    checkedAt: number;
  }>;
}

export type VerifiedSubscription = Readonly<{
  accountId: string; appAccountToken: string; bundleId: string; productId: string; environment: StoreEnvironment;
  transactionId: string; originalTransactionId: string; periodStart: number; periodEnd: number; checkedAt: number;
}>;

export interface SubscriptionRepository {
  /**
   * Atomic unique binding of (environment, originalTransactionId) to accountId.
   * Reject a different owner; preserve newer verified/revoked state and do not roll back
   * a renewal or revoke flag when an older activation acknowledgement arrives.
   */
  activate(subscription: VerifiedSubscription): Promise<"activated" | "different_owner" | "stale">;
}

function configured(config: SubscriptionConfiguration): boolean {
  return !!config && /^[A-Za-z0-9][A-Za-z0-9.-]{2,254}$/.test(config.bundleId) && /^[A-Za-z0-9][A-Za-z0-9._-]{2,254}$/.test(config.productId)
    && Number.isSafeInteger(config.appAppleId) && config.appAppleId > 0 && ["Production", "Sandbox"].includes(config.environment);
}
function timestamp(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value > 0; }
const identifier = (value: unknown): value is string => typeof value === "string" && /^[0-9]{1,40}$/.test(value);
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const accountId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 255 && value === value.trim();

/** Verify and persist before telling the iOS app to finish its StoreKit transaction. */
export async function activateMobileSubscription(signedTransaction: string, account: MobileAccount,
  config: SubscriptionConfiguration, verifier: AppleSubscriptionVerifier | undefined, repository: SubscriptionRepository,
  nowMs = Date.now()): Promise<VerifiedSubscription> {
  if (!configured(config) || !verifier || !repository || !timestamp(nowMs) || account?.active !== true || !accountId(account.id)
    || !uuid(account.appAccountToken) || !Number.isSafeInteger(account.sessionVersion) || account.sessionVersion < 0) throw new MobileSubscriptionError("configuration");
  if (typeof signedTransaction !== "string" || signedTransaction.length < 10 || signedTransaction.length > 32_768) throw new MobileSubscriptionError("verification");
  let result: Awaited<ReturnType<AppleSubscriptionVerifier["verifyAndRefresh"]>>;
  try { result = await verifier.verifyAndRefresh(signedTransaction); }
  catch { throw new MobileSubscriptionError("verification"); }
  const context = result?.verificationContext, tx = result?.transaction;
  if (!context || !tx || context.bundleId !== config.bundleId || context.appAppleId !== config.appAppleId || context.environment !== config.environment || context.productId !== config.productId
    || tx.bundleId !== config.bundleId || tx.productId !== config.productId || tx.environment !== config.environment
    || tx.type !== "Auto-Renewable Subscription" || tx.inAppOwnershipType !== "PURCHASED"
    || !identifier(tx.transactionId) || !identifier(tx.originalTransactionId) || !timestamp(tx.purchaseDate) || !timestamp(tx.expiresDate)
    || !timestamp(tx.signedDate) || tx.signedDate > nowMs + 60_000 || tx.purchaseDate > nowMs + 60_000 || tx.expiresDate <= tx.purchaseDate
    || !timestamp(result.checkedAt) || result.checkedAt > nowMs + 1000 || result.checkedAt < nowMs - 60_000) throw new MobileSubscriptionError("verification");
  if (!uuid(tx.appAccountToken) || tx.appAccountToken.toLowerCase() !== account.appAccountToken.toLowerCase()) throw new MobileSubscriptionError("ownership");
  // Grace periods/family sharing are deliberately disabled until their product policies are configured.
  if (result.state !== "active" || tx.revocationDate !== undefined || tx.expiresDate <= nowMs) throw new MobileSubscriptionError("inactive");
  const subscription: VerifiedSubscription = Object.freeze({ accountId: account.id, appAccountToken: account.appAccountToken.toLowerCase(), bundleId: config.bundleId,
    productId: config.productId, environment: config.environment, transactionId: tx.transactionId, originalTransactionId: tx.originalTransactionId,
    periodStart: tx.purchaseDate, periodEnd: tx.expiresDate, checkedAt: result.checkedAt });
  let saved: Awaited<ReturnType<SubscriptionRepository["activate"]>>;
  try { saved = await repository.activate(subscription); }
  catch { throw new MobileSubscriptionError("unavailable"); }
  if (saved === "different_owner") throw new MobileSubscriptionError("ownership");
  if (saved !== "activated") throw new MobileSubscriptionError("verification");
  return subscription;
}

export type EpisodeReservation = { accountId: string; environment: StoreEnvironment; originalTransactionId: string; transactionId: string;
  periodStart: number; periodEnd: number; episodeId: string; episodeLimit: number; nowMs: number };
export interface EpisodeAllowanceRepository {
  /**
   * In ONE atomic DB transaction, recheck account active, current nonrevoked entitlement,
   * renewal period and unique episode reservation, then reserve at most episodeLimit slots.
   * A repeated episodeId is idempotent ONLY for the same account and subscription period.
   * Provider-dollar budgets/reservations must additionally remain enforced by the generation pipeline.
   */
  reserveEpisode(input: EpisodeReservation): Promise<"reserved" | "already_reserved" | "exhausted" | "inactive">;
}

/** Call before any provider work, with a freshly server-verified subscription and server-owned plan limit. */
export async function reserveMobileEpisode(subscription: VerifiedSubscription, episodeId: string, configuredEpisodeLimit: number | undefined,
  repository: EpisodeAllowanceRepository, nowMs = Date.now()): Promise<void> {
  if (!Number.isSafeInteger(configuredEpisodeLimit) || (configuredEpisodeLimit ?? 0) < 1 || (configuredEpisodeLimit ?? 0) > 10_000 || !repository || !timestamp(nowMs)) throw new MobileSubscriptionError("configuration");
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(episodeId)) throw new MobileSubscriptionError("verification");
  if (!subscription || !accountId(subscription.accountId) || !uuid(subscription.appAccountToken)
    || !identifier(subscription.originalTransactionId) || !identifier(subscription.transactionId)
    || !["Production", "Sandbox"].includes(subscription.environment) || !timestamp(subscription.periodStart) || !timestamp(subscription.periodEnd)
    || !timestamp(subscription.checkedAt) || subscription.periodEnd <= subscription.periodStart
    || subscription.periodStart > nowMs + 1000 || subscription.periodEnd <= nowMs
    || subscription.checkedAt < nowMs - 60_000 || subscription.checkedAt > nowMs + 1000) throw new MobileSubscriptionError("inactive");
  let result: Awaited<ReturnType<EpisodeAllowanceRepository["reserveEpisode"]>>;
  try { result = await repository.reserveEpisode({ accountId: subscription.accountId, environment: subscription.environment,
    originalTransactionId: subscription.originalTransactionId, transactionId: subscription.transactionId, periodStart: subscription.periodStart,
    periodEnd: subscription.periodEnd, episodeId, episodeLimit: configuredEpisodeLimit!, nowMs }); }
  catch { throw new MobileSubscriptionError("unavailable"); }
  if (result === "exhausted") throw new MobileSubscriptionError("quota");
  if (result !== "reserved" && result !== "already_reserved") throw new MobileSubscriptionError("inactive");
}
