# Hostinger deployment

VPS: 2117771. Existing project `sillytavern-jjhy`; worker project `astra-initiation`.
Initial pinned runtime commit: `50bc5eff72f65de9de9d8a60f1eb8c920b196059` on branch `server-telegram-2026-11-25` in `joetharp1/ava-initiation`.

Current runtime commit: `845aa073f94b05158dbb5125ac5d404910ec74c2`. This fixes a false repeat match caused by empty image-only assistant turns. Nine local tests pass. Live Telegram delivery was confirmed by the API at 04:57:20 UTC on 25 November; chat import and user receipt confirmation are still pending at this note's timestamp.

The Compose definition is `deployment.json`, excluding its private environment. Deployment reuses the existing private ADMIN_USERNAME / ADMIN_PASSWORD environment in Hostinger. Never copy that environment into this repository or a handover file.

Worker sources download from the pinned commit, are checked with SHA-256, and cache in its state volume for offline restarts. State volume is `astra-initiation_state`. Existing data volume is `sillytavern-jjhy_sillytavern-data`, read-only in the worker. Only the installer mounts it writable, to add the new client extension and back up the settings file into the state volume. Existing client versions back up before replacement.

Traefik routes `/astra-initiation/` on the existing ST hostname to worker port 8787, with higher priority than the ST root route. The API requires the same Basic authentication credentials, a custom request header, and same-origin browser requests. No worker host port is published. Worker resources capped at 256 MiB / 0.5 CPU; installer at 128 MiB. Existing ST image/container is untouched.

Read-only inspection project `initiation-inspect` has stopped after reporting. It must never become a background scheduler. Original `ava-initiation` remains recovery-only.

Pause per chat via the new extension. To pause the whole worker, stop only `astra-initiation-worker-1`; do not stop or replace SillyTavern. Preserve the state volume for receipts/inbox/backups. Removing a project with Hostinger can delete its volumes: do not use project deletion as a casual pause.

At initial deployment, all chats are disabled until the user explicitly enables one and exports its context. Live acceptance is not established until Telegram delivery and exact chat import are both verified.
