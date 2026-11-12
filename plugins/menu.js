// .menu — lists every loaded plugin automatically

export default {
    name: 'menu',
    aliases: ['help', 'commands'],
    desc: 'Show all commands',
    ownerOnly: false,

    async run({ reply, config, prefix, state }) {
        const lines = state.plugins
            .filter(p => !p.hidden)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(p => `▫️ \`${prefix}${p.name}\` — ${p.desc || 'no description'}`)
            .join('\n');

        await reply(
`📋 *${config.botName} — Menu*

*📞 Auto call*
▫️ \`${prefix}call on\` — enable auto call
▫️ \`${prefix}call off\` — disable auto call
▫️ \`${prefix}call\` — check status
▫️ \`${prefix}call-menu\` — call menu

*🔌 Plugins*
${lines}

${config.texts.footer}`);
    },
};
