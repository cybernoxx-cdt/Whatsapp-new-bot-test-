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

    // ---------- Account / Login ----------
    // Bot number (country code, "+" නැතුව). Session නැති පළමු deploy එකේදී
    // මේ number එකට PAIR CODE එක logs වල auto පෙන්වනවා.
    // WhatsApp → Linked Devices → Link with phone number instead → code එක ගහන්න.
    number: process.env.BOT_NUMBER || process.env.OWNER_NUMBER || '94707085822',

    // ---------- Database (session save කරන්න) ----------
    // Pair වුණාට පස්සේ session එක MongoDB එකේ save වෙනවා, restart වුණාම auto login.
    // MONGODB_URI env var එකක් විදිහට හෝ මෙතන paste කරන්න.
    mongodbUri: process.env.MONGODB_URI || '',
    sessionKey: process.env.SESSION_KEY || 'god-voip-md',   // MongoDB එකේ session නම

    // ---------- SESSION ID (optional) ----------
    // මෙතනට දාන්න පුළුවන්: Base64 session | creds.json content | MEGA link
    // (prefix එකක් තිබුණත් කමක් නෑ, උදා: NAME=eyJ...)
    // දාලා තියෙනවා නම් pair code එකක් නැතුව කෙලින්ම ඒ session එකෙන් connect වෙලා වැඩ කරනවා.
    // හිස් නම් MongoDB session එක / pair code පාවිච්චි වෙනවා.
    sessionId: process.env.SESSION_ID || 'shavi&njhFQDBL#dojZ7WL48DCTDeXVPhLtVBEgtsH4VQCip5IbFeZhIS4',

    // Extra owners (optional)
    owners: process.env.OWNER_NUMBER ? [process.env.OWNER_NUMBER] : [],

    // Web server (Heroku / health check සඳහා විතරයි)
    port: process.env.PORT || 8000,

    // ---------- Commands ----------
    prefix: process.env.PREFIX || '.',

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
        logLevel: 'media',   // 'media' = video/relay logs pennanawa (problem ekak nathnam 'warn' karanna)
        maxConcurrentCalls: 3,
        callResolution: '480p',     // .vcall video call quality
    },

    // Auto answer (incoming call → media play) පළමු start එකේදී ON ද OFF ද
    // (පස්සේ .call on / .call off වලින් වෙනස් කළාම ./data/settings.json එකේ save වෙනවා)
    autoCallDefault: true,
};
