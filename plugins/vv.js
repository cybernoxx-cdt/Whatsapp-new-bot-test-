import { downloadContentFromMessage, downloadMediaMessage } from '@dnuzi/baileys';
import pino from 'pino';

const logger = pino({ level: 'silent' });
const MEDIA_TYPES = ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage'];

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

function findMedia(message) {
  const inner = unwrap(message);
  const type = MEDIA_TYPES.find(key => inner?.[key]);
  return type ? { inner, type, content: inner[type] } : null;
}

function containsViewOnce(message, depth = 0) {
  if (!message || typeof message !== 'object' || depth > 8) return false;
  if (message.viewOnceMessage || message.viewOnceMessageV2 || message.viewOnceMessageV2Extension) return true;
  return Object.values(message).some(value => value && typeof value === 'object' && containsViewOnce(value, depth + 1));
}

function getContext(message) {
  const inner = unwrap(message);
  return inner.extendedTextMessage?.contextInfo ||
    inner.imageMessage?.contextInfo ||
    inner.videoMessage?.contextInfo ||
    inner.audioMessage?.contextInfo ||
    inner.documentMessage?.contextInfo ||
    null;
}

async function streamBuffer(content, kind) {
  const stream = await downloadContentFromMessage(content, kind);
  const chunks = [];
  let total = 0;
  for await (const chunk of stream) {
    total += chunk.length;
    if (total > 150 * 1024 * 1024) throw new Error('Media exceeds the 150 MB limit.');
    chunks.push(Buffer.from(chunk));
  }
  const buffer = Buffer.concat(chunks);
  if (!buffer.length) throw new Error('Downloaded media is empty.');
  return buffer;
}

async function getQuotedBuffer(sock, ctx, jid) {
  const quoted = ctx?.quotedMessage;
  if (!quoted) throw new Error('Reply to an image/video/audio/document with .vv.');
  const found = findMedia(quoted);
  if (!found) throw new Error('Quoted message does not contain supported media.');
  const kind = found.type.replace('Message', '');
  try {
    if (!found.content?.url && !found.content?.directPath) {
      throw new Error('WhatsApp media direct path is missing.');
    }
    return { ...found, buffer: await streamBuffer(found.content, kind) };
  } catch (firstError) {
    // Retry through Baileys' message-level downloader, which can request a
    // fresh media URL when the stored directPath has expired.
    const key = {
      remoteJid: ctx.remoteJid || jid,
      id: ctx.stanzaId,
      participant: ctx.participant,
      participantAlt: ctx.participantAlt,
      fromMe: false,
    };
    const target = { key, message: quoted };
    try {
      const buffer = await downloadMediaMessage(target, 'buffer', {}, {
        logger,
        reuploadRequest: message => sock.updateMediaMessage(message),
      });
      return { ...found, buffer };
    } catch (retryError) {
      throw new Error(`Media download failed: ${retryError?.message || firstError?.message || 'unknown error'}. Ask the sender to resend the media, then reply with .vv.`);
    }
  }
}

export default {
  name: 'vv',
  aliases: ['viewonce', 'vo'],
  desc: 'Re-send quoted media that the account is allowed to access',
  ownerOnly: true,
  async run({ sock, jid, m, reply }) {
    const context = getContext(m.message);
    if (!context?.quotedMessage) return reply('Media message එකකට reply කරලා .vv යවන්න.');

    // Do not attempt to bypass View Once protections.
    const quoted = context.quotedMessage;
    if (containsViewOnce(quoted)) return reply('🔒 View Once media සඳහා .vv download කිරීම support කරන්නේ නැහැ. Senderගෙන් normal media එකක් ලෙස නැවත share කරන්න කියන්න.');

    try {
      const found = await getQuotedBuffer(sock, context, jid);
      const content = found.content;
      const caption = content.caption || undefined;
      const kind = found.type === 'imageMessage' ? 'image'
        : found.type === 'videoMessage' ? 'video'
        : found.type === 'audioMessage' ? 'audio' : 'document';

      const payload = kind === 'image'
        ? { image: found.buffer, caption }
        : kind === 'video'
          ? { video: found.buffer, caption, mimetype: content.mimetype || 'video/mp4' }
          : kind === 'audio'
            ? { audio: found.buffer, mimetype: content.mimetype || 'audio/ogg; codecs=opus', ptt: !!content.ptt }
            : { document: found.buffer, mimetype: content.mimetype || 'application/octet-stream', fileName: content.fileName || 'media-file', caption };

      await sock.sendMessage(jid, payload, { quoted: m });
    } catch (error) {
      await reply('⚠️ ' + (error?.message || 'Media resend failed.'));
    }
  }
};
