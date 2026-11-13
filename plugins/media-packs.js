import { downloadContentFromMessage } from '@dnuzi/baileys';
import { uploadToUrl } from '../media-packs.js';

function unwrap(message) {
  let current = message;
  while (current?.ephemeralMessage?.message || current?.documentWithCaptionMessage?.message) {
    current = current.ephemeralMessage?.message || current.documentWithCaptionMessage?.message;
  }
  return current || {};
}

function mediaFromMessage(message) {
  const node = unwrap(message);
  for (const key of ['videoMessage', 'audioMessage', 'imageMessage', 'documentMessage']) {
    if (node?.[key]) return { node: node[key], type: key.replace('Message', '') };
  }
  return null;
}

function quotedMedia(ctx) {
  const current = mediaFromMessage(ctx.m.message);
  if (current) return current;
  const context = ctx.m.message?.extendedTextMessage?.contextInfo ||
    ctx.m.message?.imageMessage?.contextInfo ||
    ctx.m.message?.videoMessage?.contextInfo ||
    ctx.m.message?.documentMessage?.contextInfo;
  return mediaFromMessage(context?.quotedMessage);
}

async function downloadQuoted(ctx) {
  const found = quotedMedia(ctx);
  if (!found) throw new Error('Media file එකකට reply කරලා .tourl හෝ .addpack යවන්න.');
  const stream = await downloadContentFromMessage(found.node, found.type);
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > 64 * 1024 * 1024) throw new Error('Media file එක 64 MB limit එක ඉක්මවා ඇත.');
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);
  if (!buffer.length) throw new Error('WhatsApp media download එක හිස්.');
  const mime = found.node.mimetype || 'application/octet-stream';
  const name = found.node.fileName || ('whatsapp-' + Date.now());
  return { buffer, mime, name, kind: mediaKindFromMime(mime) };
}

async function uploadAndLink(ctx) {
  const { buffer, mime, name, kind } = await downloadQuoted(ctx);
  await ctx.reply('⏳ DNUZ upload host එකට media upload කරනවා...');
  const uploaded = await uploadToUrl(buffer, name, mime, 0);
  await ctx.reply('✅ *URL ready*\n\n🔗 ' + uploaded.url + '\n\nNo media was saved by the bot. Paste this link into .vcall or .acall with the recipient number.');
}

export default {
  name: 'tourl',
  aliases: [],
  ownerOnly: true,
  async run(ctx) {
    return uploadAndLink(ctx);
  }
};
