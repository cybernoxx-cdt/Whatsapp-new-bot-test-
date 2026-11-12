// ============================================================
//  WA VoIP Bot - config.js 
//  FREE SCRIPT - Made by DNUZI 
//  Edit this file to customize your bot.
// ============================================================

export default {
    // ---------- Bot identity ----------
    botName: 'GOD VoIP Bot',
    version: '0.0.1',
    ownerName: 'Savendra Dampriya',                       // your name (shown in menu & messages)
    ownerUrl: 'https://github.com/cybernoxx-cdt',     // your link
    repoUrl: 'https://github.com/dnuzi/wa-voip-bot',

    // ---------- Account ----------
    // Bot WhatsApp number (country code, no "+", no spaces).
    // Used for pairing AND is the main owner.
    number: process.env.BOT_NUMBER || '94707085822',

    // Extra owners (optional) - numbers with country code, no "+"
    owners: [+94740711462],

    // ---------- Login ----------
    // 'pair' = pairing code  |  'qr' = scan QR
    connectMode: (process.env.CONNECT_MODE || 'pair').toLowerCase(),

    // Web server (health check + QR / pairing code page at /qr)
    port: process.env.PORT || 8000,

    // ---------- Commands ----------
    prefix: '.',

    // false = only the owner can use plugin commands (.ping .alive .info ...)
    // true  = everyone can use plugins that have  ownerOnly: false
    publicCommands: false,

    // ---------- Database ----------
    // Set MONGODB_URI as an environment variable (recommended),
    // or paste your connection string below.
    mongodbUri: process.env.MONGODB_URI || 'mongodb+srv://cloud25588_db_user:RQxEbZhj74uGOtb4@cluster0.pptbqdr.mongodb.net/nsero78?appName=Cluster',
    sessionId: process.env.SESSION_ID || '𝙰𝚂𝙸𝚃𝙷𝙰-𝙼𝙳=e00415e12af99365',

    // ---------- Media played on calls ----------
    // Direct links (audio: .opus/.mp3/.ogg - video: .mp4)
    audioUrl: 'https://file.dnuz.top/suv5il.ogg',
    videoUrl: 'https://github.com/ubala-siya/file-storage-repo-2/raw/refs/heads/main/uploads/1793198989389-anonymous-7fryx6_IUNFvliL.mp4',

    // ---------- Texts ----------
    texts: {
        fail: '⚠️ Call system is busy, please try again.',
        ownerOnly: '🔒 This command is for the owner only.',
        freeNote: '🆓 This is a free script. Do not sell it.',
        footer: '> ✦ Made by DNUZI • Free Script',
    },

    // ---------- Voip options ----------
    voip: {
        logLevel: 'warn',
        maxConcurrentCalls: 3,
    },

    // Auto call state on the very first start
    // (after that the value saved in MongoDB is used)
    autoCallDefault: true,
};
