# Ava Initiation 0.1.20

Unprompted character messages for SillyTavern 1.19.0. Client-side, no build step or external runtime dependencies. The two runtime files are `manifest.json` and `index.js`.

## One timed delivery test (0.1.20)

The phone tests on 11 November now establish two working paths: generation only returned 240 characters, and the manual delivery test returned 101 characters, rendered message 99, saved it, and verified its exact attempt ID and text on the server. Joe confirmed chats and ordinary replies still work. The delivery test took about 38 seconds, including about 11 seconds saving. These results do not establish the cause of the earlier automatic-scheduler failure.

0.1.20 adds **Schedule one text test (60 seconds)**. Only that button arms a timer; extension startup and chat changes do not. After 60 seconds it uses the same single-request generation and verified delivery path. Automatic recurring initiations, photos, notifications and retries remain paused. Text generation can incur the usual model cost; normal TTS may speak the delivered message.

A profile Web Lock serializes arming and execution across tabs. A new persistent `single-timed-arm-v1` receipt prevents another arm, even after cancellation or reload. `single-timed-delivery-v1` independently reserves the model attempt. Previous diagnostic receipts and logs are retained. Reload never resumes or resubmits this timer. A cancelled or interrupted test stays reserved for diagnosis; it does not silently retry.

Switching chat, sending a message, typing a draft, backgrounding the app, page closure, or Cancel timed test stops the test. At firing, an occupied composer, pending attachment, active generation, bridge operation or existing initiation lease blocks it. A timer more than 15 seconds late is abandoned. The generation/delivery deadline is 150 seconds after firing. Late callbacks cannot start a second attempt or deliver into another chat. No interval or legacy wake loop is installed.

Visible traces add `timer-armed`, `timer-fired`, `timer-cancelled`/`timer-blocked`, and `timer-finished`, with the same attempt ID used for generation and verified delivery. The saved receipt and bounded browser-local diagnostics survive reload within the same browser storage context.

Validation: 154 Node tests pass, zero skipped, including pinned ST source checks. Timer coverage includes double-clicks, reload, cancellation, stale callbacks, wrong chat, busy/background state, delayed timers, storage failure, profile-lock races, and integration with the single generation/delivery runner.

Phone acceptance: update/reload and confirm 0.1.20, select Ava's chat, empty the composer, press **Schedule one text test (60 seconds)** once, and keep that chat visible without typing. Allow the minute plus generation/save time. Copy attempt diagnostics afterwards, confirm the opening is fresh and ordinary chat still works. This timed phone test has not yet run; automatic scheduling must remain paused.

## One verified delivery test (0.1.19)

The 0.1.18 live diagnostic returned usable text successfully, and the user confirmed ordinary replies and chat switching still worked afterwards. That establishes the tested read/generation/cleanup path; it does not establish automatic scheduling or delivery.

0.1.19 keeps recovery mode and the scheduler hold, replacing the manual button with **Run one delivery test**. It reserves one explicit test under a separate `single-delivery-v1` key, preserving the prior generation-only reservation and all traces. It allows one model request, no model/network/repetition retry, no image call, and no initiation notification. Normal chat events are emitted on publication, so configured TTS may speak the delivered text.

After generation, the test rejects a repeat of any of the last eight assistant messages, without generating a replacement. It rereads server history and compares it with the selected local chat before adding one message with an attempt ID and diagnostic-delivery marker. It then exercises the existing message-render, MESSAGE_RECEIVED, CHARACTER_MESSAGE_RENDERED, saveChat and exact server-readback sequence. Separate stage traces reveal where a stall/error occurs. Success requires verification of the exact attempt ID and text on the server, not merely a resolved save promise.

The same 150-second deadline covers the full test. Stop, typing, chat switching and page backgrounding still cancel it; the persistent reservation blocks another run after timeout, failure or reload. Cancellation/failure after insertion can leave an unconfirmed local message, or an in-flight save may still complete. The log explicitly reports unconfirmed delivery; the test neither deletes that message nor retries it. Automatic initiation remains paused after every outcome.

Validation: 146 Node tests pass, zero skipped, with ST source checks enabled. New cases cover successful render/event/save/readback ordering, silent save failure, repeated/stale-history rejection, event/save/readback errors, cancellation between publication stages, one-time publication, and timeout/late-save handling without another generation. Subsequent live delivery test passed on 11 November, with exact server readback and ordinary chat operation confirmed by Joe (see 0.1.20 above).

Update/reload, confirm 0.1.19, select the intended companion chat and empty the composer. Press Run one delivery test once, keep the tab visible, and wait for the result (at most 150 seconds while the page stays responsive). A successful test adds one actual companion message. Copy attempt diagnostics afterwards; if the message appeared, also verify it remains after a reload. Do not resume automatic scheduling yet.

## One manual text diagnostic (0.1.18)

Automatic initiation remains disabled by `RECOVERY_ONLY`. The recovery panel now exposes **Run one text-only diagnostic** and **Stop diagnostic** alongside Copy attempt diagnostics. Loading, changing chats, elapsed time, and old enabled/pending settings cannot start this test.

The explicit button acquires the existing profile Web Lock without waiting, checks the selected chat, visible page, composer, active generation, bridge and old attempt lease, and persists a separate one-test reservation before doing work. Double taps and another tab/reload sharing this profile cannot repeat the test. Failed reservation storage blocks the request. Incognito storage is separate from normal browsing and may disappear when its session ends; keep the diagnostic tab open until the trace is copied.

The test follows the existing server-chat read/comparison, recent-initiation history, bridge ownership, private opening instruction and `stageNormal` request adapter. It makes at most **one model POST**, with the existing request-boundary guard rejecting a second request before dispatch. It retains the 12-second chat-read timeout and 150-second overall deadline. It does not use scheduler tick, failure backoff, network retries, repeat retries, photo generation, notifications, or chat publication/save. Results are reported as diagnostic success/failure, not as a delivered companion initiation. Consequently, success checks only the read/generation path; it does not validate automatic scheduling or saving an initiation.

Starting to type, changing chats, backgrounding/closing the page, pressing Stop diagnostic, or the deadline cancels the test. It calls only the adapter's owned cancellation callback; normal generation and cancellation implementation is otherwise unchanged. This remains a diagnostic of the suspected generation path, not proof that its underlying UI interference is fixed. A late response cannot publish a message, and no automatic retry is armed.

Test traces are plain text, bounded and copyable, displayed in recovery mode even if the earlier diagnostics-display preference was off. Scheduler configuration and previous logs are retained. The only new persisted execution state is the diagnostic reservation and its trace. Keep Enable initiations unchecked/locked; the manual button is the only route to a test.

Validation: 139 Node tests pass, zero skipped, including actual recovery boot with stubbed DOM/ST boundaries, double-click and reload exclusion, cross-tab reservation recheck, failed storage, busy-lock/composer refusal, network failure without retry, timeout, cancellation before a delayed chat read completes, chat switching, and rejection of a second model POST by the real adapter. No live provider/Android test was performed. The manual test uses the selected paid/free chat connection at its usual text-generation rate; it does not generate paid images.

Update/reload, check 0.1.18, select the intended companion chat and leave its composer empty. Press Run one text-only diagnostic once, keep the tab visible, and use Stop diagnostic if it becomes sluggish. After it ends (at most 150 seconds while the page remains responsive), Copy attempt diagnostics and share that result before any further code changes. Automatic initiation remains paused afterwards.

## Paused recovery build (0.1.17)

This release lets a globally disabled extension be loaded to retrieve diagnostics without resuming saved enabled/pending initiation state. `RECOVERY_ONLY` is true for the whole release: there is no UI action that resumes generation in 0.1.17. It is a diagnostic recovery build, not a repair of the underlying generation failure.

Boot reads existing local state without acquiring the scheduler Web Lock, migrating credentials, writing settings, registering notification workers, constructing the wake loop or subscribing to generation/message events. It only registers a chat-change redraw for the diagnostic view. No stored jobs, leases, settings or logs are cleared. With no local scheduler data, a read-only snapshot of saved extension settings supplies the panel.

The panel visibly says **Recovery mode — initiations paused**. Enable initiations is shown unchecked and locked; Fire now, notifications/test, photo and other settings controls are locked. **Copy attempt diagnostics** remains active, with a selectable text fallback. The engine also checks the pause before automatic/manual ticks, activation, reply handling, configuration changes and locked operations, as defense in depth.

Validation: 131 Node tests pass, zero skipped, with pinned ST source checks. A new integration test executes the actual `bootPage` using stubbed DOM and ST module boundaries, starting with enabled=true, overdue work and notifications enabled. It proves that boot, twenty chat switches and copying stored errors perform no fetch, timer, lock acquisition, generation, notification registration or storage/settings write. A separate engine test exercises manual firing, ordinary ticks, configuration calls and replies while paused and verifies stored state is unchanged. This does not constitute a live Android test.

Update this extension while it remains disabled in Manage extensions. After the update succeeds, close other SillyTavern tabs (older loaded copies are unaffected by a new build), enable the extension and reload. Confirm the panel shows **0.1.17** and the recovery notice, then copy diagnostics. Do not uninstall or clear browser storage: the earlier error records are local to that browser/profile. Await those records before changing the generation path again.

## Instrumentation only (0.1.16)

The live 0.1.15 test still disrupted chat access. This release does **not** claim to fix it. Generation, retry cadence, cancellation, prompts and photo selection remain unchanged. It adds bounded diagnostic lines in the chat area, enabled by default, and **Copy attempt diagnostics** (with a selectable-text fallback). Copy works with initiation disabled and includes the last ten previously stored failure/warning entries.

Each new attempt records UTC timestamp, attempt ID, type, scheduler retry count (zero for first attempt), stage and available error. Stages cover server history reads, ST generation entry, prompt/settings assembly, the HTTP request/response, publication, save verification, cancellation and backoff. HTTP 200 provider error envelopes are captured as well as HTTP failures and rejected fetches. Response inspection is detached from generation, limited to 64 KiB and three seconds, and does not alter the request or consume ST's response. Recorded detail is capped at 2,000 characters with credential redaction; truncation/inspection limits mean the full body is not guaranteed.

Diagnostics retain at most 80 events in this browser/profile; the latest 20 for the selected chat are rendered as plain text. They are **local diagnostic messages**, not companion/user transcript entries: no chat mutation, save call, message event, model-context injection or TTS. They survive reload in the same browser storage, but do not transfer to a separate browser/incognito profile. Disabling their display does not disable collection. Diagnostic storage/rendering failures do not fail generation.

### Four code findings (10 November 2026)

1. The exact error from the reported live initiation is still unknown. Existing attempt failures were stored in the extension's Recent initiation log and status line, not posted in chat. ST can also handle an error before the adapter receives useful detail. Whole-attempt deadline: **150 seconds**, emitting `Initiation timed out after 150 seconds.` Server-chat reads independently time out at **12 seconds**. New instrumentation identifies the last completed stage and captures the available response error.
2. Scheduler failure backoff is **1, 2, 4, 8, 16, 30, 30... minutes**, with **no maximum attempt count**. A `TypeError` containing `Failed to fetch` permits one additional network attempt after **one second**, shared across the initiation's operations. Repeated opening detection permits at most **two opening generations**; a photo also needs a scene generation. Telegram, if enabled, has its own maximum of three attempts for explicit retryable API responses, not ambiguous network failures. Thus one scheduler attempt can contain several requests. A failed save verification rechecks once per minute without generating a replacement.
3. There is no per-chat `setInterval`. `CHAT_CHANGED` cancels the active attempt and invokes one coalesced wake loop per tab. Rearming clears its pending timeout; if an activation is running, it records one pending wake. The wake check runs again after five seconds. The attempt's deadline timer is cleared in `finally`. These findings do not demonstrate timer stacking in the live failure. Separate open tabs still have their own wake loops, coordinated through profile locks/leases and selected-chat storage.
4. No `location.reload()`, `location.assign()` or `location.replace()` call exists in this extension. The code does not establish why the phone needs a fresh sign-in.

### Test interpretation / stopgap

Keep initiation disabled for ordinary chat use while diagnosis is pending. Updating and copying existing diagnostics does not require enabling it. For the requested controlled tests, set both interval fields to 240, daily photo budget to **0** (text-only), and both browser and Telegram notifications off. These controls are independent; no settings are automatically changed by this release.

**240 minutes is not a one-attempt mode:** existing pending jobs, failure backoff, Fire now, and the 25-minute unanswered follow-up are separate from the ordinary interval. If performing a manual test, disable initiation immediately after the first failure/timeout and copy its trace; do not leave it enabled expecting the interval to suppress retries. A zero photo budget prevents photo generation, but the text adapter still participates in bridge ownership, so that test does not isolate every bridge interaction. Fresh short chat and all-other-extensions-off results must be interpreted separately.

Validation: 129 Node tests pass, zero skipped, including pinned ST 1.19 source-contract checks. Added tests cover HTTP 200 errors, HTTP failures, network rejection, redaction, bounded diagnostics, unchanged successful responses, uncapped backoff at a 240-minute interval, timeout visibility, and fetch/settings restoration. The existing wake-coalescing regression also passes. No live Android, provider, or authenticated installation test was performed. Await the visible trace before another logic change.

## Chat access and reply recovery (0.1.15)

Chat-change events now schedule a coalesced wake instead of waiting for a full initiation. Only one wake loop runs at a time; activation failures are caught and displayed. Starting to type cancels the pending initiation before the Send button can be blocked by its busy state.

The generation adapter removes its temporary hooks on cancellation, releases ST's busy flag and send controls if prompt assembly throws while it still owns the generation, and relinquishes cancellation ownership when a user generation starts. Late cleanup must not clear the user's generation state. The page coordinator no longer calls ST's global stop control directly.

Validation: 119 Node tests pass, with pinned ST 1.19 source contracts enabled. Regressions cover chat-event wake scheduling, pre-request failure recovery, immediate hook removal on cancellation and user-generation handoff. This fixes reproduced code-level failure paths; it does not establish which path occurred on Joe's phone. Live end-to-end verification remains outstanding. Keep initiation disabled until a controlled test; existing chat access takes priority. No changes to character cards, prompts, cadence or budgets.

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
