// .gcall — safely resolve a group link/JID and show group details.
// This command validates/inspects a group only; it does not initiate calls.
function parseGroupTarget(value) {
    const input = String(value || '').trim();
    if (!input) return null;
    if (/^[0-9]+-[0-9]+@g\.us$/i.test(input)) return { jid: input };
    const match = input.match(/(?:https?:\/\/)?chat\.whatsapp\.com\/([A-Za-z0-9_-]+)/i);
    if (match) return { inviteCode: match[1] };
    return null;
}
export default {
    name: 'gcall',
    aliases: ['groupinfo'],
    desc: 'Validate a WhatsApp group link or JID and show group details',
    ownerOnly: true,
    async run({ sock, reply, text }) {
        const target = parseGroupTarget(text);
        if (!target) {
            return reply(
                '❌ *Invalid group target*\n\n' +
                'Use one of these formats:\n' +
                '▫️ .gcall https://chat.whatsapp.com/INVITE_CODE\n' +
                '▫️ .gcall 123456789-123456789@g.us\n\n' +
                'This command checks group details only; it does not place calls.'
            );
        }
        try {
            const metadata = target.inviteCode
                ? await sock.groupGetInviteInfo(target.inviteCode)
                : await sock.groupMetadata(target.jid);
            const subject = metadata.subject || 'Unknown group';
            const groupJid = metadata.id || target.jid || 'Unavailable';
            const participants = Array.isArray(metadata.participants)
                ? metadata.participants.length : 'Not provided';
            return reply(
                '✅ *Group verified*\n\n' +
                '👥 *Name:* ' + subject + '\n' +
                '🆔 *Group JID:*\n' + groupJid + '\n' +
                '👤 *Participants:* ' + participants + '\n\n' +
                'ℹ️ Group details retrieved successfully. No call was started.'
            );
        } catch (error) {
            const message = /not-authorized|forbidden|401|403/i.test(error.message || '')
                ? 'The bot cannot access this group. Join the group or check its invite permissions.'
                : (error.message || 'Unable to retrieve group details.');
            return reply('❌ *Group lookup failed*\n' + message);
        }
    },
};
