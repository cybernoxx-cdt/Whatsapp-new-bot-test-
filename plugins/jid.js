// .jid — show the current chat and your own WhatsApp JID.
export default {
    name: 'jid',
    aliases: ['myjid'],
    desc: 'Show this chat JID and your sender JID',
    ownerOnly: false,
    async run({ reply, m, jid }) {
        const key = m?.key || {};
        const sender = key.participant || key.participantAlt ||
            key.participantPn || key.remoteJidAlt ||
            (key.fromMe ? key.remoteJid : '');
        const chatType = jid?.endsWith('@g.us') ? 'GROUP' :
            jid?.endsWith('@s.whatsapp.net') ? 'PRIVATE CHAT' : 'CHAT';
        await reply(
            '🆔 *WhatsApp JID Information*\n\n' +
            '💬 *Chat type:* ' + chatType + '\n' +
            '📌 *Chat JID:*\n' + (jid || 'Unavailable') + '\n\n' +
            '👤 *Your sender JID:*\n' + (sender || 'Unavailable')
        );
    },
};
