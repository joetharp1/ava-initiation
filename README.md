# Ava Initiation 0.1.4

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
- Quiet hours, overnight wake coalescing, draft/busy deferral and per-chat state. Fire now bypasses quiet hours, failure backoff and the unanswered wait, but respects drafts, competing generation and budgets.
- Photos: at most two charged attempts per local day across allowlisted characters in this browser profile; default daily cap $0.12. Reservations use the greater of $0.06 and the selected model's catalogue price. Ambiguous failures remain charged against this local budget. Text continues when photos reach either cap.
- Web Locks plus an expiring localStorage lease prevent duplicate attempts across windows. Unsupported Web Locks pause initiation with a visible reason.
- 150-second attempt deadline and bounded backoff. Log retains 200 records; context history is token-capped.
- Normal ST-owned context, including World Info/state trackers. Model-invoked tools are suppressed for initiations; the saved function-calling setting stays unchanged.
- Full-text or generic notifications, per-chat replacement tags and an unread badge fallback. The notification worker has its own directory scope; no caching, push service or offline shell.

The PWA must remain open. Android may suspend it in the background; on return, Ava delivers at most one eligible missed initiation and records the rest as missed. This is not a server-side messaging service.

## Live smoke-test fixes in 0.1.4

- Reasoning token budgets: photo 800, normal text 700, sulk 400. Existing visible text/scene length caps remain.
- Unusable model output includes the JSON-serialized raw Generate return value, capped at 1,000 characters, in the saved failure record. This is what ST returned to Ava; it is not a full provider HTTP response or hidden reasoning trace.
- Fire now bypasses failure backoff once. If that attempt fails, automatic ticks still back off; drafts, locks, generation and budgets remain enforced.
- Notification setup awaits this extension's worker activation with a 15-second timeout. Permission denial, registration/activation failure and success have separate statuses. A Notification diagnostics section and console messages record permission, registration, activation and display results.
- On enable, `navigator.serviceWorker.ready` is observed independently, including resolved/rejected or still-pending after 10 seconds. It is diagnostic only: that promise concerns a page-associated registration and can remain pending outside Ava's own directory scope. It does not gate Ava's worker activation. Reference: https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/ready

## Reviewed fixes in 0.1.2

Preset body parameters are merged, delivery reconciliation is guarded, fenced JSON/plain-prose fallback is supported, and the granted-permission notification path is covered. ST's `jsonSchema.returnInvalid` is enabled so fallback receives the provider's original text. Version 0.1.3 adds only scoped field styling and standard SillyTavern input classes so number/time values remain readable on mobile. Scheduling and generation logic are unchanged.

SHA-256 `index.js`: `4dd8f28bf33281f63c7c9b43bba433f9a9d6d3fd98a7f90148356cee66859b0e`.

## Validation

The combined suite passes 108 Node checks, including manual retry/backoff, raw-output bounds, reasoning budgets, worker activation/failure and ready diagnostics. This repository carries the scheduler/adapter/worker tests; bridge tests are in the bridge repository. Run `npm test` with Node 22+. Set `ST_SCRIPT` to a verified ST 1.19.0 `public/script.js` to run the source-contract check; otherwise it explicitly skips.

The development-only Playwright browser harness checks mobile layouts, drafts, denied-permission badges and page-to-worker notification delivery. It uses a controlled permission grant and a `showNotification` spy on the real module worker. Native Android notification display/click and real provider output need live smoke checks. No paid requests were used in automated testing. Playwright is not an extension dependency.

## Deferred follow-ups

The reviewed release retains the five-second storage write, `pagehide` cancellation, the `isGenerating()` check in `GENERATION_AFTER_COMMANDS`, and the bridge's combined busy/configuration readiness status.
