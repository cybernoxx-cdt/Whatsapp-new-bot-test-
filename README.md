# GOD VOIP MD

WhatsApp VoIP bot. Media conversion and calls are separate operations.

## Commands
- `.tourl` — reply to a WhatsApp image, video, audio, or document to upload it to DNUZ and return a public URL. The bot does not save media files or media URL records in MongoDB.
- `.vcall 947XXXXXXXX https://direct-public-media-url` — place a video call using the explicitly supplied URL.
- `.acall 947XXXXXXXX https://direct-public-media-url` — place an audio call using the explicitly supplied URL.
- `.call on|off`, `.call-menu`, `.c-ping` — existing call controls.

The call commands require both a recipient number and a direct HTTP(S) media URL. They never read media from `.tourl` history, MongoDB, packs, or default media settings. `.tourl` only creates a link; copy that link and paste it as the second argument to `.vcall` or `.acall`.

## DNUZ upload
Set `TOURL_API_KEY` in GitHub Actions Secrets. Optional `TOURL_BASE_URL` defaults to `https://db.dnuz.top`.

The uploader follows the supplied DNUZ API contract: `POST /api/presign`, signed `PUT` to `uploadUrl`, optional `POST /api/complete`, and returns the exact `p.url` supplied by presign. It checks that this exact URL is publicly downloadable before showing it. If DNUZ returns HTTP 401/403, the provider must fix the file's public-read permissions; the bot cannot override a server-side denial.

## Runtime secrets
- `BOT_NUMBER`, `OWNER_NUMBER`
- `SESSION_ID` (optional supported session string)
- `MONGODB_URI` (used for WhatsApp session/settings only; no media asset collection)
- `SESSION_KEY` (optional)
- `TOURL_API_KEY`, `TOURL_BASE_URL` (optional)
- `PREFIX` (optional)

## Security
Never commit WhatsApp session credentials, API keys, database connection strings, or pairing codes. Rotate any credential that was exposed publicly.
