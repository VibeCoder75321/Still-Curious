# Paid iPhone release plan

Status: native listening and subscription foundation under development; **not submitted to Apple**. The developer does not yet have a confirmed Apple Developer Program membership. This repository is not evidence of enrollment, signed builds or App Review approval.

## Release prerequisites

1. Enroll through [Apple Developer](https://developer.apple.com/programs/enroll/) as the person or organization that should own the app. Complete Apple’s identity verification and any required agreements. Use an Apple account controlled by the owner; never share its password, two-factor codes or signing private keys in chat.
2. Register a permanent bundle identifier, configure signing and enable Sign in with Apple. The native project's `com.example.StillCurious` is a placeholder.
3. Create the App Store Connect app record and subscription group/product. Complete applicable paid-app agreements, banking and tax steps. Select pricing, billing period, episode allowance and supported territories after measuring generation cost. The existing $5 per-episode provider-spend cap and invitation allowance are **not** customer subscription entitlements or retail prices.
4. Deploy and validate mobile account/session, transaction verification and subscription usage services before activating purchases. Server-side credentials remain outside the iPhone app.
5. Publish support, privacy and subscription terms pages; provide account/data deletion; and complete the data disclosures for the actual release build.
6. Compile with a supported Xcode/SDK, test on an iPhone and use TestFlight before submitting. Verify current SDK and screenshot requirements in App Store Connect; they are not fixed by this document.

## Mobile/backend integration still required

The existing browser APIs trust identity headers injected by ChatGPT hosting and require same-origin mutations. A native client must never forge those headers or simply relax origin checks. The `lib/mobile` work provides verifiable building blocks, not a deployed login or billing API.

- **Identity:** Sign in with Apple nonce handling and server verification of issuer, audience, expiry and signature. Issue revocable server sessions; create a stable, server-owned app-account UUID. Plan account linking explicitly: a new Apple sign-in does not automatically own a pre-existing ChatGPT account's episodes.
- **Entitlements:** Verify StoreKit signed transactions using Apple's supported certificate chain/trusted verifier. Match bundle, app, product, environment and app-account token; record original transaction ownership atomically. Handle renewals, billing retry/grace rules, refunds and revocation, and process App Store Server Notifications with duplicate/replay protection. Client-provided transaction fields or decoded unsigned payloads are not authoritative.
- **Creation:** Map an active entitlement to a configured episode allowance per billing period. Reserve quota atomically before provider spending, handle retry idempotency and uncertain provider results, and define what happens to unfinished jobs after cancellation or expiry. Existing invitation holds must not silently substitute for the paid allowance. Paid access is not an unlimited provider budget.
- **Playback:** Give the native player account-authorized audio access with byte-range support. Avoid putting long-lived session tokens in audio URLs; test short-lived playback authorization and refresh behavior.
- **Deletion:** In-app account deletion must revoke sessions, stop future creation safely, address active jobs/reservations, and remove owned database/object-storage data according to the published policy. Archive preserves data and is not deletion. Direct users to Apple's subscription management because deleting an account must not be represented as cancelling their Apple subscription.
- **Consent:** Explain AI generation and third-party processing before sending topics/scripts to providers. Confirm required disclosures and consent against current Apple guidelines for the final flow.

## Privacy inventory for the planned paid release

| Data | Existing or planned use/location | Release work |
| --- | --- | --- |
| Account identifier; email/name if requested | Existing hosting identity; proposed Apple account/session backend | Minimize requested fields; document linking, retention and deletion. |
| Purchase and subscription identifiers | Planned server entitlement records and StoreKit | Bind ownership, minimize retention and declare actual use in App Store Connect. |
| Topic and user-generated content | D1 job state; prompts sent to OpenAI | Explain generation processing; specify retention and deletion behavior. |
| Scripts, source research and audio | D1/R2; scripts sent to ElevenLabs for speech | Include generated content and provider disclosures. |
| Usage, job progress and provider request IDs | Durable recovery/accounting records | Document operational retention and limits to immediate erasure. |
| Listening position and playback preferences | Device-only UserDefaults in the native foundation | Allow reset; declare required-reason API use. |

The current OpenAI adapter uses `store: true` for response recovery. Do not publish a privacy promise that no provider stores content or that deletion instantly erases every provider record. Provider retention and the app's actual configuration must inform the final policy. Do not claim “Data Not Collected” for a paid account/generation release merely because the offline native foundation has an empty collected-data list.

## App Review preparation

- Finished icon and screenshots captured from the actual supported iPhone build.
- Substantial usable content and working core features; the current public library contains two short recordings, not a complete subscription catalogue.
- A reviewer-accessible sign-in/creation path and instructions that do not depend on invitation-only access or the owner approving a paid generation request manually.
- Clear subscription benefits, localized price/period, renewal terms, restore purchases, subscription management, privacy policy and terms.
- Account/data deletion, cancellation instructions and a working support contact.
- Accurate age rating, AI-content disclosure, privacy responses and export-compliance answers for the actual app.

Official references to verify before submission:

- [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [App privacy details](https://developer.apple.com/app-store/app-privacy-details/)
- [Account deletion](https://developer.apple.com/support/offering-account-deletion-in-your-app/)
- [Subscriptions](https://developer.apple.com/app-store/subscriptions/)
- [StoreKit](https://developer.apple.com/documentation/storekit)

## Validation record

Linux can run the existing TypeScript/Python suites, type checking and web build. SwiftUI, AVFoundation, StoreKit, signing, simulator/device execution and App Store submission require macOS/Xcode or Apple services. The macOS CI workflow must run successfully; its presence is not a passed build. Record those results and physical-device listening/purchase checks before describing the iPhone app as ready.
