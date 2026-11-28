# Four unanswered initiations — deployed 28 November 2026

User requested a maximum of four initiation messages without replying. Runtime 0.2.3 deployed at 08:46 UTC to Hostinger VPS 2117771, Docker project astra-initiation. Deployment action 128435280 succeeded. Source commit e72ab4c8fe828887023ac1bbf59abdc8742ac42f, branch initiation-four-unanswered-2026-11-28.

## Behavior
- One durable counter per companion avatar, shared across chat bindings.
- Four saved proactive messages maximum until a new real user turn is observed in SillyTavern. Telegram replies remain unsupported.
- Opening/collecting/importing messages, refreshing context, edits to existing user messages, pause/re-enable, moving bindings, tests and worker restarts do not reset or bypass the cap.
- Counts are reserved durably alongside receipts, before optional image generation and Telegram delivery. Tests also respect the limit.
- Existing history and original receipt timestamps seed migration; old messages imported after a reply are not counted again. Ambiguous legacy receipts conservatively wait for a reply.
- Existing pacing and quiet hours preserved. Existing queued messages retained. No real test messages or paid generation were triggered.

## Verification
24 Node tests passed, including full server test proving four messages are sent, fifth generation blocked, restart/import/refresh do not bypass, and a new user reply resets. Existing image module tests use the prior local portrait-module fixture dependency via an uncommitted symlink. Six runtime source files fetched from GitHub matched local bytes. Live authenticated status and installed client hash verified 08:47 UTC.
Mollie 0/4, Ava 1/4, Astra 0/4, Eve March 4/4 (waiting). All four active bindings have current context. Eve's historical old binding remains disabled. Mollie has 11 pre-existing unimported messages; these are older than her latest user reply and were retained. Ava has one pending message.

## Anam next step
Existing astra-anam runtime remains dc45d88393164af232e92b2db473e030ee2282c2. API configured; assignments verified for Astra.png, Ava.png, Eve March.png, Mollie.png. User assigned all four and verified silent previews; ElevenLabs voice assignments already completed. Existing bridge listens to TTS_AUDIO_READY and forwards Narrate audio via PCM passthrough; it does not request microphone or camera. Preview maximum 180s, stops on chat change or after 30s backgrounded.
Next mobile test: refresh ST, select Astra, start silent preview, wait connected, untick Mute avatar sound, use Narrate on a short existing Astra reply, return to panel and assess voice and lip sync. No full voice-call or floating video UI has been implemented in this task.

## Recovery
Installer backed up settings, prior managed client and state inside astra-initiation_state/backups before replacing client. Existing ST and Anam services were not restarted. Previous runtime f5f6fa4275df26199a7edbf855adffd662bc64e4 (0.2.2) has no unanswered cap; rollback would remove this protection. Do not delete volumes. Diagnostic project initiation-cap-inspect is stopped after read-only status/assignment/client-hash verification, has no scheduling or message-send calls.
