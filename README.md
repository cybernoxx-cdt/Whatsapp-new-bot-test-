# GOD VOIP MD

WhatsApp media/call bot. Never commit session credentials, API keys, or database connection strings.

## GitHub Actions secrets
- `BOT_NUMBER`: WhatsApp account number in international format, digits only.
- `OWNER_NUMBER`: owner phone number, digits only.
- `SESSION_ID`: optional supported session string. In GitHub Actions pairing-code output is intentionally disabled.
- `MONGODB_URI`: connection string pointing to the existing database you intend to use.
- `SESSION_KEY`: optional session record key.
- `TOURL_API_KEY`: API bearer key for the upload service.
- `TOURL_BASE_URL`: optional; defaults to `https://db.dnuz.top`.
- `PREFIX`: optional command prefix.

For local use, place the complete Baileys multi-file auth state (creds.json and key files) in `auth_baileys/`. That folder is gitignored. The bot uses that folder when creds.json exists; otherwise it uses `session/`.

## Media packs
Reply to a WhatsApp video/audio with:
- `.addpack vibe` — upload to the media URL service and save the returned URL and metadata in the existing MongoDB database.
- `.mypack` — list packs.
- `.mypack vibe` — list assets in a pack.
- `.tourl` — upload replied media into the `uploads` pack.
- `.vcall vibe 947XXXXXXXX` — call using the latest video in the pack.
- `.acall vibe 947XXXXXXXX` — call using the latest audio in the pack.

Existing direct URL forms remain supported:
- `.vcall 947XXXXXXXX https://example.com/video.mp4`
- `.acall 947XXXXXXXX https://example.com/audio.mp3`

Uploads use `expires: 0`; permanent availability still depends on the upload provider's retention policy. The media metadata is stored in the existing MongoDB database's `media_assets` collection. This code does not create a new database per media pack.

## MongoDB quota note
The app uses one database named in `MONGODB_URI` and named collections (`sessions`, `settings`, `media_assets`). If the MongoDB host account itself has reached its database quota, an administrator must free capacity or raise that provider limit; application code cannot override a server-side quota.

## Security
- Never commit `auth_baileys/`, `session/`, `.env`, credentials, or pairing codes.
- Rotate any MongoDB password/session/API key that was previously pasted into a public repository or chat.
- Pairing codes are not printed in GitHub Actions logs. Configure a session secret for CI instead.
