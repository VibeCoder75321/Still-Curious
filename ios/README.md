# Still Curious for iPhone

This directory starts the paid iPhone version. It is **not a submission-ready release**. Apple Developer enrollment, a working mobile account/billing backend, final subscription terms and device validation are release prerequisites. See [the release plan](../docs/app-store/release-plan.md).

## Current build

- Native SwiftUI listening library with the two existing bundled sample recordings.
- AVPlayer playback, speed and seek controls, saved listening positions, a sleep timer, background audio and lock-screen controls.
- StoreKit 2 subscription purchase/restore infrastructure. Purchase stays unavailable until a signed-in server account, confirmed subscription benefits, legal URLs and server entitlement activation are configured. There is no subscription price or episode allowance hardcoded in this project.
- A checked-in Xcode project and shared scheme. `scripts/generate_project.py` regenerates the project deterministically when source/resource files are added.
- An unsigned simulator build workflow in `.github/workflows/ios.yml`. A passing simulator build does not validate signing, purchases, real-device background playback or App Review acceptance.

The native Create screen is deliberately unavailable in this foundation. It does not bypass the existing web login, trust client-supplied identity headers, unlock paid generation from a local StoreKit flag, or send generation requests to a placeholder endpoint.

## Open and build on a Mac

Use a current Xcode release supported by App Store Connect. No CocoaPods, third-party project generator, Node installation or provider API keys are needed for the native listening build.

```sh
cd /path/to/Still-Curious
python3 ios/scripts/generate_project.py
open ios/StillCurious.xcodeproj
```

Choose the `StillCurious` scheme and an iPhone simulator, then Run. For command-line compilation:

```sh
xcodebuild -project ios/StillCurious.xcodeproj \
  -scheme StillCurious -configuration Debug \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO build
```

For a physical iPhone, select your signing team in Xcode and replace `com.example.StillCurious` with an identifier you register. Add the identifier and Sign in with Apple capability to the Apple account when implementing mobile sign-in. Never put an App Store Connect private key, signing certificate or provider key in the app bundle or repository.

## Configuration

`StillCurious/Info.plist` contains:

| Key | Required value before release |
| --- | --- |
| `StillCuriousServerOrigin` | The deployed HTTPS service origin with mobile authentication and entitlement endpoints. The current web origin alone is not a mobile API. |
| `StillCuriousSubscriptionProductID` | An App Store Connect auto-renewable subscription identifier. Empty disables product configuration. |
| `StillCuriousPrivacyURL` | A public, published privacy policy URL. |
| `StillCuriousTermsURL` | Published subscription terms/EULA URL. |
| `StillCuriousSupportURL` | A working public support page with a contact method. |

The StoreKit account token must be a stable UUID issued by your server for the signed-in account. It must not be chosen by the client, an email address or the Apple identity token. A transaction is finished only after the configured server activation handler acknowledges it. The server must cryptographically verify Apple transaction data, bind it to that account, enforce the paid plan and handle refunds/expiration; local verification alone cannot authorize provider spending.

## Privacy manifest

The current native foundation saves playback preferences on the device using UserDefaults; the privacy manifest declares that required-reason API use. The collected-data list currently covers this offline listening foundation only. Update it and App Store Connect disclosures when account, purchase, episode-generation or analytics data flows are connected. See the release plan for the full planned data inventory.

## Required device checks

Test a full recording with the device locked; pause/resume from Control Center and headphones; audio interruptions (calls, alarms, Siri); unplugged headphones; speed changes; resuming after relaunch; and sleep-timer expiration while locked. Confirm that the app does not activate a playback audio session merely by opening the library. Verify VoiceOver, Dynamic Type and narrow-screen layouts.

Use StoreKit Testing followed by Apple sandbox/TestFlight to test purchase, cancellation, pending approval, restore on another device, renewal, expiration, refunds, account changes, server outages and replayed transactions. Do not sell subscriptions until creation, allowance enforcement, legal disclosures and deletion work end to end.
