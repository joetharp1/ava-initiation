# Ava Initiation 0.1.3

Unprompted character messages for SillyTavern 1.19.0. Client-side, no build step or external runtime dependencies. The two runtime files are `manifest.json` and `index.js`.

## Install

1. Update **Venice Image Bridge** to **0.5.0** using SillyTavern's extension Update button (needed for photos).
2. In **Extensions → Install extension**, paste `https://github.com/joetharp1/ava-initiation` and install.
3. Reload SillyTavern. Open the character's chat, then **Extensions → Ava Initiation**.
4. Allow the selected character, then enable Ava. Set intervals and quiet hours. **Fire now** runs a manual test.

Ava starts disabled, and each character must be allowed separately. Only the currently selected one-to-one chat is scheduled. Existing Venice keys, reference portraits and image settings are reused.

## Behaviour

- Random types: photo, question, complaint, demand, one-liner; no consecutive repeated type.
- One visible text message, or one caption-free reference photo. No visible user turn or automatic continuation.
- After an unanswered initiation, one shorter, sharper text can follow at 25 minutes; then wait for a reply.
- Quiet hours, overnight wake coalescing, draft/busy deferral and per-chat state. Fire now bypasses quiet hours and the unanswered wait, but respects drafts, competing generation and budgets.
- Photos: at most two charged attempts per local day across allowlisted characters in this browser profile; default daily cap $0.12. Reservations use the greater of $0.06 and the selected model's catalogue price. Ambiguous failures remain charged against this local budget. Text continues when photos reach either cap.
- Web Locks plus an expiring localStorage lease prevent duplicate attempts across windows. Unsupported Web Locks pause initiation with a visible reason.
- 150-second attempt deadline and bounded backoff. Log retains 200 records; context history is token-capped.
- Normal ST-owned context, including World Info/state trackers. Model-invoked tools are suppressed for initiations; the saved function-calling setting stays unchanged.
- Full-text or generic notifications, per-chat replacement tags and an unread badge fallback. The notification worker has its own directory scope; no caching, push service or offline shell.

The PWA must remain open. Android may suspend it in the background; on return, Ava delivers at most one eligible missed initiation and records the rest as missed. This is not a server-side messaging service.

## Reviewed fixes in 0.1.2

Preset body parameters are merged, delivery reconciliation is guarded, fenced JSON/plain-prose fallback is supported, and the granted-permission notification path is covered. ST's `jsonSchema.returnInvalid` is enabled so fallback receives the provider's original text. Version 0.1.3 adds only scoped field styling and standard SillyTavern input classes so number/time values remain readable on mobile. Scheduling and generation logic are unchanged.

SHA-256 `index.js`: `ad345800ac8762ced1950dbf45a7399a23f857c8aa830880984b44ea1f6b1df0`.

## Validation

The combined review suite passed 99 Node checks. This repository carries the scheduler/adapter/worker tests; bridge tests are in the bridge repository. Run `npm test` with Node 22+. Set `ST_SCRIPT` to a verified ST 1.19.0 `public/script.js` to run the source-contract check; otherwise it explicitly skips.

The development-only Playwright browser harness checks mobile layouts, drafts, denied-permission badges and page-to-worker notification delivery. It uses a controlled permission grant and a `showNotification` spy on the real module worker. Native Android notification display/click and real provider output need live smoke checks. No paid requests were used in automated testing. Playwright is not an extension dependency.

## Deferred follow-ups

The reviewed release retains the five-second storage write, `pagehide` cancellation, the `isGenerating()` check in `GENERATION_AFTER_COMMANDS`, and the bridge's combined busy/configuration readiness status.
