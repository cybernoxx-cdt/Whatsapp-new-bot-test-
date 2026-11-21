# GOD VOIP MD

> **Runtime:** Node.js 20 · Baileys fork `@dnuzi/baileys@0.1.3` (pinned — do not upgrade without re-testing call handling).
> **Call limit:** at most 10 concurrent calls (`MAX_CONCURRENT_CALLS`); the limit is a hard cap and cannot exceed 50.
> **MongoDB:** `MONGODB_URI` is required for session persistence on GitHub Actions; without it the bot cannot save its session and will need re-pairing after every restart.
> **Env:** copy `.env.example` to `.env` and fill in the required secrets — never commit real secrets.

> **Runtime:** Node.js 20 · Baileys fork `@dnuzi/baileys@0.1.3` (pinned — do not upgrade without re-testing call handling).
> **Call limit:** at most 10 concurrent calls (`MAX_CONCURRENT_CALLS`); the limit is a hard cap and cannot exceed 50.
> **MongoDB:** `MONGODB_URI` is required for session persistence on GitHub Actions; without it the bot cannot save its session and will need re-pairing after every restart.
> **Env:** copy `.env.example` to `.env` and fill in the required secrets — never commit real secrets.

> **Runtime:** Node.js 20 · Baileys fork `@dnuzi/baileys@0.1.3` (pinned — do not upgrade without re-testing call handling).
> **Call limit:** at most 10 concurrent calls (`MAX_CONCURRENT_CALLS`); the limit is a hard cap and cannot exceed 50.
> **MongoDB:** `MONGODB_URI` is required for session persistence on GitHub Actions; without it the bot cannot save its session and will need re-pairing after every restart.
> **Env:** copy `.env.example` to `.env` and fill in the required secrets — never commit real secrets.

WhatsApp VoIP bot using `@dnuzi/baileys` 0.1.3.

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


## Multi-call limit

Configure `config.voip.maxConcurrentCalls` in `config.js` (supported range: 1–5; default: 2). The same value controls the VoIP engine capacity and the maximum number of recipients accepted by each `.vcall` / `.acall` command. Duplicate numbers are rejected, and per-recipient call failures are reported independently.

## Call updates
- Call limit: `config.voip.maxConcurrentCalls` (default 10) or env `CALL_LIMIT` (max 50). Old "1–5" note above is superseded.
- `.acall 9477xxxxxxx,9476xxxxxxx [link]` / `.vcall ...` dial many numbers at once; media is converted only once.
- Any audio link/file (mp3, m4a, wav, no extension...) is auto-converted to `.ogg` (Opus); any video to `.mp4` (H.264). Type is detected from the real content, not the URL.

## Multi-session setup (GitHub Actions)

The workflow supports up to 10 isolated WhatsApp accounts. Add each complete Baileys session export as an Actions secret named `SESSION_ID_1`, `SESSION_ID_2`, ... `SESSION_ID_10`. The legacy `SESSION_ID` secret is still supported as the first account when `SESSION_ID_1` is not set. Each account runs in its own Node.js process, auth directory, and MongoDB session key. Optional `BOT_NUMBER_2` ... `BOT_NUMBER_10` secrets set the pairing number for each account; otherwise the primary bot number is used. Existing sessions must be linked/registered already because pairing codes are not printed in Actions logs.

The workflow logs the configured session count and each session's connection status. A missing session secret is skipped; a malformed session reports an error for that account.

