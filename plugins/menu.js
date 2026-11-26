import { randomMenuImage } from '../lib/menu-media.js';

const commandRows = (plugins, prefix) => plugins
    .filter(plugin => !plugin.hidden && plugin.name !== 'menu')
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(plugin => ({
        title: `${prefix}${plugin.name}`,
        description: String(plugin.desc || 'Run command').slice(0, 70),
        id: `${prefix}${plugin.name}`,
    }));

async function sendInteractive(sock, jid, m, payload) {
    try {
        await sock.sendMessage(jid, payload, { quoted: m });
    } catch (error) {
        console.log('[MENU INTERACTIVE] Falling back to text:', error?.message || error);
        const text = payload.caption || payload.text || 'Menu unavailable';
        await sock.sendMessage(jid, { text }, { quoted: m });
    }
}

export default {
    name: 'menu',
    aliases: ['help', 'commands'],
    desc: 'Advanced interactive command menu',
    ownerOnly: false,

    async run({ config, prefix, state, sock, jid, m, args = [] }) {
        const section = String(args[0] || '').toLowerCase();
        const rows = commandRows(state.plugins || [], prefix);
        const footer = config.texts?.footer || `✦ ${config.botName}`;

        if (section === 'calls') {
            const caption = [
                `╭━━〔 📞 ${config.botName} CALL CENTER 〕━━╮`,
                '',
                '*AUTO CALL CONTROL*',
                `▫️ Current status: ${state.callOn ? '🟢 ON' : '🔴 OFF'}`,
                `▫️ Enable: \`${prefix}call on\``,
                `▫️ Disable: \`${prefix}call off\``,
                '',
                '*OUTGOING CALLS · OWNER*',
                `▫️ Video: \`${prefix}vcall 94771234567\``,
                `▫️ Audio: \\`${prefix}acall 94771234567\\``,
                `▫️ Multiple: \`${prefix}acall 9477...,9476...\``,
                '',
                '*TOOLS*',
                `▫️ Speed test: \`${prefix}c-ping\``,
                footer,
            ].join('\n');

            return sendInteractive(sock, jid, m, {
                text: caption,
                footer,
                nativeFlow: [
                    { text: state.callOn ? '🔴 Turn Auto Call OFF' : '🟢 Turn Auto Call ON', id: `${prefix}call ${state.callOn ? 'off' : 'on'}` },
                    { text: '🏓 Test Speed', id: `${prefix}c-ping` },
                    { text: '↩️ Main Menu', id: `${prefix}menu` },
                ],
            });
        }

        if (section === 'commands') {
            const grouped = [];
            for (let i = 0; i < rows.length; i += 10) {
                grouped.push({
                    title: i === 0 ? 'Available Plugins' : `More Commands · ${Math.floor(i / 10) + 1}`,
                    rows: rows.slice(i, i + 10),
                });
            }
            return sendInteractive(sock, jid, m, {
                text: [
                    `╭━━〔 📚 ${config.botName} COMMANDS 〕━━╮`,
                    '',
                    `Total plugins: *${rows.length}*`,
                    'Tap a command below to run it.',
                    '',
                    footer,
                ].join('\n'),
                footer,
                nativeFlow: [
                    { text: '↩️ Main Menu', id: `${prefix}menu` },
                    ...(grouped.length ? [{ text: '📂 Select Command', sections: grouped }] : []),
                ],
            });
        }

        const caption = [
            `╭━━〔 👑 ${config.botName} 〕━━╮`,
            '',
            '✨ *ADVANCED CONTROL PANEL*',
            'Fast commands · Interactive controls · Rich responses',
            '',
            `📦 *Plugins:* ${rows.length}`,
            `📞 *Auto Call:* ${state.callOn ? '🟢 ENABLED' : '🔴 DISABLED'}`,
            '',
            '*QUICK ACCESS*',
            `▫️ \`${prefix}alive\` — Online status`,
            `▫️ \`${prefix}info\` — Bot & server information`,
            `▫️ \`${prefix}call-menu\` — Call controls`,
            `▫️ \`${prefix}menu commands\` — All plugins`,
            '',
            footer,
        ].join('\n');

        return sendInteractive(sock, jid, m, {
            image: { url: randomMenuImage() },
            caption,
            footer,
            nativeFlow: [
                { text: '📞 Call Controls', id: `${prefix}menu calls` },
                { text: '📚 All Commands', id: `${prefix}menu commands` },
                { text: '📊 Bot Info', id: `${prefix}info` },
                { text: '🟢 Alive', id: `${prefix}alive` },
                ...(rows.length ? [{
                    text: '🧩 Browse Plugins',
                    sections: [{
                        title: 'Available Commands',
                        rows: rows.slice(0, 10),
                    }],
                }] : []),
            ],
        });
    },
};
