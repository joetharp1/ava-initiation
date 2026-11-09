# Ava Initiation 0.1.14

Unprompted character messages for SillyTavern 1.19.0. Client-side, no build step or external runtime dependencies. The two runtime files are `manifest.json` and `index.js`.

## Fresh task after a completed exchange (0.1.14)

The private generation now retains the last assistant reply in ST's assembled context. Removing it in 0.1.12–0.1.13 could leave the preceding user message looking unanswered, encouraging a new version of the same answer.

A request-only user-role task follows the completed exchange. It explicitly identifies itself as a private initiation task, states that no new user message arrived, and asks for a fresh subject or present-moment invitation instead of answering the old user turn again. It is never inserted into the saved or visible transcript. This replaces the previous trailing-system placement. The exact supplied repetition sentence remains unchanged; character cards, inherited temperature, normal user turns and existing World Info are untouched. The private photo-scene task also uses this request-only placement and retains the opening line in context.

The 0.1.13 server verification, stale-tab protection, repeat retry limit and notification safeguards remain. Validation: 115 Node tests passed with the ST 1.19 source-contract check enabled. New integration cases run the opening/adapter pipeline to verify completed history, final task role, absence of a saved synthetic user turn, tool/multimodal history preservation and hook cleanup before ordinary replies. These tests verify request construction, not live model creativity. The browser harness remains unrun here because Chromium startup is blocked. No live paid generation was performed. Update, reload, check the panel says 0.1.14 and use Fire now once in the intended chat.

## Verified delivery and repeat protection (0.1.13)

- Rejects punctuation/quote-only copies and close word edits of the last eight assistant messages. One fresh generation is allowed; a second repeat fails visibly without posting or notifying. This is a similarity check, not a guarantee against every semantic paraphrase. The existing fixed instruction, system role and inherited temperature are preserved.
- Reads the selected chat from ST before generation and compares it with local history. A stale tab is held with a reload instruction instead of writing over newer server history.
- Checks `/api/chats/get` after each publication for the exact attempt ID, text and image URL, including the photo's opening line. ST's save methods can swallow errors; their return alone is no longer proof of delivery. Telegram follows verified publication.
- If a local message has an unconfirmed save, holds that attempt and rechecks once a minute without generating a replacement. A later confirmed save can notify once. If confirmation continues to fail, reload the chat to inspect the server copy; no forced save or transcript deletion is performed.
- Remembers the most recently selected visible chat across tabs in the same browser profile. Older tabs cannot initiate into a previously selected chat. Separate browsers/devices are not coordinated by this local selection record.
- Shows version 0.1.13 in the panel heading.

Validation: 112 Node tests passed, including ST 1.19 source-contract assertions, repeat retry limits, silent save failure/recovery, exact readback matching, stale history and stale-tab fences. Browser harness mocks were updated but the browser harness could not run in this environment (Chromium startup blocked). No live provider, server-save or Telegram test has been performed for this release. Install/update and use Fire now once in the intended chat, then reload to verify persistence.

## Text-first photos and network recovery (0.1.12)

Photo initiations now generate and save a short spoken line before generating the scene and requesting the image. An image failure leaves the line in chat, logs a `failed` photo with the available raw error, and preserves the partial-failure status. A successful line/photo pair shares one attempt ID, unread increment and notification. The sent record retains both the text message ID and image URL/message ID. The private scene-generation output is never posted to chat.

The final assistant text is excluded from recent-initiation history and removed from the assembled initiation prompt when matched (without modifying the saved chat or removing tool-call messages). Joe/Danny's exact repetition instruction quotes the previous message as reference data. Exact repeated output is rejected before publication. System-role placement and inherited temperature remain unchanged.

Photos selected while the app is hidden remain pending with “Held, app backgrounded”; text may still run. Returning to the app resumes the pending photo. If the app backgrounds after the line has already landed, a not-yet-started image is stopped and the partial failure is reported.

A TypeError containing “Failed to fetch” gets one retry after one second, shared across the attempt's generation/image stages. Logs show error name and `network`; provider/local errors do not receive this retry. Retries recheck chat/draft/deadline and cannot republish an already-published image. Each potentially billed image request still checks the existing count/credit caps. The local reservation is released on failure if no message was delivered, including expired interrupted attempts recovered after reload. A reservation release is not a refund from Venice. If the line landed, the reservation remains.

Validation: 98 Node tests with the ST 1.19 source-contract test enabled. New cases cover line-before-photo ordering, partial failures, exact-duplicate rejection, prompt-only filtering, background hold/resume, one network retry, cancellation, reservation release/reload and credit caps. The browser harness has matching adapter cases; it could not run in this environment because Chromium startup was blocked. No paid model calls or live chat changes were made during testing. Update Ava Initiation only; the bridge interface remains compatible with 0.6.5.

## Consume generation entry once (0.1.11)

The private generation's `entering` flag is consumed before its first non-dry entry check. A subsequent same-generation continuation therefore skips the draft/busy entry guard. The Generate finally still clears the flag if generation throws before that event. User-send handoff remains a separate listener so a real user request restores the temporary prompt/request/tool hooks after the entry flag is consumed.

Regression: the host/tool-result recursive generation event sequence enters once idle and again while busy, reaches the second model response and records one delivered message. The regression failed on 0.1.10 and passes here. Initiation tool execution remains disabled; this is an event-sequence regression, not a claim that a live initiation successfully executed a tool. User-send isolation and the 90-second waiting tests remain in the suite. No bridge, character prompt, image or memory settings changed.

## User-send isolation and unanswered wait (0.1.10)

The generation entry guard runs only during this extension's own non-dry Generate call. A normal user send releases the initiation's temporary prompt, request and tool hooks, reaches the model with its own settings, and supersedes the pending initiation result. The entering flag clears even when Generate throws. Draft and busy checks still protect the initiation itself.

An explicit 90-second unanswered/no-pending bound reports “Waiting for reply.” on timer ticks. Expiry does not create another send: the existing single 25-minute follow-up remains unchanged. Fire now retains its manual override. No character instructions, memory content, model temperature, Telegram credentials or other extensions are changed.

Regression coverage exercises a real pending scheduler attempt through the generation hooks, confirms the user request reaches the model boundary unchanged, and verifies the late initiation is discarded. Additional checks cover dry runs, failure cleanup and five-second scheduler ticks across the 90-second boundary and 25-minute follow-up.

## Normal scheduling restored (0.1.9)

The temporary 0.1.8 diagnostic hold is removed at Joe's request. Update and reload to resume the saved timer settings for the active allowlisted chat. **Enable initiations** and the character's **Allow** toggle must be on. Fire now is available again. Existing quiet hours, draft protection, unanswered-message waits, photo caps, notification settings and chat history are preserved.

The character's instruction, system-message placement, history injection and inherited temperature are unchanged. No proposed prompt/temperature fix has been applied. The cause of the earlier repeated replies remains unconfirmed, and no live diagnostic excerpts were shared.

The normal page no longer captures or displays request diagnostics and does not intercept fetch for logging. Previously saved diagnostic data stays local and is not uploaded, deleted or used to gate generation. The developer diagnostic helpers/tests remain available but are not wired into normal operation.

## Install

1. Update **Venice Image Bridge** to **0.5.0** using SillyTavern's extension Update button (needed for photos).
2. In **Extensions → Install extension**, paste `https://github.com/joetharp1/ava-initiation` and install.
3. Reload SillyTavern. Open the character's chat, then **Extensions → Ava Initiation**.
4. Allow the selected character, then enable Ava. Set intervals and quiet hours. **Fire now** runs a manual test.

Ava starts disabled, and each character must be allowed separately. Only the currently selected one-to-one chat is scheduled. Existing Venice keys, reference portraits and image settings are reused.

## Behaviour

- Random types: photo, question, complaint, demand, one-liner; no consecutive repeated type.
- One visible text message; photo initiations deliver a short line followed by a caption-free reference photo. No visible user turn or automatic continuation.
- After an unanswered initiation, one shorter, sharper text can follow at 25 minutes; then wait for a reply.
- Quiet hours, overnight wake coalescing, draft/busy deferral and per-chat state. Fire now bypasses quiet hours, failure backoff and the unanswered wait, but respects drafts, competing generation and budgets.
- Photos: at most two charged attempts per local day across allowlisted characters in this browser profile; default daily cap $0.12. Reservations use the greater of $0.06 and the selected model's catalogue price. Failures with no delivered message release the local reservation; partial delivery retains it. Potentially billed retries obey the same caps. Text continues when photos reach either cap.
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

Current runtime hashes are listed in `SHA256SUMS`.

## Validation

Version 0.1.11 passes 81 Node checks with the ST source-contract check enabled, including user-send isolation, unanswered timer ticks, manual retry/backoff, raw-output bounds, reasoning budgets, worker activation/failure and ready diagnostics. Bridge tests are in the bridge repository. Run `npm test` with Node 22+. Set `ST_SCRIPT` to a verified ST 1.19.0 `public/script.js` to run the source-contract check; otherwise it explicitly skips.

The development-only Playwright browser harness verifies normal automatic firing with an exhausted 0.1.8 diagnostic quota, no new request logging, preserved diagnostic storage, Telegram test/full/generic behaviour, token migration, blocked-worker fallback, failure handling, drafts, device-clock timestamps and mobile layouts. Notification permission is controlled in the harness and Telegram is mocked; the module worker's display call is spied on. No real Telegram or paid provider calls are made in tests. Playwright is not an extension dependency.

## Deferred follow-ups

The reviewed release retains the five-second storage write, `pagehide` cancellation, the initiation-only `isGenerating()` check, and the bridge's combined busy/configuration readiness status.
