import { sendMenuMedia } from '../lib/menu-media.js';

// Premium command menu: original layout with plugin descriptions removed.
export default {
    name: 'menu',
    aliases: ['help', 'commands'],
    desc: 'Show all commands',
    ownerOnly: false,

    async run({ config, prefix, state, sock, jid, m }) {
        const commands = state.plugins
            .filter(plugin => !plugin.hidden && plugin.name !== 'menu')
            .map(plugin => plugin.name)
            .sort((a, b) => a.localeCompare(b))
            .map(name => '▫️ `' + prefix + name + '`');

        const caption = [
            '📋 *' + config.botName + ' — Menu*',
            '',
            '*📞 Auto call*',
            '▫️ `' + prefix + 'call on` — enable auto call',
            '▫️ `' + prefix + 'call off` — disable auto call',
            '▫️ `' + prefix + 'call` — check status',
            '▫️ `' + prefix + 'call-menu` — call menu',
            '',
            '*🔌 Plugins*',
            ...commands,
            '',
            '> ✦ ' + config.botName,
        ].join('\n');

        await sendMenuMedia(sock, jid, m, caption);
    },
};