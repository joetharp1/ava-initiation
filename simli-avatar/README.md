# Companion Avatar · Simli (0.1.0)

Opt-in SillyTavern 1.19.0 extension for Joe's custom Simli faces. Existing ST/Venice conversation generation and ElevenLabs TTS remain the sources of dialogue and voice. No alternative model or microphone is started.

## Setup

Refresh ST, open Mollie's chat, then Extensions → Companion Avatar · Simli. Enter the Simli API key in the password field and choose Save key & load faces. Select the owned face named `Face 0067e65b`, then Assign to this companion. The displayed name is not assumed to be the complete face UUID.

Start silent preview explicitly opens a metered Simli session. Sound defaults to muted on every start. The session ends after five minutes, on chat changes, after one minute hidden, or on Stop. Simli idle timeout is 60 seconds. Starting requires a new button press; there is no automatic reconnect outside SDK startup retries (bounded locally at 45 seconds).

While connected, TTS_AUDIO_READY for the selected single companion is decoded/resampled to mono PCM16 16 kHz and sent to Simli. ST's ordinary audio element is temporarily muted to avoid double playback, then restored on Stop. Use ST's existing Narrate action to generate speech; this extension does not turn on automatic TTS. Full lip-sync/audio testing awaits Joe's private testing time. Silent preview can verify avatar video readiness only.

## Privacy and isolation

- API key validated against the face-list endpoint before storage in a new private volume, mode 0600. It is not returned by status, stored in ST settings/localStorage, or logged.
- Token service uses existing ST Basic authentication, same-origin checks and a custom request header. Only an assigned owned face can mint a token, with 5-minute/60-second session bounds and a 10-second throttle.
- The browser receives only a short-lived session token. Simli receives the selected voice audio; this bridge does not send chat history or character cards.
- Standalone `/astra-avatar/` service; original ST and initiation containers remain unchanged.
- Stop before playing unrelated audio in ST; this preview supports single-companion chats only.

## Build and checks

Pinned simli-client 3.2.0 and esbuild 0.27.0, npm package-lock retained. Build:

```
npm ci
npx --no-install esbuild client.js --bundle --format=esm --platform=browser --target=es2022 --external:../../../extensions.js --outfile=index.js --minify
node --test server.test.mjs
```

Backend integration test covers auth/Origin rejection, private key file permissions, no key in status, owned face assignment, path rejection, no token on setup, session limits and repeat-start throttling. Actual Simli credentials, face assignment, browser video and lip sync still require live validation.

Sources: Simli official simli-client README/source; `https://docs.simli.com/api-reference/get-all-faces.md`; SillyTavern 1.19.0 TTS source and TTS_AUDIO_READY event. The bundled SDK attaches audio by changing the element's muted flag, so silent mode also sets volume to zero before starting.
