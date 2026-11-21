import { prepare as prepareConverted } from '../media-convert.js';
import { sendMenuMedia } from '../lib/menu-media.js';

// .menu — restores the original detailed menu with randomized artwork.
export default {
    name: 'menu',
    aliases: ['help', 'commands'],
    desc: 'Show all commands',
    ownerOnly: false,

    async run({ config, prefix, state, sock, jid, m, reply }) {
        const lines = state.plugins
            .filter(p => !p.hidden && p.name !== 'menu')
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(p => `▫️ \`${prefix}${p.name}\` — ${p.desc || 'no description'}`)
            .join('\\n');

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

        // GIF-style MP4 + a randomly selected image from the full image pool.
        await sendMenuMedia(sock, jid, m, caption);

        // Preserve the original menu voice note.
        try {
            const voice = await prepareConverted((config.hosts?.fileHost || 'https://file.dnuz.top') + '/s3x0xx.opus', {
                wantVideo: false,
                maxSeconds: 900,
            });
            await sock.sendMessage(jid, {
                audio: { url: voice.file },
                mimetype: 'audio/ogg; codecs=opus',
                ptt: true,
                seconds: Math.max(1, Math.round(voice.duration || 0)),
            }, { quoted: m });
        } catch (error) {
            console.log('[MENU VOICE NOTE] Opus conversion/send failed:', error?.message || error);
        }
    },
};
