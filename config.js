// ============================================================
//  GOD VOIP MD - config.js
//  Edit this file to customize your bot.
// ============================================================

export default {
    // ---------- Bot identity ----------
    botName: 'GOD VOIP MD',
    version: '1.0.0',
    ownerName: 'Savendra',                    // menu / messages වල පෙන්වන නම
    ownerUrl: '',
    repoUrl: '',

    // ---------- SESSION ID (මෙතනට paste කරන්න) ----------
    // Deploy කරද්දී bot එක මේ session එකෙන් කෙලින්ම login වෙනවා.
    // Pair code / QR logs වල කිසිම තැනක පෙන්නන්නේ නෑ.
    // Heroku වල නම් SESSION_ID config var එකත් පාවිච්චි කරන්න පුළුවන් (ඒකට priority).
    sessionId: process.env.SESSION_ID || '𝙰𝚂𝙸𝚃𝙷𝙰-𝙼𝙳=e00415e12af99365',

    // Session ID එක කෙටි id එකක් (උදා: xxxx=e00415e12af99365) නම්, ඒක ගන්න පුළුවන්
    // server එකේ URL එක මෙතන දාන්න. {id} කියන තැනට id එක ආදේශ වෙනවා.
    // උදා: 'https://your-session-server.com/session/{id}'
    // (Base64 / MEGA link session නම් මේක හිස්ව තියන්න)
    sessionApi: process.env.SESSION_API || '',

    // ---------- Account ----------
    // Main owner number (country code, "+" නැතුව). Session එකේ number එක නෙවෙයි නම් මෙතන දාන්න.
    number: process.env.BOT_NUMBER || '94707085822',

    // Extra owners (optional)
    owners: [],

    // Web server (Heroku / health check සඳහා විතරයි)
    port: process.env.PORT || 8000,

    // ---------- Commands ----------
    prefix: '.',

    // false = owner විතරයි commands use කරන්න පුළුවන්
    publicCommands: false,

    // ---------- Media played on calls ----------
    // Direct links (audio: .opus/.mp3/.ogg - video: .mp4)
    audioUrl: 'https://file.dnuz.top/suv5il.ogg',
    videoUrl: 'https://github.com/ubala-siya/file-storage-repo-2/raw/refs/heads/main/uploads/1793198989389-anonymous-7fryx6_IUNFvliL.mp4',

    // ---------- Texts ----------
    texts: {
        fail: '⚠️ Call system එක busy. නැවත උත්සාහ කරන්න.',
        ownerOnly: '🔒 මේ command එක owner ට විතරයි.',
        footer: '> ✦ GOD VOIP MD',
    },

    // ---------- Voip options ----------
    voip: {
        logLevel: 'warn',
        maxConcurrentCalls: 3,
        callResolution: '480p',     // .vcall video call quality
    },

    // Auto answer (incoming call → media play) පළමු start එකේදී ON ද OFF ද
    // (පස්සේ .call on / .call off වලින් වෙනස් කළාම ./data/settings.json එකේ save වෙනවා)
    autoCallDefault: true,
};
