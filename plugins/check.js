// .check — WhatsApp number status checker for @dnuzi/baileys v0.1.3
// Never report "not banned" when the lookup itself failed.
const cleanNumber = value => String(value || '').replace(/[^0-9]/g, '');

const isLookupError = result => {
    const status = String(result?.status || '').toLowerCase();
    return !result || ['error', 'failed', 'failure'].includes(status) ||
        Boolean(result?.error && !result?.status);
};

export default {
    name: 'check',
    aliases: ['numbercheck', 'wa-check'],
    desc: 'Check WhatsApp number registration / ban status',
    ownerOnly: true,

    async run({ sock, args, reply, prefix, config }) {
        const number = cleanNumber(args[0]);
        if (number.length < 8 || number.length > 15) {
            return reply(
                '╭━━〔 🔎 *NUMBER CHECK* 〕━━╮\n' +
                '📱 *Usage:* `' + prefix + 'check 94771234567`\n' +
                'Country code සමඟ number එක ලබාදෙන්න.\n' +
                '╰━━━━━━━━━━━━━━━━━━╯\n\n' + config.texts.footer
            );
        }

        await reply('⏳ *Checking WhatsApp number...*\nPlease wait a moment.');
        try {
            let result;
            let firstError;

            // Prefer the documented standalone helper exposed on the socket's package.
            try {
                if (typeof sock?.checkStatusWA === 'function') {
                    result = await sock.checkStatusWA('+' + number);
                }
            } catch (error) {
                firstError = error;
            }

            if (isLookupError(result)) {
                const detail = result?.error || result?.message || firstError?.message;
                const statusText = String(result?.status || '').toLowerCase();
                const detailText = detail ? String(detail).slice(0, 220) : '';
                return reply(
                    '╭━━〔 ⚠️ *NUMBER CHECK UNAVAILABLE* 〕━━╮\n\n' +
                    '📱 *Number:* +' + number + '\n' +
                    '📊 *Lookup:* Failed / service unavailable\n' +
                    (statusText ? '🔎 *Response:* ' + statusText + '\n' : '') +
                    (detailText ? '📝 *Details:* ' + detailText + '\n' : '') +
                    '\nℹ️ Number එක banned ද කියලා තහවුරු කරන්න බැරි වුණා. ටික වෙලාවකින් නැවත උත්සාහ කරන්න.\n' +
                    '╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯\n\n' + config.texts.footer
                );
            }

            const status = String(result?.status || 'unknown').toLowerCase();
            const statusLabels = {
                active: 'ACTIVE',
                registered: 'ACTIVE',
                banned: 'BANNED',
                blocked: 'BLOCKED',
                not_registered: 'NOT REGISTERED',
                rate_limited: 'RATE LIMITED',
                unknown: 'UNKNOWN'
            };
            const banned = result?.isBanned === true || status === 'banned';
            const bannedKnown = result?.isBanned === true || result?.isBanned === false || status === 'banned';
            const officialKnown = typeof result?.isNeedOfficialWa === 'boolean';
            const official = result?.isNeedOfficialWa === true;

            const lines = [
                '╭━━〔 🔎 *NUMBER CHECK* 〕━━╮',
                '',
                '📱 *Number:* +' + number,
                '📊 *Status:* ' + (statusLabels[status] || status.toUpperCase()),
                '🚫 *Banned:* ' + (bannedKnown ? (banned ? 'Yes' : 'No') : 'Unknown'),
                '📲 *Official WhatsApp required:* ' + (officialKnown ? (official ? 'Yes' : 'No') : 'Unknown'),
                result?.banInfo?.banType ? '⚠️ *Ban type:* ' + String(result.banInfo.banType) : '',
                '',
                '╰━━━━━━━━━━━━━━━━━━╯',
                config.texts.footer
            ].filter(Boolean);

            await reply(lines.join('\n'));
        } catch (error) {
            await reply(
                '╭━━〔 ⚠️ *NUMBER CHECK ERROR* 〕━━╮\n\n' +
                '📱 *Number:* +' + number + '\n' +
                '📝 *Error:* ' + String(error?.message || 'Unknown lookup error').slice(0, 220) + '\n' +
                'ℹ️ Status එක තහවුරු කරගන්න බැරි වුණා.\n' +
                '╰━━━━━━━━━━━━━━━━━━━━━━━━━━╯\n\n' + config.texts.footer
            );
        }
    },
};
