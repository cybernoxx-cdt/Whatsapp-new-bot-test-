// .check — check WhatsApp registration / ban status using @dnuzi/baileys v0.1.3
import { checkStatusWA } from '@dnuzi/baileys';

const cleanNumber = value => String(value || '').replace(/[^0-9]/g, '');

export default {
    name: 'check',
    aliases: ['numbercheck', 'wa-check'],
    desc: 'Check a WhatsApp number status',
    ownerOnly: true,

    async run({ args, reply, prefix, config }) {
        const number = cleanNumber(args[0]);
        if (number.length < 8 || number.length > 15) {
            return reply(
                '🔎 *WhatsApp Number Check*\n\n' +
                '*Usage:* `' + prefix + 'check 94771234567`\n' +
                'Country code සමඟ digits පමණක් ලබාදෙන්න.'
            );
        }

        await reply('⏳ *Checking number status...*\nPlease wait.');
        try {
            const result = await checkStatusWA('+' + number);
            const status = String(result?.status || 'unknown').toUpperCase();
            const registered = result?.exists === true || result?.isRegistered === true ||
                ['registered', 'active', 'available', 'ok'].includes(String(result?.status || '').toLowerCase());
            const banned = result?.isBanned === true || String(result?.status || '').toLowerCase() === 'banned';
            const official = result?.isNeedOfficialWa === true;

            const lines = [
                '╭━━〔 🔎 *NUMBER CHECK* 〕━━╮',
                '',
                '📱 *Number:* +' + number,
                '📊 *Status:* ' + status,
                '🚫 *Banned:* ' + (banned ? 'Yes' : result?.isBanned === false ? 'No' : 'Unknown'),
                '📲 *Official WhatsApp required:* ' + (official ? 'Yes' : 'No / Unknown'),
                registered ? '✅ *Registration:* Registered' : '',
                '',
                '╰━━━━━━━━━━━━━━━━━━╯',
                config.texts.footer
            ].filter(Boolean);
            await reply(lines.join('\n'));
        } catch (error) {
            await reply('⚠️ *Number check failed*\n' + (error?.message || 'Unknown error') + '\n\n' + config.texts.footer);
        }
    },
};
