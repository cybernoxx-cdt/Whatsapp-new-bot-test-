// ============================================================
// GOD VOIP MD - config.js
// Secrets are supplied through the runtime environment only.
// ============================================================

export default {
    botName: 'GOD VOIP MD',
    version: '1.0.1',
    ownerName: 'Savendra',
    ownerUrl: '',
    repoUrl: '',

    // WhatsApp number in international format, digits only.
    number: process.env.BOT_NUMBER || process.env.OWNER_NUMBER || '',

    // Set these in GitHub Actions Secrets. Never commit credentials.
    mongodbUri: process.env.MONGODB_URI || '',
    sessionKey: process.env.SESSION_KEY || 'god-voip-md',

    // SESSION_ID must be a complete supported export (Base64 JSON,
    // creds.json JSON, full auth-state JSON map, or supported MEGA link).
    // A short pairing-code fragment such as "shavi&" is NOT a session.
    sessionId: process.env.SESSION_ID || '',

    owners: process.env.OWNER_NUMBER ? [process.env.OWNER_NUMBER] : [],
    port: process.env.PORT || 8000,
    prefix: process.env.PREFIX || '.',
    publicCommands: false,

    audioUrl: 'https://file.dnuz.top/suv5il.ogg',
    videoUrl: 'https://github.com/ubala-siya/file-storage-repo-2/raw/refs/heads/main/uploads/1793198989389-anonymous-7fryx6_IUNFvliL.mp4',

    texts: {
        fail: '⚠️ Call system එක busy. නැවත උත්සාහ කරන්න.',
        ownerOnly: '🔒 මේ command එක owner ට විතරයි.',
        footer: '> ✦ GOD VOIP MD',
    },

    voip: {
        logLevel: 'media',
        maxConcurrentCalls: 3,
        callResolution: '480p',
    },

    autoCallDefault: true,
};
