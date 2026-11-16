// .check — WhatsApp number ban / status checker
// Self-contained: talks to WhatsApp's registration "exist" endpoint itself, so it shows the REAL
// reason when something fails (the library just returns "error" and hides the cause).
// Usage:  .check 94771234567     |     .check 94771234567,94777654321   (up to 10)
import * as B from '@dnuzi/baileys';

const MAX_NUMBERS = 10;
const ENDPOINT = 'https://v.whatsapp.net/v2/exist';
const GRAPHQL = 'https://graph.whatsapp.com/graphql';
const GQL_TOKEN = 'WA|1015890928915437|3201f239340c1c8ec6262a6dad04200e';
const GQL_DOC = '25573756098908502';
// tried in order if WhatsApp answers "old_version"
const USER_AGENTS = [
    'WhatsApp/2.25.20.78 iOS/18.3.1 Device/Apple-iPhone_15',
    'WhatsApp/2.24.12.78 iOS/17.5.1 Device/Apple-iPhone_13',
    'WhatsApp/2.24.20.85 Android/13 Device/Samsung-SM-S911B',
    'WhatsApp/2.23.20.76 Android/12 Device/Google-Pixel_6',
];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const TWO = new Set('20 27 30 31 32 33 34 36 39 40 41 43 44 45 46 47 48 49 51 52 53 54 55 56 57 58 60 61 62 63 64 65 66 81 82 84 86 90 91 92 93 94 95 98'.split(' '));
function splitNumber(digits) {
    if (digits[0] === '1' || digits[0] === '7') return { cc: digits[0], nn: digits.slice(1) };
    if (TWO.has(digits.slice(0, 2))) return { cc: digits.slice(0, 2), nn: digits.slice(2) };
    return { cc: digits.slice(0, 3), nn: digits.slice(3) };
}

function buildQuery(creds, cc, nn) {
    const regid = Buffer.alloc(4); regid.writeInt32BE(creds.registrationId || 0);
    const skid = Buffer.alloc(3); skid.writeInt16BE(creds.signedPreKey?.keyId || 1);
    const p = {
        cc, in: nn, Rc: '0', lg: 'en', lc: 'GB', mistyped: '6',
        authkey: Buffer.from(creds.noiseKey.public).toString('base64url'),
        e_regid: regid.toString('base64url'),
        e_keytype: 'BQ',
        e_ident: Buffer.from(creds.signedIdentityKey.public).toString('base64url'),
        e_skey_id: skid.toString('base64url'),
        e_skey_val: Buffer.from(creds.signedPreKey.keyPair.public).toString('base64url'),
        e_skey_sig: Buffer.from(creds.signedPreKey.signature).toString('base64url'),
        fdid: creds.phoneId, network_ratio_type: '1', expid: creds.deviceId, simnum: '1', hasav: '2',
    };
    return Object.entries(p).filter(([, v]) => v != null).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}

async function banDetails(token) {
    try {
        const res = await fetch(GRAPHQL, {
            method: 'POST',
            headers: { 'User-Agent': USER_AGENTS[1], 'Content-Type': 'application/json' },
            body: JSON.stringify({
                variables: JSON.stringify({ app_id: 'dev.app.id', request_token: token }),
                access_token: GQL_TOKEN, doc_id: GQL_DOC, lang: 'en_GB',
            }),
            signal: AbortSignal.timeout(15000),
        });
        const j = await res.json().catch(() => ({}));
        return j?.data?.whatsapp_support_ban_appeal_status || null;
    } catch { return null; }
}

async function checkNumber(raw) {
    const digits = String(raw).replace(/\D/g, '');
    const { cc, nn } = splitNumber(digits);
    const out = { number: '+' + digits, status: 'error', detail: '', ban: null };
    const creds = B.initAuthCreds();
    const qs = buildQuery(creds, cc, nn);

    for (const ua of USER_AGENTS) {
        let res, json;
        try {
            res = await fetch(`${ENDPOINT}?${qs}`, { headers: { 'User-Agent': ua, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
            json = await res.json().catch(() => null);
        } catch (e) {
            const code = e?.cause?.code || e?.cause?.message || e?.message || 'network error';
            out.detail = `Network: ${code} (server එකෙන් v.whatsapp.net වෙත access නැතිවෙන්න පුළුවන්)`;
            return out;
        }
        if (!json) { out.detail = `HTTP ${res.status}, JSON නැති response එකක්`; continue; }

        if (json.reason === 'old_version') { out.detail = 'old_version'; continue; } // try next user-agent

        if (json.appeal_token) {
            const d = await banDetails(json.appeal_token);
            const permanent = d?.status === 'BANNED';
            out.status = 'banned';
            out.ban = {
                type: permanent ? 'permanent' : 'temporary',
                violation: json.violation_type || null,
                canAppeal: !permanent,
                date: d?.ban_time ? new Date(d.ban_time * 1000).toISOString().slice(0, 10) : null,
                appeal: d?.status || null,
            };
            return out;
        }
        if (json.custom_block_screen) { out.status = 'blocked'; return out; }
        if (json.reason === 'temporarily_unavailable') { out.status = 'rate_limited'; return out; }
        if (json.reason === 'incorrect' || (res.ok && ['ok', 'sent'].includes(json.status))) { out.status = 'active'; return out; }
        if (json.reason === 'no_routes' || json.reason === 'too_recent' || json.reason === 'too_many') { out.status = 'rate_limited'; out.detail = json.reason; return out; }

        out.detail = `reason=${json.reason || '-'} status=${json.status || '-'} http=${res.status}`;
        return out;
    }
    return out;
}

const STATUS_TEXT = {
    active: '🟢 Active (ban නෑ)',
    banned: '🔴 BANNED',
    blocked: '🟠 Official WhatsApp අවශ්‍යයි',
    rate_limited: '🟡 Rate limited – විනාඩි කීපයකින් try කරන්න',
    error: '⚪ Check කරන්න බැරි වුණා',
};

function format(r) {
    const l = [`📞 *${r.number}*`, `📊 ${STATUS_TEXT[r.status]}`];
    if (r.ban) {
        l.push(`⛔ Type: ${r.ban.type}`);
        if (r.ban.violation) l.push(`📄 Violation type: ${r.ban.violation}`);
        if (r.ban.date) l.push(`🗓️ Ban date: ${r.ban.date}`);
        l.push(`📝 Can appeal: ${r.ban.canAppeal ? 'Yes' : 'No'}`);
        if (r.ban.appeal) l.push(`📨 Appeal status: ${r.ban.appeal}`);
    }
    if (r.detail) l.push(`🔧 ${r.detail}`);
    return l.join('\n');
}

export default {
    name: 'check',
    aliases: ['bancheck', 'numcheck', 'checkban'],
    desc: 'Check if a WhatsApp number is banned',
    ownerOnly: true,

    async run({ text, reply, prefix, config }) {
        const numbers = [...new Set(
            String(text || '').split(/[\s,;]+/).map(x => x.replace(/\D/g, '')).filter(x => x.length >= 8 && x.length <= 15)
        )];
        if (!numbers.length) return reply(`🔍 *Ban Check*\n\n\`${prefix}check 94771234567\`\n\`${prefix}check 94771234567,94777654321\`\n\nCountry code එක්ක, "+" නැතුව දෙන්න.`);
        if (numbers.length > MAX_NUMBERS) return reply(`❌ එකවර උපරිම numbers ${MAX_NUMBERS} යි.`);

        await reply(`🔍 Checking ${numbers.length} number${numbers.length > 1 ? 's' : ''}...`);
        const out = [];
        for (const n of numbers) {
            try { out.push(format(await checkNumber(n))); }
            catch (e) { out.push(`📞 *+${n}*\n❌ ${e?.message || 'check failed'}`); }
            if (numbers.length > 1) await sleep(1500);
        }
        await reply(`╭━━〔 ✦ BAN CHECK 〕━━╮\n\n${out.join('\n\n')}\n\n╰━━━━━━━━━━━━━━━╯\n> ✦ ${config.botName}`);
    },
};
