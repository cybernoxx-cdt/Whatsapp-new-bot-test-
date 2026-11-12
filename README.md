# 📞 GOD VOIP MD

WhatsApp auto call bot — session එක `config.js` එකෙන්, pair code / QR නැතුව.

## Setup
1. `config.js` → `sessionId` එකට ඔයාගේ session එක paste කරන්න (නැත්නම් `SESSION_ID` env var).
2. `npm install` → `npm start`

### Session formats
| Format | විස්තරය |
|---|---|
| Base64 (creds JSON) | කෙලින්ම use කරනවා |
| MEGA link / `ID#KEY` | download කරලා use කරනවා |
| කෙටි id (`NAME=e00415…`) | `config.js` → `sessionApi` එකේ server URL එක දාන්න (`{id}` ආදේශ වෙනවා) |

`NAME=` prefix (ex: `ASITHA-MD=`) auto ඉවත් වෙනවා.

## Commands (owner)
| Command | වැඩේ |
|---|---|
| `.vcall 94771234567 https://site.com/video.mp4` | Video call යවනවා, video එක play වෙනවා |
| `.acall 94771234567 https://site.com/audio.mp3` | Audio call යවනවා, audio එක play වෙනවා |
| `.call on` / `.call off` / `.call` | Auto answer (incoming calls) |
| `.call-menu` `.c-ping` `.menu` `.alive` `.info` `.owner` `.ping` `.runtime` | වෙනත් commands |

URL එක දාන්නේ නැත්නම් `config.js` එකේ `videoUrl` / `audioUrl` use වෙනවා.
Call එක answer කළාම media එක play වෙලා ඉවර වෙද්දී auto hangup වෙනවා.
