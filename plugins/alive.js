// .alive — show that the bot is online
import { formatUptime } from './_utils.js';
import { randomMenuImage } from '../lib/menu-media.js';

export default {
    name: 'alive',
    aliases: ['online', 'bot'],
    desc: 'Check bot status with a random image',
    ownerOnly: false,

    async run({ sock, jid, m, config, prefix, state }) {
        const caption = [
            `╭━━〔 🟢 ${config.botName} 〕━━╮`,
            '│  Status   : ONLINE',
            `│  Auto Call: ${state.callOn ? '🟢 ON' : '🔴 OFF'}`,
            `│  Uptime   : ${formatUptime(process.uptime())}`,
            `│  Version  : ${config.version}`,
            `│  Owner    : ${config.ownerName}`,
            '╰━━━━━━━━━━━━━━━━━━╯',
            '',
            `Type ${prefix}menu to view commands.`,
            '',
            config.texts.footer,
        ].join('\n');
        try {
            await sock.sendMessage(jid, {
                image: { url: randomMenuImage() },
                caption: `🟢 ${config.botName} · ONLINE`,
            }, { quoted: m });
            await sock.sendMessage(jid, {
                text: caption,
                footer: config.texts.footer,
                nativeFlow: [
                    { text: '📚 Open Menu', id: `${prefix}menu` },
                    { text: '📊 Bot Info', id: `${prefix}info` },
                    { text: '📞 Call Controls', id: `${prefix}menu calls` },
                ],
            }, { quoted: m });
        } catch (error) {
            console.log('[ALIVE IMAGE] Send failed:', error?.message || error);
            await sock.sendMessage(jid, { text: caption }, { quoted: m });
        }
    },
};
