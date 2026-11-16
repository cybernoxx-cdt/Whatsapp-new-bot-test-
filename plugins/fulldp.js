// .setpp — set the BOT's own profile picture from an image
//   Reply (tag) to an image with  .setpp        -> full picture, no crop (black bars if not square)
//   Reply to an image with        .setpp crop   -> centre-cropped square
//   Or send an image with the caption .setpp
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import * as B from '@dnuzi/baileys';

let FFMPEG = 'ffmpeg';
try { const m = await import('ffmpeg-static'); FFMPEG = m.default || FFMPEG; } catch {}

// Your function, fixed to import the package this bot really uses (@dnuzi/baileys).
async function setOwnPicture(conn, botJid, buffer) {
    try {
        const S_WA = B.S_WHATSAPP_NET || B.default?.S_WHATSAPP_NET || '@s.whatsapp.net';
        await conn.query({
            tag: 'iq',
            attrs: { to: S_WA, type: 'set', xmlns: 'w:profile:picture' },
            content: [{ tag: 'picture', attrs: { type: 'image' }, content: buffer }],
        });
    } catch (e) {
        await conn.updateProfilePicture(botJid, buffer);
    }
}

// any image -> 640x640 JPEG (full = pad, crop = centre crop)
function makeSquare(input, crop) {
    return new Promise((resolve, reject) => {
        const id = crypto.randomBytes(6).toString('hex');
        const src = path.join(os.tmpdir(), `pp_${id}.in`);
        const out = path.join(os.tmpdir(), `pp_${id}.jpg`);
        fs.writeFileSync(src, input);
        const vf = crop
            ? 'scale=640:640:force_original_aspect_ratio=increase,crop=640:640'
            : 'scale=640:640:force_original_aspect_ratio=decrease,pad=640:640:(ow-iw)/2:(oh-ih)/2:color=black';
        const p = spawn(FFMPEG, ['-y', '-v', 'error', '-i', src, '-frames:v', '1', '-vf', vf, '-q:v', '2', out], { windowsHide: true });
        let err = '';
        p.stderr.on('data', d => { err += d; });
        p.on('error', e => { cleanup(); reject(e); });
        p.on('close', code => {
            try {
                if (code !== 0) throw new Error('ffmpeg: ' + err.trim().slice(-200));
                const buf = fs.readFileSync(out);
                cleanup(); resolve(buf);
            } catch (e) { cleanup(); reject(e); }
        });
        function cleanup() { try { fs.rmSync(src, { force: true }); fs.rmSync(out, { force: true }); } catch {} }
    });
}

const unwrap = (msg) => msg?.ephemeralMessage?.message || msg?.viewOnceMessage?.message || msg?.viewOnceMessageV2?.message || msg?.documentWithCaptionMessage?.message || msg;

export default {
    name: 'setpp',
    aliases: ['setbotpp', 'fullpp', 'botpp'],
    desc: 'Set bot profile picture (reply to an image)',
    ownerOnly: true,

    async run({ sock, m, jid, args, reply, prefix, getCachedMessage }) {
        try {
            const ctxInfo = m.message?.extendedTextMessage?.contextInfo
                || m.message?.imageMessage?.contextInfo
                || unwrap(m.message)?.extendedTextMessage?.contextInfo;

            // 1) image sent with the command as caption, 2) cached ORIGINAL of the replied image, 3) quoted copy
            let target = null;
            if (unwrap(m.message)?.imageMessage) target = m;
            if (!target && ctxInfo?.stanzaId) {
                const cached = getCachedMessage?.(ctxInfo.stanzaId);
                if (cached && unwrap(cached.message)?.imageMessage) target = cached;
                else if (unwrap(ctxInfo.quotedMessage)?.imageMessage) {
                    target = { key: { remoteJid: jid, id: ctxInfo.stanzaId, fromMe: false, participant: ctxInfo.participant }, message: ctxInfo.quotedMessage };
                }
            }
            if (!target) return reply(`🖼️ *Bot profile picture*\n\nImage එකකට reply කරලා:\n\`${prefix}setpp\` — full picture (crop නැතුව)\n\`${prefix}setpp crop\` — crop කරලා`);

            await reply('⏳ Profile picture එක update කරනවා...');
            let buffer;
            try {
                buffer = await B.downloadMediaMessage(target, 'buffer', {}, { reuploadRequest: sock.updateMediaMessage });
            } catch (e) {
                return reply('❌ Image එක download කරන්න බැරි වුණා. Bot online ඉන්නකොට ආපු image එකකට reply කරන්න (නැත්නම් image එක caption එකේ .setpp දාලා යවන්න).\n' + (e?.message || ''));
            }

            const crop = /^(crop|c)$/i.test(args?.[0] || '');
            const square = await makeSquare(buffer, crop);
            const botJid = B.jidNormalizedUser(sock.user.id);
            await setOwnPicture(sock, botJid, square);
            await reply(`✅ Bot profile picture එක update වුණා! (${crop ? 'cropped' : 'full'})`);
        } catch (e) {
            await reply('❌ Failed: ' + (e?.message || e));
        }
    },
};
