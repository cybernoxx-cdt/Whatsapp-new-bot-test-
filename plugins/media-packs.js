import { downloadContentFromMessage } from '@dnuzi/baileys';
import { uploadToUrl, saveMediaAsset, listPacks, listPackItems, mediaKindFromMime, randomUploadName } from '../media-packs.js';

function unwrap(message) {
  let m = message;
  while (m?.ephemeralMessage?.message || m?.viewOnceMessage?.message || m?.viewOnceMessageV2?.message) {
    m = m.ephemeralMessage?.message || m.viewOnceMessage?.message || m.viewOnceMessageV2?.message;
  }
  return m || {};
}

function quotedMedia(ctx) {
  const context = ctx.m.message?.extendedTextMessage?.contextInfo ||
    ctx.m.message?.imageMessage?.contextInfo ||
    ctx.m.message?.videoMessage?.contextInfo;
  const message = unwrap(context?.quotedMessage);
  for (const key of ['videoMessage', 'audioMessage', 'imageMessage', 'documentMessage']) {
    if (message[key]) return { node: message[key], type: key.replace('Message', ''), message };
  }
  return null;
}

async function downloadQuoted(ctx) {
  const found = quotedMedia(ctx);
  if (!found) throw new Error('Video/Audio එකකට reply කරලා command එක යවන්න.');
  const stream = await downloadContentFromMessage(found.node, found.type);
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > 64 * 1024 * 1024) throw new Error('Media file එක 64MB limit එක ඉක්මවා ඇත.');
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);
  if (!buffer.length) throw new Error('Media download හිස්.');
  const mime = found.node.mimetype || 'application/octet-stream';
  const name = found.node.fileName || ('whatsapp-' + Date.now());
  return { buffer, mime, name, kind: mediaKindFromMime(mime) };
}

async function uploadAndSave(ctx, pack) {
  const { buffer, mime, name, kind } = await downloadQuoted(ctx);
  if (!['video', 'audio'].includes(kind) && pack !== 'uploads') {
    throw new Error('.addpack සඳහා Video හෝ Audio එකක් අවශ්‍යයි.');
  }
  await ctx.reply('⏳ Media upload කර MongoDB එකේ save කරනවා...');
  const filename = randomUploadName(name, mime);
  const uploaded = await uploadToUrl(buffer, filename, mime, 0);
  const asset = await saveMediaAsset({
    owner: ctx.m.key.participant || ctx.m.key.remoteJid,
    pack: pack.toLowerCase(),
    kind, name, mime, size: buffer.length,
    url: uploaded.url, storageKey: uploaded.key
  });
  await ctx.reply('✅ Upload complete\n📦 Pack: ' + pack + '\n🎞️ Type: ' + kind + '\n🔗 ' + asset.url);
}

export default {
  name: 'addpack',
  aliases: ['mypack', 'tourl'],
  ownerOnly: true,
  async run(ctx) {
    const command = (ctx.m.message?.conversation || ctx.m.message?.extendedTextMessage?.text || '').trim().split(/\s+/)[0].slice(ctx.prefix.length).toLowerCase();
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
      const lines = items.map((x, i) => (i + 1) + '. ' + x.kind + ' | ' + x.name + '\n' + x.url);
      return ctx.reply('📦 *' + pack + '*\n\n' + lines.join('\n\n'));
    }
    const packs = await listPacks();
    if (!packs.length) return ctx.reply('තවම media packs save කරලා නැහැ. Video/Audio එකකට reply කරලා .addpack vibe යවන්න.');
    return ctx.reply('📚 *MY MEDIA PACKS*\n\n' + packs.map(x => '📦 *' + x._id + '* — 🎬 ' + x.videos + ' | 🎵 ' + x.audios + ' | Total ' + x.total).join('\n') + '\n\n.vcall packname 947XXXXXXXX\n.acall packname 947XXXXXXXX');
  }
};
