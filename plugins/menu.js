import { sendMenuMedia } from '../lib/menu-media.js';

// .menu — clean command directory with randomized artwork.
export default {
    name: 'menu',
    aliases: ['help', 'commands'],
    desc: 'Open the command menu',
    ownerOnly: false,

    async run({ config, prefix, state, sock, jid, m }) {
        const commands = state.plugins
            .filter(p => !p.hidden && p.name !== 'menu')
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(p => `│  ◦ ${prefix}${p.name}  —  ${p.desc || 'No description'}`)
            .join('\n');

        const caption = [
            `╭━━〔 ✦ ${config.botName} 〕━━╮`,
            '│',
            `│  📞 Auto Call: ${state.callOn ? '🟢 ON' : '🔴 OFF'}`,
            '│',
            '├──〔 COMMANDS 〕',
            commands || '│  No commands loaded',
            '│',
            '├──〔 QUICK ACCESS 〕',
            `│  ◦ ${prefix}callmenu  —  Call menu`,
            `│  ◦ ${prefix}info      —  Bot information`,
            `│  ◦ ${prefix}alive     —  Bot status`,
            '│',
            '╰━━━━━━━━━━━━━━━━━━╯',
            '',
            config.texts.footer,
        ].join('\n');
        await sendMenuMedia(sock, jid, m, caption);
    },
};
