import { checkStatusWA } from '@dnuzi/baileys';

// .check — WhatsApp status lookup using @dnuzi/baileys 0.1.3.
// A failed lookup is never presented as a confirmed ban/clean result.
const cleanNumber = value => String(value || '').replace(/\\D/g, '');

const errorLike = value => {
    const status = String(value?.status ?? '').toLowerCase();
    return !value || ['error', 'failed', 'failure', 'unavailable'].includes(status) ||
        Boolean(value?.error && value?.isBanned === undefined);
};

const describeFailure = (value, thrown) => {
    const candidates = [
        value?.error?.message,
        value?.error,
        value?.message,
        value?.details,
        thrown?.message,
        typeof value === 'string' ? value : ''
    ].filter(Boolean);

    let detail = candidates.length ? candidates[0] : '';
    if (detail && typeof detail === 'object') {
        try { detail = JSON.stringify(detail); } catch { detail = '[unserializable error object]'; }
    }
    if (!detail && value && typeof value === 'object') {
        detail = 'API returned an unsuccessful response (fields: ' + Object.keys(value).join(', ') + ')';
    }
    return String(detail || 'Baileys lookup returned no usable result').slice(0, 240);
};

export default {
    name: 'check',
    aliases: ['numbercheck', 'wa-check'],
    desc: 'Check WhatsApp number status',
    ownerOnly: true,

    async run({ sock, args, reply, prefix, config }) {
        const number = cleanNumber(args[0]);
        if (number.length < 8 || number.length > 15) {
            return reply(
                '╭━━〔 🔎 *NUMBER CHECK* 〕━━╮\\n' +
                '📱 *Usage:* `' + prefix + 'check 94771234567`\\n' +
                'Country code සමඟ number එක ලබාදෙන්න.\\n' +
                '╰━━━━━━━━━━━━━━━━━━╯\\n\\n' + config.texts.footer
            );
        }

        await reply('⏳ *Checking WhatsApp number...*\\nPlease wait a moment.');
        try {
            let result;
            let lookupError;

            // Primary API documented by @dnuzi/baileys v0.1.3.
            try {
                result = await checkStatusWA('+' + number);
            } catch (error) {
                lookupError = error;
            }

            // Try socket API only when standalone lookup failed or returned an error.
            if (errorLike(result) && typeof sock?.checkStatusWA === 'function') {
                try {
                    const socketResult = await sock.checkStatusWA('+' + number);
                    if (!errorLike(socketResult)) result = socketResult;
                    else if (!result) result = socketResult;
                } catch (error) {
                    lookupError = error;
                }
            }

            if (errorLike(result)) {
                return reply(
                    '╭━━〔 ⚠️ *NUMBER CHECK UNAVAILABLE* 〕━━╮\\n\\n' +
                    '📱 *Number:* +' + number + '\\n' +
                    '📊 *Lookup:* Failed / service unavailable\\n' +
                    '🔎 *Response:* ' + String(result?.status || 'error').toUpperCase() + '\\n' +
                    '📝 *Details:* ' + describeFailure(result, lookupError) + '\\n\\n' +
                    'ℹ️ Number එකේ status එක තහවුරු කරගන්න බැරි වුණා. පසුව නැවත උත්සාහ කරන්න.\\n' +
                    '╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯\\n\\n' + config.texts.footer
                );
            }

            // Only explicit API fields are treated as authoritative.
            const status = String(result?.status || 'unknown').toLowerCase();
            const labels = {
                active: 'ACTIVE',
                registered: 'ACTIVE',
                banned: 'BANNED',
                blocked: 'BLOCKED',
                not_registered: 'NOT REGISTERED',
                rate_limited: 'RATE LIMITED',
                unknown: 'UNKNOWN'
            };
            const bannedKnown = typeof result?.isBanned === 'boolean' || status === 'banned';
            const isBanned = result?.isBanned === true || status === 'banned';
            const officialKnown = typeof result?.isNeedOfficialWa === 'boolean';

            const lines = [
                '╭━━〔 🔎 *NUMBER CHECK* 〕━━╮',
                '',
                '📱 *Number:* +' + number,
                '📊 *Status:* ' + (labels[status] || status.toUpperCase()),
                '🚫 *Banned:* ' + (bannedKnown ? (isBanned ? 'Yes' : 'No') : 'Unknown'),
                '📲 *Official WhatsApp required:* ' + (officialKnown ? (result.isNeedOfficialWa ? 'Yes' : 'No') : 'Unknown'),
                result?.banInfo?.banType ? '⚠️ *Ban type:* ' + String(result.banInfo.banType) : '',
                '',
                '╰━━━━━━━━━━━━━━━━━━╯',
                config.texts.footer
            ].filter(Boolean);

            return reply(lines.join('\\n'));
        } catch (error) {
            return reply(
                '╭━━〔 ⚠️ *NUMBER CHECK ERROR* 〕━━╮\\n\\n' +
                '📱 *Number:* +' + number + '\\n' +
                '📝 *Error:* ' + describeFailure(null, error) + '\\n' +
                'ℹ️ Status එක තහවුරු කරගන්න බැරි වුණා.\\n' +
                '╰━━━━━━━━━━━━━━━━━━━━━━━━━━╯\\n\\n' + config.texts.footer
            );
        }
    },
};
