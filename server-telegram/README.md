# Server Initiation 0.2.0

Server-owned proactive messages for individually enabled SillyTavern chats. The existing browser-only Ava scheduler remains paused.

- No daily text or image count cap and no reply requirement. Existing per-chat 60–120 minute spacing and London quiet hours remain.
- Native ST context snapshots preserve character/world/memory instructions. Unrelated extension settings, saved images and journal files no longer invalidate them. Append-only completed exchanges are included automatically; edits, deletion or character/persona changes require a refreshed snapshot. The client refreshes on opening a chat or completing an exchange.
- Durable FIFO inbox supports multiple unanswered messages, imports each with its original timestamp, and verifies exact saved text and image URL. No server-side whole-chat writes.
- One text generation per scheduled opportunity. The model may choose an optional still self-portrait using that companion's saved Venice Image Bridge reference/model/options. The server reuses the installed bridge's portrait request builder, makes one image request, saves it in that character's ST gallery, and attaches it to the inbox receipt. No image count quota; provider credits and the selected image model's normal charge apply. Video budgets/settings are unchanged.
- Telegram uses sendMessage only, previews disabled. No photo, video, image URL or image prompt is sent to Telegram. Replies from Telegram are not connected.
- No general tool execution and no initiated videos. Normal chat video and journal tools are unchanged.
- Failed attempts wait until the next normal interval; no immediate paid retries. Ambiguous image/Telegram outcomes are never replayed. Restart recovery preserves inbox receipts.

## Migration and rollback
State v1 is backed up before v2 migration. Existing enabled companions and intervals are retained. Exact chat hashes or an unambiguous final user/assistant pair recover the old prompt anchor; otherwise the UI requests a refresh. Previously frozen prompt context remains in use until refreshed, including existing world/memory content. First staggered checks after migration occur in 1–5 minutes. Subsequent checks use saved spacing.

Deploy only the astra-initiation project and its managed client extension. ST itself is not restarted. Worker uses the existing server-side env_file for credentials; no credentials belong in Git or deployment payloads. Rollback requires restoring the matching pre-v2 state backup and previous client/server runtime together.

## Verification
`node --test tests/*.test.mjs`
`node tests/browser.cjs`
Image tests reuse the installed bridge's pure portrait builder; set VENICE_PORTRAITS_MODULE to its local portraits.mjs path. Browser fixture requires Playwright in CODEX_PRIMARY_RUNTIME_NODE_MODULES and Chromium at /tmp/chromium. Synthetic tests do not call a paid provider or send real Telegram messages.
