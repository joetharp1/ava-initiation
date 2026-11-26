# Deployment checkpoint — 26 November 2026

User explicitly approved installing the separate Anam service, extension and private reuse of the existing ST authentication credentials.

- Runtime source: dc45d88393164af232e92b2db473e030ee2282c2, anam-avatar/.
- Separate Hostinger project: astra-anam. Installer exited 0; worker running.
- Installer copies only the managed astra-anam-avatar extension into default-user/extensions. Private state is in the new astra-anam_state volume.
- Public authenticated POST /astra-anam/status returned HTTP 200, configured=false, assignmentCount=0, maxSeconds=180. Unauthenticated request returned HTTP 401.
- User supplied Astra avatar ID is passed privately as a suggested default in the service environment; the user still must save their API key and assign it to the actual selected ST character.
- Four automated tests passed, covering private server setup/session requests and mocked client lifecycle. Bundle builds successfully (~132.5 KB).
- No Anam API key has been entered, no session token minted, no live video/audio test performed. Microphone/camera capture disabled in this release.
- Existing SillyTavern, Simli and initiation services were not changed or restarted.

## Next user action
Refresh ST, select Astra, open Extensions → Companion Avatar · Anam. Obtain an Anam API key from Anam Lab and paste it only into the panel password field. Confirm Astra's avatar ID, then Save key & assign avatar. Saving validates the avatar and stores the key privately but starts no session. Check the displayed status before starting any silent preview.

## Pending validation
Actual Anam key/avatar API access, active model compatibility, silent mobile WebRTC preview and later Narrate audio synchronization. Audio testing waits for privacy. Other companions require their avatar IDs and Assign using saved key. Current release displays video inside the extension panel, with 180-second automatic stop, 30-second hidden-tab stop, no automatic reconnect, and account recording/transcript retention requested off. Account-level spending caps remain configured in Anam, not this extension.
