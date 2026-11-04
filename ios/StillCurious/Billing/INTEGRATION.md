# StoreKit integration status

The iPhone client implements product loading, auto-renewable subscription
purchase, restore, transaction updates, unfinished-transaction recovery and
Apple's subscription-management sheet. It does not make a product purchasable
until a signed-in account, backend verification handler, plan benefits and
HTTPS legal URLs are configured. No price or episode allowance is hardcoded.

This is a client foundation. The backend purchase-verification and paid episode
allowance service is a required release dependency, not an implemented service.
Do not submit a build with an unavailable membership or creation feature.

## Connect a verified account

After the app's backend has authenticated the user, it must return a stable,
server-owned UUID for `appAccountToken` and a description of the actual plan's
episode allowance and duration restrictions. For example, wire its configured
API client into:

```swift
subscriptions.configureAccount(
    accountToken: account.appAccountToken,
    planSummary: account.planSummary
) { verification in
    try await api.verifySubscription(verification)
}
```

`api` and `account` above denote the required authenticated backend integration;
they are not provided by these billing files. Call `clearAccount()` on sign-out
or account change. The handler must reject an expired login and must never
trust a user identifier or entitlement submitted by the client.

The handler receives Apple's signed transaction JWS and transaction identifiers.
The server must verify the Apple trust chain/signature, configured bundle and
product, production versus sandbox environment, stable account binding,
expiration, revocation and refund status. It must persist the transaction
idempotently and return the account's current entitlement and allowance before
the handler returns successfully. Account changes invalidate in-flight client
responses. Failed verification leaves Apple's transaction unfinished for retry.

The response type is `SubscriptionEntitlement`. Configure the API decoder's date
strategy to match the server's expiration representation; use a documented UTC
format consistently. `remainingEpisodes` is display information. Every episode
creation or resume request must independently check access and atomically
reserve the appropriate server allowance. A local StoreKit verification result
is not sufficient to authorize provider spending.

## Release validation on a Mac and iPhone

Use Xcode StoreKit testing and Apple's sandbox/TestFlight to exercise successful,
cancelled, pending and declined purchases; refund/revocation and expiration;
restore after reinstall; a purchase interrupted before backend acknowledgment;
duplicate transaction delivery; sign-out during verification; and a transaction
belonging to another Still Curious account. Verify the server never grants an
allowance twice and creation cannot bypass its quota. Product display price and
billing period must come from StoreKit, with the server-confirmed episode
allowance displayed before confirmation.

No Xcode/device purchase tests have been run in the Linux development
environment. A developer membership, configured products and a real mobile
account service remain prerequisites for a paid release.
