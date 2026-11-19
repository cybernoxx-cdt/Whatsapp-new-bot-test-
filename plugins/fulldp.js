// =================================================
// 🖼️ FULL PROFILE PICTURE (No Crop, Full Display)
// =================================================
import sharp from 'sharp';
import * as B from '@dnuzi/baileys';
import config from '../config.js';

const downloadContentFromMessage =
    B.downloadContentFromMessage ||
    B.default?.downloadContentFromMessage;

const fakeVcardQuote = {
    key: {
        remoteJid: 'status@broadcast',
        participant: '13135550002@s.whatsapp.net',
        fromMe: false,
        id: 'META_SETPP',
    },
    message: {
        contactMessage: {
            displayName: '𝗚𝖮𝖣 𝗩𝖮𝖨𝖯 𝗠𝖣',
            vcard: 'BEGIN:VCARD\nVERSION:3.0\nN:;𝗚𝖮𝖣 𝗩𝖮𝖨𝖯 𝗠𝖣;;;;\nFN:𝗚𝖮𝖣 𝗩𝖮𝖨𝖯 𝗠𝖣\nORG:𝗚𝖮𝖣 𝗩𝖮𝖨𝖯 𝖬𝖣\nTITLE:\nitem1.TEL;waid=13135550002:+13135550002\nitem1.X-ABLabel:Mobile\nEND:VCARD',
        },
    },
};

export default {
    name: 'fullpp',
    aliases: ['fulldp', 'setpp'],
    desc: 'Set bot profile picture without cropping',
    ownerOnly: true,

    async run({ sock, m, jid, reply, prefix, isOwner }) {
        try {
            // Owner validation is also enforced centrally by index.js.
            if (!isOwner && !m.key?.fromMe) {
                return await sock.sendMessage(jid, {
                    text: '❌ Permission denied. Only the bot owner can change the profile picture.',
                }, { quoted: fakeVcardQuote });
            }

            if (typeof downloadContentFromMessage !== 'function') {
                throw new Error('Baileys downloadContentFromMessage export is unavailable.');
            }

            const quoted = m.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            const imageMessage = quoted?.imageMessage;

            if (!imageMessage) {
                return await sock.sendMessage(jid, {
                    text: '⚠️ Reply to an image with ' + prefix + 'fullpp',
                }, { quoted: fakeVcardQuote });
            }

            await sock.sendMessage(jid, { react: { text: '⏳', key: m.key } });

            const stream = await downloadContentFromMessage(imageMessage, 'image');
            let buffer = Buffer.alloc(0);
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
            }
            if (!buffer.length) throw new Error('The replied image could not be downloaded.');

            const meta = await sharp(buffer).metadata();
            const W = 640;
            const H = 640;

            const finalBuffer = await sharp(buffer)
                .rotate()
                .resize(W, H, {
                    fit: 'contain',
                    background: { r: 0, g: 0, b: 0, alpha: 1 },
                })
                .jpeg({ quality: 90, chromaSubsampling: '4:2:0' })
                .toBuffer();

            const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
            const sizeKB = (finalBuffer.length / 1024).toFixed(2);

            console.log(
                '[FULLPP] Updated image:',
                W + 'x' + H,
                '| Original:',
                (meta.width || '?') + 'x' + (meta.height || '?'),
                '|',
                sizeKB + ' KB'
            );

            await sock.updateProfilePicture(botJid, finalBuffer);

            await sock.sendMessage(jid, {
                image: finalBuffer,
                caption:
                    '✅ *Profile Picture Updated!*\n\n' +
                    '📐 *Original:* ' + (meta.width || '?') + 'x' + (meta.height || '?') + '\n' +
                    '📐 *Canvas:* ' + W + 'x' + H + '\n' +
                    '📦 *File:* ' + sizeKB + ' KB\n\n' +
                    '> _Full Image Displayed (No Crop)_\n' +
                    '> © 𝗚𝖮𝖣 𝗩𝖮𝖨𝖯 𝖬𝖣',
            }, { quoted: fakeVcardQuote });

            await sock.sendMessage(jid, { react: { text: '✅', key: m.key } });
        } catch (err) {
            console.error('[FULLPP] Error:', err?.message || err);
            await sock.sendMessage(jid, {
                text: '❌ *SetPP Error*\n\n> ' + (err?.message || 'Unknown error') +
                    '\n\n_Please make sure sharp is installed._',
            }, { quoted: fakeVcardQuote });
            try {
                await sock.sendMessage(jid, { react: { text: '❌', key: m.key } });
            } catch {}
        }
    },
};
