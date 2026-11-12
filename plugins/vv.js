import { downloadMediaMessage } from '@dnuzi/baileys';
import pino from 'pino';

const logger = pino({ level: 'silent' });
const MEDIA_TYPES = new Set(['imageMessage', 'videoMessage', 'audioMessage']);

function containsViewOnce(message) {
  if (!message || typeof message !== 'object') return false;
  if (message.viewOnceMessage || message.viewOnceMessageV2 || message.viewOnceMessageV2Extension) return true;
  if (message.ephemeralMessage?.message) return containsViewOnce(message.ephemeralMessage.message);
  if (message.documentWithCaptionMessage?.message) return containsViewOnce(message.documentWithCaptionMessage.message);
  return false;
}

function unwrap(message) {
  let current = message || {};
  while (current.ephemeralMessage?.message || current.documentWithCaptionMessage?.message) {
    current = current.ephemeralMessage?.message || current.documentWithCaptionMessage.message;
  }
  return current;
}

export default {
  name: 'vv',
  aliases: ['viewonce', 'vo'],
  desc: 'Re-send a regular quoted image/video/audio',
  ownerOnly: true,
  async run({ sock, jid, m, reply }) {
    const context = m.message?.extendedTextMessage?.contextInfo ||
      m.message?.imageMessage?.contextInfo ||
      m.message?.videoMessage?.contextInfo ||
      m.message?.documentMessage?.contextInfo;
    const quoted = context?.quotedMessage;
    if (!quoted) return reply('Reply to a media message with .vv.');

    // Respect View Once privacy: this command only handles ordinary media.
    if (containsViewOnce(quoted)) {
      return reply('🔒 View Once media cannot be retrieved with .vv. Please ask the sender to share it as a normal media message.');
    }

    const inner = unwrap(quoted);
    const type = Object.keys(inner).find(key => MEDIA_TYPES.has(key));
    if (!type) return reply('No supported image, video or audio media found.');

    const target = {
      key: {
        remoteJid: context.remoteJid || jid,
        id: context.stanzaId,
        participant: context.participant,
        fromMe: false
      },
      message: inner
    };

    let buffer;
    try {
      buffer = await downloadMediaMessage(target, 'buffer', {}, {
        logger,
        reuploadRequest: sock.updateMediaMessage
      });
    } catch (error) {
      return reply('Media download failed: ' + (error?.message || 'unknown error'));
    }

    const content = inner[type];
    const caption = content.caption || undefined;
    const kind = type === 'imageMessage' ? 'image' : type === 'videoMessage' ? 'video' : 'audio';
    const payload = kind === 'image'
      ? { image: buffer, caption }
      : kind === 'video'
        ? { video: buffer, caption, mimetype: content.mimetype || 'video/mp4' }
        : { audio: buffer, mimetype: content.mimetype || 'audio/ogg; codecs=opus', ptt: !!content.ptt };

    try {
      await sock.sendMessage(jid, payload, { quoted: m });
    } catch (error) {
      await reply('Media send failed: ' + (error?.message || 'unknown error'));
    }
  }
};
