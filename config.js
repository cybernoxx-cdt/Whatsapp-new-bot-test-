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
    audioUrl: (process.env.AUDIO_URL || process.env.DEFAULT_AUDIO_URL || '').trim(),
    videoUrl: (process.env.VIDEO_URL || process.env.DEFAULT_VIDEO_URL || '').trim(),

    texts: {
        fail: '⚠️ Call system එක busy. නැවත උත්සාහ කරන්න.',
        ownerOnly: '🔒 මේ command එක owner ට විතරයි.',
        footer: '> ✦ 🥵 𝑮𝑶𝑫 𝑽𝑶𝑰𝑷 𝑴𝑫 💋',
    },

    voip: {
        logLevel: 'warn',
        // Maximum simultaneous incoming + outgoing calls (1–20). Default: 2.
        // Change this value to tune .vcall / .acall multi-call limits.
        // Example: 4 = up to four calls at the same time.
        maxConcurrentCalls: 2,
        callResolution: '480p',
    },

    autoCallDefault: true,
};
