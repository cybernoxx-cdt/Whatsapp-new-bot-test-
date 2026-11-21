import { sendMenuMedia } from '../lib/menu-media.js';

// .menu — clean, alphabetically ordered command-only menu.
export default {
    name: 'menu',
    aliases: ['help', 'commands'],
    desc: 'Show all commands',
    ownerOnly: false,

    async run({ config, prefix, state, sock, jid, m }) {
        const commands = state.plugins
            .filter(plugin => !plugin.hidden && plugin.name !== 'menu')
            .map(plugin => `${prefix}${plugin.name}`)
            .sort((a, b) => a.localeCompare(b));

        const caption = [
            `╭━━〔 📋 ${config.botName} 〕━━╮`,
            '',
            '*📞 AUTO CALL*',
            `${prefix}call on`,
            `${prefix}call off`,
            `${prefix}call`,
            `${prefix}call-menu`,
            '',
            '*🔌 PLUGINS*',
            ...commands,
            '',
            '╰━━━━━━━━━━━━━━━━━━╯',
            config.texts.footer,
        ].join('\n');

        await sendMenuMedia(sock, jid, m, caption);
    },
};
