# Companion Avatar · Anam — first integration

Adds a separate optional SillyTavern extension and private Node sidecar. Existing Simli, chat, voice settings and initiation services are unchanged. No microphone/camera capture; this release is a three-minute receive-only video preview driven by the selected companion's existing TTS_AUDIO_READY events. Not a hands-free calling implementation.

## User setup

Reload SillyTavern, select one companion, then Extensions → Companion Avatar · Anam. Enter the **avatar** ID (not a persona ID). Paste the Anam key only in the password field and choose **Save key & assign avatar**. The key is validated with GET /v1/avatars/{id} and stored in the private sidecar volume with mode 0600. No live session starts on save. Subsequent companions use **Assign using saved key**.

Start silent preview explicitly when ready (uses account minutes even while silent). It stops after 180 seconds, on chat change, or after 30 seconds hidden. It never restarts automatically. Stop Simli before starting Anam. Use the existing message Narrate action to animate speech; untick Mute only when ready for sound. The original ST TTS element is muted during Anam playback and restored on stop. Sound and video both come from Anam to preserve synchronization. The video currently remains in the extension panel.

## Architecture

The server makes Anam session tokens with avatarId, enableAudioPassthrough=true, the avatar's default model, and maxSessionLengthSeconds=180. It does not use Anam personaId, voiceId, LLM or ST history. sessionOptions.dataRetention requests recording and transcripts off (this is not a claim of Enterprise ZDR). Session tokens reach the browser; the persistent API key does not.

The browser uses @anam-ai/js-sdk 4.29.3 with disableInputAudio=true. Narrate Blob audio is decoded and resampled to mono PCM16 at 24 kHz, sent in 250 ms chunks, then endSequence is called. The avatar's default activeVersion is retained; this may differ from a particular Lab persona's explicit model choice, which should be compared during user validation.

## Tests and limitations

`npm ci && npm test && npm run build` checks server authentication, cross-origin rejection, private key storage, avatar validation, no token on setup, passthrough request configuration, duration, recording settings, one-active-preview lock and retry throttling. Browser lifecycle tests should run before deployment. A live Anam key, actual avatar and mobile WebRTC test remain required. No vendor session or paid TTS call is made by automated checks.

The three-minute limit is a preview cost bound, not an account spending cap. Set any account-wide overage cap in Anam. The server suppresses overlapping token requests; server restart forgets its in-memory lease. Plan limits still apply. This version does not implement microphone input, fullscreen chat overlay or group calls.

## Sources checked 2026-11-26

- https://anam.ai/docs/api-reference/sessions/create-session-token
- https://anam.ai/docs/api-reference/avatars/get-avatar
- https://anam.ai/docs/personas/session/recordings
- https://github.com/anam-org/javascript-sdk
- https://github.com/anam-org/anam-cookbook/blob/main/content/recipes/python-audio-passthrough-tts.mdx

Deploy as a separate `astra-anam` project, with /astra-anam/ routed to port 8789 through the existing TLS reverse proxy. Reuse existing ST Basic authentication via environment variables, never committed credentials. Mount the existing ST data volume for the one-shot installer only; the worker needs only its own state volume. Use the pinned source commit and checksums for downloaded code. Rollback: stop the new project and remove only data/default-user/extensions/astra-anam-avatar; leave all existing services and the private state volume intact.
