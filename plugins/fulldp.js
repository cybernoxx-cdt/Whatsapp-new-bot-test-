// =================================================
// 🖼️ FULL PROFILE PICTURE (No Crop, Dominant Background)
// =================================================
import sharp from 'sharp';
import * as B from '@dnuzi/baileys';

const downloadContentFromMessage =
    B.downloadContentFromMessage ||
    B.default?.downloadContentFromMessage ||
    B.default?.default?.downloadContentFromMessage;

const BOT_NAME = '𝗚𝖮𝖣 𝗩𝖮𝖨𝖯 𝗠𝖣';

const fakeVcardQuote = {
    key: {
        remoteJid: 'status@broadcast',
        participant: '13135550002@s.whatsapp.net',
        fromMe: false,
        id: 'META_SETPP',
    },
    message: {
        contactMessage: {
            displayName: BOT_NAME,
            vcard: `BEGIN:VCARD
VERSION:3.0
N:;${BOT_NAME};;;
FN:${BOT_NAME}
ORG:${BOT_NAME}
TITLE:
item1.TEL;waid=13135550002:+13135550002
item1.X-ABLabel:Mobile
END:VCARD`,
        },
    },
};

export default {
    name: 'setpp',
    aliases: ['fullpp', 'fullprofile'],
    desc: 'Set bot profile picture without cropping',
    ownerOnly: true,

    async run({ sock, m, jid, prefix, isOwner }) {
        try {
            // Owner-only check is also enforced by the central command handler.
            if (!isOwner && !m.key?.fromMe) {
                return await sock.sendMessage(jid, {
                    text: '🔒 මේ command එක owner ට විතරයි.',
                }, { quoted: fakeVcardQuote });
            }

            if (typeof downloadContentFromMessage !== 'function') {
                throw new Error('Baileys media download function is unavailable.');
            }

            const quoted = m.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            const imageMessage = quoted?.imageMessage;
            if (!imageMessage) {
                return await sock.sendMessage(jid, {
                    text: '❌ *Reply to an image!*

> Reply to an image with ' + prefix + 'setpp',
                }, { quoted: fakeVcardQuote });
            }

            await sock.sendMessage(jid, { react: { text: '⏳', key: m.key } });

            const stream = await downloadContentFromMessage(imageMessage, 'image');
            const chunks = [];
            for await (const chunk of stream) chunks.push(chunk);
            const buffer = Buffer.concat(chunks);
            if (!buffer.length) throw new Error('The replied image could not be downloaded.');

            const meta = await sharp(buffer).metadata();
            const W = 360;
            const H = 640;

            // Pick the resized image's dominant/average colour for the canvas.
            const stats = await sharp(buffer).rotate().resize(50, 50, { fit: 'cover' }).stats();
            const rgb = stats.channels.slice(0, 3).map(channel => Math.max(0, Math.min(255, Math.round(channel.mean))));
            const bgColor = { r: rgb[0], g: rgb[1], b: rgb[2], alpha: 1 };

            const finalBuffer = await sharp(buffer)
                .rotate()
                .resize(W, H, { fit: 'contain', background: bgColor })
                .jpeg({ quality: 85, chromaSubsampling: '4:2:0' })
                .toBuffer();

            const botId = sock.user?.id || sock.user?.jid;
            if (!botId) throw new Error('Connected bot identity is unavailable.');
            const botJid = botId.split(':')[0].replace(/\D/g, '') + '@s.whatsapp.net';
            const sizeKB = (finalBuffer.length / 1024).toFixed(1);

            await sock.updateProfilePicture(botJid, finalBuffer);

            await sock.sendMessage(jid, {
                image: finalBuffer,
                caption:
                    '✅ *Profile Picture Updated!*\n\n' +
                    '📐 *Original:* ' + (meta.width || '?') + 'x' + (meta.height || '?') + '\n' +
                    '📐 *Canvas:* ' + W + 'x' + H + '\n' +
                    '📦 *File:* ' + sizeKB + ' KB\n' +
                    '🎨 *BG:* rgb(' + rgb.join(', ') + ')\n\n' +
                    '> _Full image displayed without cropping_\n' +
                    '> © ' + BOT_NAME,
            }, { quoted: fakeVcardQuote });

            await sock.sendMessage(jid, { react: { text: '✅', key: m.key } });
        } catch (err) {
            console.error('[SETPP] Error:', err?.message || err);
            try {
                await sock.sendMessage(jid, {
                    text: '❌ *SetPP Error*\n\n> ' + (err?.message || 'Unknown error'),
                }, { quoted: m });
            } catch {}
            try {
                await sock.sendMessage(jid, { react: { text: '❌', key: m.key } });
            } catch {}
        }
    },
};
