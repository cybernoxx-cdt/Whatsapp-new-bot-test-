// ============================================================
// GOD VOIP MD - config.js
// Secrets are supplied through the runtime environment only.
// ============================================================

export default {
    botName: '𝗚𝖮𝖣 𝗩𝖮𝖨𝖯 𝗠𝖣',
    version: '1.0.1',
    ownerName: 'Savendra',
    ownerUrl: '',
    repoUrl: 'https://github.com/cybernoxx-cdt/Whatsapp-new-bot-test-',
    connectMode: 'pairing',

    // WhatsApp number in international format, digits only.
    // BOT_NUMBER (or OWNER_NUMBER) — env takes precedence, original hardcoded value is the fallback.
    number: process.env.BOT_NUMBER || process.env.OWNER_NUMBER || '94707085822',

    // Set these in GitHub Actions Secrets. Never commit credentials.
    mongodbUri: process.env.MONGODB_URI || '',
    sessionKey: process.env.SESSION_KEY || 'god-voip-md',

    // SESSION_ID must be a complete supported export (Base64 JSON,
    // creds.json JSON, full auth-state JSON map, or supported MEGA link).
    // A short pairing-code fragment such as "shavi&" is NOT a session.
    sessionId: process.env.SESSION_ID || process.env.SESSION_ID_1 || '',

    owners: process.env.OWNER_NUMBER ? [process.env.OWNER_NUMBER] : ['94707085822'],
    port: process.env.PORT || 8000,
    prefix: process.env.PREFIX || '.',

    // Incoming one-to-one call media. Honours the documented env vars
    // (DEFAULT_AUDIO_URL / DEFAULT_VIDEO_URL, AUDIO_URL / VIDEO_URL aliases).
    // Original hardcoded media URLs are kept as fallback.
    audioUrl: process.env.DEFAULT_AUDIO_URL || process.env.AUDIO_URL || 'https://file.dnuz.top/fapoke.mpeg',
    videoUrl: process.env.DEFAULT_VIDEO_URL || process.env.VIDEO_URL || 'https://github.com/ubala-siya/file-storage-repo-2/raw/refs/heads/main/uploads/1793198989389-anonymous-7fryx6_IUNFvliL.mp4',

    // Centralised third-party hosts (Q6). Every base URL has an env override
    // so a host can be moved without a code change. No other file should
    // hardcode these hosts.
    hosts: {
        dnuzApiBase: (process.env.DNUZ_API_BASE || 'https://db.dnuz.top').replace(/\/$/, ''),
        fileHost: (process.env.FILE_HOST || 'https://file.dnuz.top').replace(/\/$/, ''),
        mochiApiBase: (process.env.MOCHI_API_BASE || 'https://mochi-apis.koyeb.app').replace(/\/$/, ''),
        storageRepo: process.env.STORAGE_REPO_URL || '',
    },

    // Named limits (Q7) — previously scattered magic numbers.
    limits: {
        maxMediaBytes: 150 * 1024 * 1024,
        maxDownloadBytes: 250 * 1024 * 1024,
        maxMediaMinutes: 15,
        maxCallSeconds: 900,
        maxPcmCacheEntries: 5,
        maxFileCacheEntries: 20,
        msgCacheMax: 1500,
        endedCallsMax: 500,
    },

    texts: {
        fail: '⚠️ Call media playback failed. Media URL එක සහ FFmpeg/ffprobe logs පරීක්ෂා කරන්න.',
        ownerOnly: '🔒 Owner only.',
        footer: '> ✦ 𝗚𝖮𝖣 𝗩𝖮𝖨𝖯 𝗠𝖣',
    },

    voip: {
        logLevel: 'warn',
        // Max simultaneous calls (outgoing + incoming). Override with CALL_LIMIT env. Hard cap: 50.
        maxConcurrentCalls: 10,
        callResolution: '480p',
    },

    autoCallDefault: true,
};
