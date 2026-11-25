# Live deployment — 25 November 2026

VPS 2117771, project astra-initiation. Runtime 0.2.0 pinned to f9b09dbef25efa4b77cdd40ecf3181d8feed6b9a. Branch server-telegram-2026-11-25 in joetharp1/ava-initiation.

Deployment action 127876070 succeeded at 13:57 UTC. Installer backed up existing managed client and settings; worker backed up v1 state before migration. Native ST project was not restarted. Credentials load only from /docker/sillytavern-jjhy/.env on the server; no private values are in this repository.

Authenticated live status at 13:57:56 UTC: Mollie, Ava, Astra and Eve March enabled; contextReady and imagesEnabled true for all four; no errors, reply gate removed. Live client returned HTTP 200 and matched the source SHA-256. 15 synthetic Node tests and browser FIFO/image import checks pass; no paid model or actual Telegram calls were used by the fixtures.

First natural checks are staggered 1–5 minutes after migration. Later checks use existing 60–120 minute intervals. Telegram text only; images wait in ST inbox; no initiated videos. No daily count quotas. References use the current saved editing model/options at provider cost. All four reference prices were listed at USD 0.06 at preflight.

The old Ava client scheduler remains paused. Reload ST once to load client 0.2.0, which imports queued text and pictures. Telegram replies remain unsupported.

Rollback: restore the matched pre-v2 state backup and previous managed-client backup, then redeploy the previous pinned worker 845aa073f94b05158dbb5125ac5d404910ec74c2. Never run old worker against v2 queue state.
