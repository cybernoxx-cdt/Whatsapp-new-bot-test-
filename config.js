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

    audioUrl: process.env.DEFAULT_AUDIO_URL || '',
    videoUrl: process.env.DEFAULT_VIDEO_URL || '',

    texts: {
        fail: '⚠️ Call system එක busy. නැවත උත්සාහ කරන්න.',
        ownerOnly: '🔒 මේ command එක owner ට විතරයි.',
        footer: '> ✦ 🥵 𝑮𝑶𝑫 𝑽𝑶𝑰𝑷 𝑴𝑫 💋',
    },

    voip: {
        logLevel: 'warn',
        maxConcurrentCalls: 3,
        callResolution: '480p',
    },

    autoCallDefault: true,
};
