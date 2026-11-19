// .fullpp — set the bot's profile picture without cropping.
import sharp from 'sharp';
import * as B from '@dnuzi/baileys';

const unwrap = value => value?.ephemeralMessage?.message
    || value?.viewOnceMessage?.message
    || value?.viewOnceMessageV2?.message
    || value?.documentWithCaptionMessage?.message
    || value;

export default {
    name: 'fullpp',
    aliases: ['fulldp', 'setpp', 'setbotpp', 'botpp'],
    desc: 'Set bot profile picture without cropping',
    ownerOnly: true,
    async run({ sock, m, jid, reply, prefix, getCachedMessage }) {
        try {
            const context = m.message?.extendedTextMessage?.contextInfo
                || unwrap(m.message)?.imageMessage?.contextInfo;
            let target = unwrap(m.message)?.imageMessage ? m : null;
            if (!target && context?.stanzaId) {
                const cached = getCachedMessage?.(context.stanzaId);
                if (cached && unwrap(cached.message)?.imageMessage) target = cached;
                else if (unwrap(context.quotedMessage)?.imageMessage) {
                    target = { key: { remoteJid: jid, id: context.stanzaId, fromMe: false, participant: context.participant }, message: context.quotedMessage };
                }
            }
            if (!target) return reply(\`🖼️ *Full Profile Picture*\n\nReply to an image with \${prefix}fullpp or send an image with .fullpp as its caption.\`);
            await sock.sendMessage(jid, { react: { text: '⏳', key: m.key } });
            const buffer = await B.downloadMediaMessage(target, 'buffer', {}, { reuploadRequest: sock.updateMediaMessage });
            const meta = await sharp(buffer).metadata();
            const output = await sharp(buffer).rotate().resize(640, 640, {
                fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 1 },
            }).jpeg({ quality: 90, chromaSubsampling: '4:2:0' }).toBuffer();
            await sock.updateProfilePicture(B.jidNormalizedUser(sock.user.id), output);
            await sock.sendMessage(jid, {
                image: output,
                caption: \`✅ *Profile Picture Updated*\n📐 Original: \${meta.width || '?'} × \${meta.height || '?'}\n📐 Canvas: 640 × 640\n✦ Full image · No crop\n\n𝗚𝖮𝖣 𝗩𝖮𝖨𝖯 𝗠𝖣\`,
            }, { quoted: m });
            await sock.sendMessage(jid, { react: { text: '✅', key: m.key } });
        } catch (error) {
            console.error('[FULLPP]', error?.message || error);
            await reply(\`❌ *FullPP failed:* \${error?.message || 'Unable to update profile picture.'}\`);
            try { await sock.sendMessage(jid, { react: { text: '❌', key: m.key } }); } catch {}
        }
    },
};
