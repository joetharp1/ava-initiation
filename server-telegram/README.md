# Server initiation / Telegram — 0.1.0

A separate server worker and SillyTavern client extension for proactive text messages while every browser is closed. The original Ava Initiation browser scheduler remains paused.

## Behaviour

- Each individual chat is enabled explicitly. SillyTavern's own dry-run prompt assembly and configured Chat Completion adapters provide its context; this is a saved prompt, not a server reimplementation of every extension.
- The worker checks the saved chat and context dependencies before and after its single model request. Changed context stops delivery until the chat is refreshed. It uses the existing authenticated SillyTavern backend and Venice connection.
- Telegram receives the generated message, then the same durable inbox item imports into its selected chat on return. Telegram replies are not yet ingested. An imported message must be followed by a user reply before another initiation.
- A server restart never repeats an in-flight model call or an uncertain Telegram send. Model errors are visible and do not automatically retry. Maximum three automatic messages per chat/day; explicit tests bypass quiet hours and daily scheduling limits.
- The client and server verify chat identity and history before import and verify the message ID and text in the saved chat before acknowledgement. A moved-on conversation requires manual collection; no background whole-chat replacement occurs.
- Scheduling copies the existing initiation interval and quiet hours at first enable, interpreted in Europe/London. A dedicated test schedules one attempt after 60 seconds.

## Installation

Deploy as an isolated Docker Compose project with the existing SillyTavern data mounted read-only for the worker and a separate persistent state volume. The one-shot installer writes only the new `astra-server-initiation` user extension, backing up settings and any previous managed version first. Existing ST server/configuration/plugins are not restarted or replaced. The worker's API uses the same Basic authentication as ST, origin checks and a custom request header, with no published host port.

Pin all installed sources by commit and SHA-256. Do not put credentials in this repository. Supply Basic authentication credentials only via the server's private environment; Telegram credentials remain in existing ST settings.

## Test

`npm install --ignore-scripts` then `node --test tests/*.test.mjs`.

Live acceptance: refresh ST, open the selected companion, Extensions → Server Initiation · Telegram → Enable this chat → Test in 60 seconds, close every ST tab, receive Telegram, reopen the same chat and confirm import/readback and normal replies.

## Limitations

This is text-only and first supports the existing Venice custom connection. Full companion context is refreshed by the browser on setup and after completed conversation, not independently reassembled while offline. Context changes pause rather than guess. Use one active ST editing tab/device during import; ST's wider multi-device whole-chat save behaviour is unchanged. Pending messages and up to 20 prior receipts are retained on the VPS.
