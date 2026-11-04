# Listening library and Now Playing

Updated 16 October 2026 at the user's request. The private Site audience, API credentials, voice mapping, generation prompts and factual/recovery safeguards are unchanged.

## Listening experience

The free library presents each recording as an article tile with a separate title, short overview and measured length. Tiles contain a Listen button and no embedded player, speed selector or timer. The library contains the 5:06 opening of Making the Same Drug a Different Way, labeled an opening excerpt and preserving its exact approved audio. The retired Wayfinding tile, public audio and transcript have been removed. The 31-second voice preview remains available from Make your own and is not represented as a full episode.

Selection opens one clearly labeled Now Playing section. Free episodes, saved private episodes, generation auditions and the voice preview share the same HTML audio element. Its speed choices, in order, are 1.2, 1, 0.9, 0.8, 0.7 and 0.6. The speed is remembered; switching recordings clears the sleep timer. The timer can wait for playback to start, and stops playback when it expires. All source-note UI is named Reading List. It displays the selected recording's supplied bibliography and existing private research/transcript exports; no new sources or claims are invented. Inline V2 bibliography metadata is exposed without preparation notes or private execution details.

Make your own sits immediately below the library and above Now Playing in both document order and navigation, offering a topic, five/fifteen-minute length and optional text-only or voice-preview choices. A completed custom episode can be brought to Now Playing. Background generation updates do not interrupt an independently selected free recording. Saved tiles also contain metadata and a selection button, sharing the same player.

The layout retains the forest, sage and warm-gold identity, with responsive gallery cards, separate sections, keyboard-accessible controls, live status text and reduced-motion scrolling. `client/index.html` remains the sole page source; the removed legacy static index cannot shadow it.

## Hidden production limits

There are no spending-limit or audio-allowance fields, hidden inputs, editable amounts or API-price labels in the interface. The normal creation request omits dollar values. The server supplies the fixed $5 episode ceiling and reserves $1.50 inside it for audio. Explicit older API requests may preserve a smaller cap or an unstarted project, but cannot raise a cap above $5. Starting an unbudgeted saved project uses the server default; audio authorization computes its allowance from the existing cap and settled reservations without increasing it.

Both creation and budget controls reject amounts above $5. Advance/control routes refuse further paid work on older V2 authorizations above that ceiling; cancellation remains available. New legacy V1 creation and its unbudgeted paid advance are blocked, while existing V1 recordings remain readable and playable. The provider ledger still reserves before submission, enforces the shared ceiling and holds unknown results without automatic resynthesis. Hiding the controls does not hide or remove server-side safeguards.

## Verification

214 TypeScript tests pass, including the actual shipped browser script in a DOM harness. Coverage includes all catalog tiles, separate metadata, no tile media/settings, one shared player, exact speed options, speed persistence, timer expiry and reset, metadata duration, no generation from selection, saved/private playback, literal text/XSS handling, uninterrupted playback during progress updates, explicit controls, no retry after unknown acknowledgement, creation without amounts and server-side cap enforcement. TypeScript, both browser-script syntax checks and whitespace checks pass. The pharmaceutical library MP3 hash equals the approved audition hash; measured recording durations are retained in the catalog.

Managed browser/visual QA is unavailable because the required control-browser skill is not exposed. No substitute browser automation path or new paid generation was used. Publication includes a production build and private HTTP verification of the new HTML/JavaScript/catalog and audio availability. Real-device playback and visual inspection remain unverified.

## Saved-history reset and sharing

At the user's request, the three existing pilot IDs are archived from the Your episodes listing through `lib/episode-v2/library-history.ts`. All three were inactive when checked. Their underlying owned database records and stored audio are preserved, and the existing ownership checks still govern direct access. The browser drops the old v1 saved-job cache and uses a fresh v2 cache; speed preferences are retained. New episodes and other users' episodes are unaffected. This avoids deleting production records or creating a new administrative write endpoint.

The Site remains owner-private. A copied link alone does not grant another person access. If the owner grants someone Site access, they receive the packaged free library and its recordings, but Your episodes and generated audio remain scoped to each authenticated visitor. No sharing policy was changed.
