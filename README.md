# Ava Initiation 0.1.8 — diagnostic hold

Unprompted character messages for SillyTavern 1.19.0. Client-side, no build step or external runtime dependencies. The two runtime files are `manifest.json` and `index.js`.

## Diagnostic run (0.1.8)

**This is a diagnostic-only release. Ordinary timers and Fire now are held. The prompt role, wording and temperature have NOT been fixed yet.** The user requested two logged attempts before any behavioural change.

1. Update this extension and reload SillyTavern. Select Ava's original chat and leave the composer empty. Enable initiations and Allow Ava must still be on for the diagnostic to run.
2. Press **Run two diagnostic attempts** once. It performs at most two text-only attempts, then remains held. Drafts and competing generation still defer. A failed attempt consumes its slot; deferral before generation does not. No image credit is used.
3. Press **Copy diagnostic report** and send the report for review. Do not add more tests while reviewing. The quota and report survive reloads and apply across tabs in the same browser profile. No reset/resume button is provided in this diagnostic build.

Each capture occurs at the actual browser `fetch` POST to `/api/backends/chat-completions/generate`, after request-settings listeners have run. The report contains every message's role and first 120 text characters, the instruction's presence/indices/role, final role, configured/default continue or impersonation nudge text matches and their position relative to the instruction, temperature/custom override flags, and assistant prefill. Images and full request payloads are not copied. An earlier prompt-assembly snapshot shows whether matching nudge text appeared later. Nudge text matching alone does not prove which extension authored it. This boundary is the browser-to-ST request, not the later ST-to-provider request.

The two attempts also record recent-history entry counts and the returned text's first 120 characters plus SHA-256, allowing exact output equality to be checked. Diagnostic context excerpts stay in localStorage and the console until explicitly copied; they are not sent via Telegram, placed in the model prompt or published to GitHub.

Source inspection of the verified stock 1.19.0 `openai.js` shows its continue nudge is conditional on `type === 'continue'`; Ava calls `Generate('normal', ...)`. Thus the proposed late-nudge cause is **not confirmed** from source inspection. Synthetic tests cover both absent and late nudges. Only the two live reports can establish this install's final ordering.

The normal behaviour below describes the engine outside this temporary diagnostic hold.

## Install

1. Update **Venice Image Bridge** to **0.5.0** using SillyTavern's extension Update button (needed for photos).
2. In **Extensions → Install extension**, paste `https://github.com/joetharp1/ava-initiation` and install.
3. Reload SillyTavern. Open the character's chat, then **Extensions → Ava Initiation**.
4. Allow the selected character, then enable Ava. Set intervals and quiet hours. **Run two diagnostic attempts** is the only generation action in this diagnostic release.

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
- Optional browser and Telegram notifications, full-text or generic previews, and an unread badge fallback. Browser notifications replace by chat; Telegram sends a separate notification message for each initiation. The optional worker has its own directory scope; no caching, push service or offline shell.

The PWA or browser tab must remain open. Android may suspend it in the background; on return, Ava delivers at most one eligible missed initiation and records the rest as missed. This is not a server-side messaging service.

## Message formatting in 0.1.5

The initiation instruction explicitly says: "Do not include a name or timestamp header, just the message body." Visible message metadata uses one browser `Date.now()` value for both `send_date` and the initiation timestamp; it does not copy dates or times generated by the model. Earlier versions already sourced `send_date` from the browser clock. This revision makes the two fields identical and tests them against the browser clock.

## Telegram and protected sites in 0.1.7

Server authentication is unchanged. Hostinger confirmed runtime basic auth but could not read the live config or confirm support for `basicAuthExcludePaths`; this release does not claim that setting was inspected or modify it. Telegram is an independent, optional notification route.

### Set up Telegram

1. In Telegram, open the official [@BotFather](https://t.me/BotFather), send `/newbot`, and follow its name/username prompts. Copy the token into **Ava Initiation → Telegram bot token**.
2. Open your new bot's chat, press **Start**, and send it a short message such as `hello`.
3. In your browser, open `https://api.telegram.org/botYOUR_TOKEN/getUpdates`, replacing `YOUR_TOKEN` with the token. Keep `bot` immediately before it. Under your message, find `message.chat.id` (not `update_id` or the bot's ID). Copy that number into **Telegram chat ID**. If `result` is empty, send the bot another message and refresh. Use a new bot without a webhook for this setup.
4. Enable **Telegram notifications** and press **Send test**. The API response appears beneath the button exactly as received. `"ok":true` means Telegram accepted the message. A 400 `chat not found` can mean the ID is wrong or you have not started the bot; a 401 `Unauthorized` usually means the token is wrong.
5. Choose **Ava only** or **Full message**. Configure Telegram's app passcode and per-chat notification previews yourself if desired; this extension does not enable either setting.

Do not share the token or the token-bearing URL. The token and chat ID are saved in SillyTavern's extension settings. The token is masked in the UI and excluded from the scheduler database, chat, prompts and ordinary diagnostics. Settings are not encrypted secret storage. Existing 0.1.6 browser-local tokens migrate to extension settings; the old copy is removed after a later load sees the saved token. Clear the token field and leave it to remove it.

**Ava only** sends exactly `Ava`. **Full message** sends up to 200 Unicode characters. Both use `disable_notification=false`: sound is allowed and Telegram/phone settings decide how it is presented. Link previews and message markup parsing are off. API references: https://core.telegram.org/bots/api#sendmessage and https://core.telegram.org/bots/api#getupdates

**Send test** sends a fixed test message (or `Ava` in generic mode) without generating a character response, adding a chat turn, changing timers or spending photo credit. It displays the exact API body as plain text, including setup failures. The raw response is not saved to the initiation log or sent to the model.

Delivery uses a direct browser POST with a 10-second timeout per request, no cookies or referrer. There are at most **two retries** (three requests total) for explicit 429/server failures, with a one/two-second backoff and `retry_after` respected up to ten seconds. Longer cooldowns stop this notification attempt rather than retry early or hold the engine open. 400/401 and ambiguous network/timeouts do not retry. Failures are logged in Notification diagnostics and keep the delivered chat message and unread badge intact. Automated tests mock Telegram; real bot delivery still requires a configured live smoke test.

When both token and chat ID are present, worker setup is skipped entirely, even if the browser-notifications option is on. Without Telegram credentials, browser notifications remain optional and default off. A blocked worker is an informational unavailable status, not a setup-error banner. The unread badge is always kept. Telegram does not keep a suspended or closed client generating messages.

## Live smoke-test fixes in 0.1.4

- Reasoning token budgets: photo 800, normal text 700, sulk 400. Existing visible text/scene length caps remain.
- Unusable model output includes the JSON-serialized raw Generate return value, capped at 1,000 characters, in the saved failure record. This is what ST returned to Ava; it is not a full provider HTTP response or hidden reasoning trace.
- Fire now bypasses failure backoff once. If that attempt fails, automatic ticks still back off; drafts, locks, generation and budgets remain enforced.
- Notification setup awaits this extension's worker activation with a 15-second timeout. Permission denial, registration/activation failure and success have separate statuses. A Notification diagnostics section and console messages record permission, registration, activation and display results.
- On enable, `navigator.serviceWorker.ready` is observed independently, including resolved/rejected or still-pending after 10 seconds. It is diagnostic only: that promise concerns a page-associated registration and can remain pending outside Ava's own directory scope. It does not gate Ava's worker activation. Reference: https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/ready

## Reviewed fixes in 0.1.2

Preset body parameters are merged, delivery reconciliation is guarded, fenced JSON/plain-prose fallback is supported, and the granted-permission notification path is covered. ST's `jsonSchema.returnInvalid` is enabled so fallback receives the provider's original text. Version 0.1.3 adds only scoped field styling and standard SillyTavern input classes so number/time values remain readable on mobile. Scheduling and generation logic are unchanged.

SHA-256 `index.js`: `7717e9e0e09f2bb63e926c3c7495f5c688587ebc1372bd57c32f63d01ff1cca9`.

## Validation

The combined suite passes 132 Node checks, including manual retry/backoff, raw-output bounds, reasoning budgets, worker activation/failure and ready diagnostics. This repository carries the scheduler/adapter/worker tests; bridge tests are in the bridge repository. Run `npm test` with Node 22+. Set `ST_SCRIPT` to a verified ST 1.19.0 `public/script.js` to run the source-contract check; otherwise it explicitly skips.

The current development-only Playwright harness checks the actual page fetch boundary with two synthetic responses, captures a deliberately late nudge, verifies unchanged role/temperature and history injection, detects identical outputs, restores fetch/settings, and enforces the two-attempt hold across reloads and tabs. It also checks draft protection, text-only selection, report copying and mobile widths of 320/393/709/1024 pixels. These fixtures are not evidence of live installation behaviour. Version 0.1.7 previously passed the Telegram/notification browser harness; Telegram retry/error and worker behaviour remain covered by Node tests. No paid provider calls were used. Playwright is not an extension dependency.

## Deferred follow-ups

The reviewed release retains the five-second storage write, `pagehide` cancellation, the `isGenerating()` check in `GENERATION_AFTER_COMMANDS`, and the bridge's combined busy/configuration readiness status.
