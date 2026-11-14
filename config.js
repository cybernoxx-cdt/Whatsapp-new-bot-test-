// ============================================================
// GOD VOIP MD - config.js
// Secrets are supplied through the runtime environment only.
// ============================================================

export default {
    botName: '🥵 𝑮𝑶𝑫 𝑽𝑶𝑰𝑷 𝑴𝑫 💋',
    version: '1.0.1',
    ownerName: 'Savendra',
    ownerUrl: '',
    repoUrl: '',

    // WhatsApp number in international format, digits only.
    number: process.env.BOT_NUMBER || process.env.OWNER_NUMBER || '94707085822',

    // Set these in GitHub Actions Secrets. Never commit credentials.
    mongodbUri: process.env.MONGODB_URI || '',
    sessionKey: process.env.SESSION_KEY || 'god-voip-md',

    // SESSION_ID must be a complete supported export (Base64 JSON,
    // creds.json JSON, full auth-state JSON map, or supported MEGA link).
    // A short pairing-code fragment such as "shavi&" is NOT a session.
    sessionId: process.env.SESSION_ID || '',

    owners: process.env.OWNER_NUMBER ? [process.env.OWNER_NUMBER] : ['94707085822'],
    port: process.env.PORT || 8000,
    prefix: process.env.PREFIX || '.',
    publicCommands: false,

    // Incoming one-to-one call media. AUDIO_URL is supported as an alias.
    // Use a direct, publicly downloadable audio-file URL (MP3/OGG/WAV/M4A).
    audioUrl: 'https://file.dnuz.top/suv5il.ogg',
    videoUrl: 'https://github.com/ubala-siya/file-storage-repo-2/raw/refs/heads/main/uploads/1793198989389-anonymous-7fryx6_IUNFvliL.mp4',

    texts: {
        fail: '⚠️ Call media playback failed. Media URL එක සහ FFmpeg/ffprobe logs පරීක්ෂා කරන්න.',
        ownerOnly: '🔒 මේ command එක owner ට විතරයි.',
        footer: '> ✦ 🥵 𝑮𝑶𝑫 𝑽𝑶𝑰𝑷 𝑴𝑫 💋',
    },

    voip: {
        logLevel: 'warn',
        // Keep outbound dialing one-to-one; simultaneous multi-recipient dialing is disabled.
        maxConcurrentCalls: 1,
        callResolution: '480p',
    },

    autoCallDefault: true,
};
