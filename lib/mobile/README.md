# Mobile server foundation — not a deployed mobile API

These helpers do not change the existing web app's identity, invitation allowances, routes or provider spending. There is no public mobile sign-in/purchase endpoint yet. Native purchases and creation must stay unavailable until the deployment below is implemented and tested.

`auth.ts` verifies native Sign in with Apple identity tokens using Apple's fixed HTTPS JWKS endpoint and RS256 signatures. A deployment must issue a cryptographically random, expiring challenge, save its SHA-256 nonce hash, and atomically consume it exactly once after identity verification. Map the verified Apple subject to a server-owned account and stable random `appAccountToken`; never accept account IDs or platform identity headers as proof. Rate-limit challenge and verification endpoints. The helpers intentionally retain neither email nor name.

Mobile sessions use a separate, randomly generated base64url secret containing at least 32 random bytes. The deployment must store identity/account/session-version records durably, load the account on every authenticated request and keep session tokens in the iOS Keychain. Deletion, Apple authorization revocation and logout-all must deactivate the account or increment its session version. A route must reject credentials on insecure transport, redact them from logs and never forward client-supplied `oai-authenticated-user-*` headers into the web API.

`subscriptions.ts` intentionally has no decode-only StoreKit path. Its injected server verifier must use Apple's official App Store Server Library `SignedDataVerifier` with authentic Apple root certificates, configured bundle identifier, numeric App Store application ID, environment and online certificate checks. It must verify the supplied JWS, retrieve current subscription status through the authenticated App Store Server API, verify Apple's returned transaction/renewal JWS and return the current transaction for the same original transaction. Signed-but-old transactions alone do not establish that a subscription remains unrefunded. Production must reject Sandbox purchases. No verifier means no activation.

Before returning activation success, persist a unique `(environment, originalTransactionId)` account binding and current subscription state atomically. Prevent ownership transfers, stale activation rollback and resurrection after refund/revocation. Process and verify App Store Server Notifications V2 idempotently, including renewals, refunds, revocations and expiration; periodically reconcile status. Only an acknowledged server activation permits the client to finish its StoreKit transaction. Restore must use the same account-bound verification path.

Episode quota is a server-configured number per verified renewal period; there is no default or invented subscription price/allowance. Implement `EpisodeAllowanceRepository.reserveEpisode` with an atomic database transaction that rechecks the current entitlement and reserves an idempotent episode slot before paid provider work. Keep existing provider-dollar ceilings and ambiguity reservations. The current web invitation budget is not this monthly quota; wire a separate, authenticated mobile policy through all create/advance/resume/audio authorization and background scheduler paths before enabling mobile creation. Never merely exempt mobile callers from the web allowance.

Still required before deployment:

- Apple Developer enrollment, final bundle ID/App Store app ID, Sign in with Apple capability and verified associated configuration.
- A configured StoreKit product/subscription group, chosen pricing and episode allowance, plus App Store Server API key/issuer/key ID delivered as server-only secrets.
- Authentic Apple certificate roots and an implemented official-library verifier/current-status adapter.
- Durable accounts, single-use challenges, subscription ownership, notification reconciliation, atomic quota tables and authenticated mobile endpoints.
- Account deletion (including retained job/artifact/audio cleanup and Apple authorization revocation), privacy/support/terms pages, and explicit consent before sending topics/scripts to AI providers.
- Integration/device/Sandbox/StoreKit testing. Offline helper tests do not establish Apple-service compatibility or App Review acceptance.
