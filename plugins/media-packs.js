import { downloadContentFromMessage } from '@dnuzi/baileys';
import { saveLatestCallMedia } from '../media-store.js';

function unwrap(message) {
  let current = message || {};
  for (let i = 0; i < 8; i++) {
    const next = current.ephemeralMessage?.message ||
      current.documentWithCaptionMessage?.message ||
      current.viewOnceMessage?.message ||
      current.viewOnceMessageV2?.message;
    if (!next) break;
    current = next;
  }
  return current;
}

function mediaFromMessage(message) {
  const node = unwrap(message);
  for (const key of ['videoMessage', 'audioMessage', 'documentMessage']) {
    if (node?.[key]) return { node: node[key], type: key.replace('Message', ''), key };
  }
  return null;
}

function findMedia(ctx) {
  const current = mediaFromMessage(ctx.m.message);
  if (current) return current;

  const outer = ctx.m.message || {};
  const context = outer.extendedTextMessage?.contextInfo ||
    outer.imageMessage?.contextInfo ||
    outer.videoMessage?.contextInfo ||
    outer.audioMessage?.contextInfo ||
    outer.documentMessage?.contextInfo;
  return mediaFromMessage(context?.quotedMessage);
}

async function readStream(stream) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > 150 * 1024 * 1024) throw new Error('Media file එක 150 MB limit එක ඉක්මවා ඇත.');
    chunks.push(Buffer.from(chunk));
  }
  const buffer = Buffer.concat(chunks);
  if (!buffer.length) throw new Error('WhatsApp media download එක හිස්.');
  return buffer;
}

async function downloadMedia(found) {
  if (!found.node?.url && !found.node?.directPath) {
    throw new Error('Quoted media එකේ WhatsApp download path එක නැහැ. Senderගෙන් media එක නැවත normal media එකක් ලෙස එවන්න කියන්න.');
  }
  return readStream(await downloadContentFromMessage(found.node, found.type));
}

export default {
  name: 'tourl',
  aliases: ['callmedia'],
  ownerOnly: true,
  desc: 'Prepare latest local audio/video media for .acall and .vcall',
  async run(ctx) {
    const found = findMedia(ctx);
    if (!found) return ctx.reply('Audio/video එකකට reply කරලා .tourl යවන්න. Image files call media ලෙස භාවිතා කරන්න බැහැ.');

    try {
      const buffer = await downloadMedia(found);
      const mime = found.node.mimetype || (found.type === 'video' ? 'video/mp4' : 'audio/ogg');
      const name = found.node.fileName || `whatsapp-${Date.now()}`;
      const saved = saveLatestCallMedia(buffer, mime, name);
      const sizeMb = (saved.size / 1024 / 1024).toFixed(2);
      return ctx.reply(
        `✅ *Call media ready*\n\n` +
        `📁 Type: ${found.type.toUpperCase()}\n` +
        `📦 Size: ${sizeMb} MB\n` +
        `🔒 Saved locally for this bot runtime — DNUZ public URL එකක් අවශ්‍ය නැහැ.\n\n` +
        `Use:\n` +
        `▫️ .acall 94771234567\n` +
        `▫️ .vcall 94771234567 (video file එකක් නම්)\n\n` +
        `අලුත් media එකක් .tourl කළාම latest media එක replace වෙනවා.`
      );
    } catch (error) {
      return ctx.reply('⚠️ .tourl media download failed: ' + (error?.message || 'unknown error'));
    }
  }
};
