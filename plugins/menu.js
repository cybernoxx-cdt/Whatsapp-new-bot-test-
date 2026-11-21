import { prepare as prepareConverted } from '../media-convert.js';

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
            try {
                await sock.sendMessage(jid, { image: { url: state.menuImageUrl }, caption }, { quoted: m });
            } catch (e) {
                console.log('[MENU] Image send failed, falling back to text menu:', e?.message || e);
                await reply(caption);
            }
        } else {
            await reply(caption);
        }

        // Convert the source into real OGG/Opus before sending as a WhatsApp PTT.
        // The URL extension is not trusted; FFmpeg probes and converts the actual media.
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
