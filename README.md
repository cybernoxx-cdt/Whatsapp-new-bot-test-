# GOD VOIP MD

WhatsApp VoIP bot using `@dnuzi/baileys` 0.1.2.

## Commands

- `.tourl` — reply to a normal WhatsApp audio/video message. The bot downloads the media and stores it locally as the latest call media for the current runtime.
- `.acall 94771234567` — place an audio call using the latest `.tourl` media. The selected file must contain an audio stream.
- `.vcall 94771234567` — place a video call using the latest `.tourl` media. The selected file must contain a video stream.
- `.acall 94771234567 https://...` — optional direct media URL.
- `.vcall 94771234567 https://...` — optional direct video URL.
- `.self` — owner-only command mode.
- `.public` — public mode for non-owner, non-owner-only commands. VOIP dialing and owner-only plugins remain protected.
- `.call on|off`, `.call-menu`, `.c-ping`, `.vv`.

## Media behavior

The latest `.tourl` media is kept in `./tmp` and passed to the VoIP library as a local file. Calls do not depend on a DNUZ public URL, so DNUZ anonymous-download HTTP 403 errors do not affect the `.tourl` → `.acall` / `.vcall` flow.

Only one latest media file is kept. Uploading another `.tourl` media replaces it. The local media cache belongs to the current runtime and is not guaranteed to survive a fresh GitHub Actions runner/redeployment; run `.tourl` again after a restart.

Audio call limits follow the library's documented 20 MB audio limit. Video calls are transcoded to a call-friendly H.264 MP4 and limited to 50 MB. `.vcall` refuses audio-only files instead of silently downgrading to an audio call.

`.vv` can resend regular quoted media when WhatsApp still exposes a valid media path. View Once media is intentionally not supported.

## Modes

- Default mode is `self`.
- `.public` allows non-owner users to use non-owner-only plugins and public information commands.
- `.self` returns to owner-only access.
- `.acall`, `.vcall`, `.tourl`, and owner-only plugins remain owner-only in both modes.

## Runtime secrets

- `BOT_NUMBER` or `OWNER_NUMBER`
- `MONGODB_URI`
- `SESSION_ID` (optional supported session string)
- `SESSION_KEY` (optional)
- `DEFAULT_AUDIO_URL` / `DEFAULT_VIDEO_URL` (optional for incoming-call media)
- `PREFIX` (optional)

No DNUZ API key is required for local `.tourl` call media.

## Run checks

```bash
npm run security-check
```

Never commit WhatsApp session credentials, API keys, database connection strings, or pairing codes.
