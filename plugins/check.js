// .check — WhatsApp number ban / status checker (uses checkStatusWA from @dnuzi/baileys)
// Usage:  .check 94771234567
//         .check 94771234567,94777654321      (up to 10 numbers)
import * as B from '@dnuzi/baileys';

const MAX_NUMBERS = 10;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const STATUS_TEXT = {
    active: '🟢 Active (ban නෑ)',
    banned: '🔴 BANNED',
    blocked: '🟠 Official WhatsApp අවශ්‍යයි (blocked screen)',
    rate_limited: '🟡 Rate limited – ටිකක් ඉඳලා නැවත try කරන්න',
    error: '⚪ Unknown / error',
};

function getChecker(sock) {
    const fn = B.checkStatusWA || B.default?.checkStatusWA || sock?.checkStatusWA;
    if (typeof fn !== 'function') throw new Error('checkStatusWA function එක මේ @dnuzi/baileys version එකේ නෑ (0.1.3 හෝ ඊට වැඩි අවශ්‍යයි).');
    return fn;
}

function formatResult(r) {
    const lines = [`📞 *${r.number}*`, `📊 Status: ${STATUS_TEXT[r.status] || r.status}`];
    if (r.status === 'banned' && r.banInfo) {
        const b = r.banInfo;
        lines.push(`⛔ Ban type: ${b.banType || 'unknown'}`);
        if (b.violationReason) lines.push(`📄 Reason: ${b.violationReason}`);
        if (b.banDate) lines.push(`🗓️ Ban date: ${b.banDate.slice(0, 10)}`);
        lines.push(`📝 Can appeal: ${b.canAppeal ? 'Yes' : 'No'}`);
        if (b.appealStatus) lines.push(`📨 Appeal status: ${b.appealStatus}`);
    }
    return lines.join('\n');
}

export default {
    name: 'check',
    aliases: ['bancheck', 'numcheck', 'checkban'],
    desc: 'Check if a WhatsApp number is banned',
    ownerOnly: true,

    async run({ sock, args, text, reply, prefix, config }) {
        const numbers = [...new Set(
            String(text || '').split(/[\s,;]+/).map(x => x.replace(/[^0-9]/g, '')).filter(x => x.length >= 8 && x.length <= 15)
        )];

        if (!numbers.length) {
            return reply(`🔍 *Ban Check*\n\nUsage:\n\`${prefix}check 94771234567\`\n\`${prefix}check 94771234567,94777654321\`\n\nCountry code එක්ක, "+" නැතුව number එක දෙන්න.`);
        }
        if (numbers.length > MAX_NUMBERS) return reply(`❌ එකවර උපරිම numbers ${MAX_NUMBERS} යි.`);

        let check;
        try { check = getChecker(sock); }
        catch (e) { return reply('❌ ' + e.message); }

        await reply(`🔍 Checking ${numbers.length} number${numbers.length > 1 ? 's' : ''}...`);

        const out = [];
        for (const n of numbers) {
            try {
                const r = await check('+' + n);
                out.push(formatResult(r));
            } catch (e) {
                out.push(`📞 *+${n}*\n❌ Error: ${e?.message || 'check failed'}`);
            }
            if (numbers.length > 1) await sleep(1500); // be gentle, avoid rate limits
        }

        await reply(`╭━━〔 ✦ BAN CHECK 〕━━╮\n\n${out.join('\n\n')}\n\n╰━━━━━━━━━━━━━━━╯\n> ✦ ${config.botName}`);
    },
};
