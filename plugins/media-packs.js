import { downloadContentFromMessage } from '@dnuzi/baileys';
import { uploadToUrl, saveMediaAsset, listPacks, listPackItems, mediaKindFromMime, randomUploadName } from '../media-packs.js';

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

async function uploadAndSave(ctx, pack) {
  const { buffer, mime, name, kind } = await downloadQuoted(ctx);
  if (pack !== 'uploads' && !['video', 'audio'].includes(kind)) {
    throw new Error('.addpack සඳහා Video හෝ Audio file එකක් අවශ්‍යයි.');
  }

  await ctx.reply('⏳ DNUZ upload host එකට media upload කරනවා...');
  const filename = randomUploadName(name, mime);
  const uploaded = await uploadToUrl(buffer, filename, mime, 0);

  // MongoDB stores only the public URL and metadata, never the binary media.
  await saveMediaAsset({
    owner: ctx.m.key.participant || ctx.m.key.remoteJid,
    pack, kind, name, mime, size: buffer.length,
    url: uploaded.url, storageKey: uploaded.key
  });

  if (pack === 'uploads') {
    await ctx.reply('✅ *Upload complete*\n\n🔗 Your link:\n' + uploaded.url + '\n\n📞 Use: .vcall 947XXXXXXXX');
  } else {
    await ctx.reply('✅ *Pack saved*\n📦 Pack: ' + pack + '\n🎞️ Type: ' + kind + '\n🔗 ' + uploaded.url);
  }
}

export default {
  name: 'addpack',
  aliases: ['mypack', 'tourl'],
  ownerOnly: true,
  async run(ctx) {
    const body = ctx.m.message?.conversation || ctx.m.message?.extendedTextMessage?.text || '';
    const command = body.trim().split(/\s+/)[0].slice(ctx.prefix.length).toLowerCase();

    if (command === 'addpack') {
      const pack = ctx.args.join(' ').trim().toLowerCase();
      if (!pack || pack.length > 40) return ctx.reply('Use: .addpack packname (reply to a video/audio)');
      return uploadAndSave(ctx, pack);
    }
    if (command === 'tourl') return uploadAndSave(ctx, 'uploads');

    const pack = ctx.args.join(' ').trim().toLowerCase();
    if (pack) {
      const items = await listPackItems(pack);
      if (!items.length) return ctx.reply('📦 Pack එක හමු වුණේ නැහැ: ' + pack);
      return ctx.reply('📦 *' + pack + '*\n\n' + items.map((item, i) => (i + 1) + '. ' + item.kind + ' | ' + item.name + '\n' + item.url).join('\n\n'));
    }
    const packs = await listPacks();
    if (!packs.length) return ctx.reply('තවම media packs නැහැ. Media එකකට reply කරලා .addpack packname යවන්න.');
    return ctx.reply('📚 *MY MEDIA PACKS*\n\n' + packs.map(x => '📦 *' + x._id + '* — 🎬 ' + x.videos + ' | 🎵 ' + x.audios + ' | Total ' + x.total).join('\n') + '\n\n.vcall packname 947XXXXXXXX\n.acall packname 947XXXXXXXX');
  }
};
