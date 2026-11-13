// .menu — lists every loaded plugin automatically

export default {
    name: 'menu',
    aliases: ['help', 'commands'],
    desc: 'Show all commands',
    ownerOnly: false,

    async run({ reply, config, prefix, state, sock, jid, m }) {
        const lines = state.plugins
            .filter(p => !p.hidden)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(p => `▫️ \`${prefix}${p.name}\` — ${p.desc || 'no description'}`)
            .join('\n');

        const caption =
`📋 *${config.botName} — Menu*

*📞 Auto call*
▫️ \`${prefix}call on\` — enable auto call
▫️ \`${prefix}call off\` — disable auto call
▫️ \`${prefix}call\` — check status
▫️ \`${prefix}call-menu\` — call menu

*🔌 Plugins*
${lines}

${config.texts.footer}`;
        if (state.menuImageUrl) {
            await sock.sendMessage(jid, { image: { url: state.menuImageUrl }, caption }, { quoted: m });
        } else {
            await reply(caption);
        }
    },
};
