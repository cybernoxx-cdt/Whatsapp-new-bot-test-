// .ping — check bot response speed

export default {
    name: 'ping',
    aliases: ['speed'],
    desc: 'Check bot response speed',
    ownerOnly: false,

    async run({ sock, jid, m, config }) {
        const t = Date.now();
        const sent = await sock.sendMessage(jid, { text: '🏓 Pinging...' }, { quoted: m });
        const ms = Date.now() - t;
        const result = `🏓 *Pong!*\n⚡ Speed: *${ms} ms*\n\n${config.texts.footer}`;
        try {
            await sock.sendMessage(jid, { text: result, edit: sent.key });
        } catch {
            await sock.sendMessage(jid, { text: result }, { quoted: m });
        }
    },
};
