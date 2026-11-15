// .link — upload replied WhatsApp media to DNUZ and return its public URL.
import { downloadContentFromMessage } from '@dnuzi/baileys';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';

const FFMPEG = ffmpegStatic || 'ffmpeg';

function runFfmpeg(args) {
    return new Promise((resolve, reject) => {
        const child = spawn(FFMPEG, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
        let stderr = '';
        child.stderr.on('data', chunk => { stderr += chunk.toString(); if (stderr.length > 6000) stderr = stderr.slice(-6000); });
        child.once('error', reject);
        child.once('close', code => code === 0 ? resolve() : reject(new Error('FFmpeg conversion failed: ' + (stderr.trim().slice(-1200) || 'exit ' + code))));
    });
}

async function convertForPlayback(buffer, found, mime, originalName) {
    const ext = path.extname(String(originalName || '')).toLowerCase();
    const audio = found.type === 'audio' || /^audio\//i.test(mime) || /\.(mp3|m4a|aac|wav|flac|opus|ogg|wma|aiff?)$/i.test(ext);
    const video = found.type === 'video' || /^video\//i.test(mime) || /\.(mp4|mov|mkv|webm|3gp|avi|m4v)$/i.test(ext);
    if (!audio && !video) return { buffer, mime, name: originalName };

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'god-voip-link-'));
    const input = path.join(dir, 'source' + (ext || '.bin'));
    const output = path.join(dir, audio ? 'playback.ogg' : 'playback.mp4');
    try {
        fs.writeFileSync(input, buffer);
        const args = audio
            ? ['-y', '-v', 'error', '-i', input, '-vn', '-map', '0:a:0', '-c:a', 'libopus', '-b:a', '64k', '-ar', '48000', '-ac', '1', '-application', 'voip', '-f', 'ogg', output]
            : ['-y', '-v', 'error', '-i', input, '-map', '0:v:0', '-map', '0:a:0?', '-vf', 'scale=640:-2,fps=24', '-c:v', 'libx264', '-profile:v', 'baseline', '-level', '3.0', '-pix_fmt', 'yuv420p', '-b:v', '700k', '-maxrate', '800k', '-bufsize', '1400k', '-c:a', 'aac', '-b:a', '96k', '-ar', '48000', '-ac', '1', '-movflags', '+faststart', output];
        await runFfmpeg(args);
        const converted = fs.readFileSync(output);
        if (!converted.length) throw new Error('Converted media is empty.');
        if (converted.length > 150 * 1024 * 1024) throw new Error('Converted media exceeds 150 MB.');
        return audio
            ? { buffer: converted, mime: 'audio/ogg', name: 'whatsapp-audio-' + Date.now() + '.ogg' }
            : { buffer: converted, mime: 'video/mp4', name: 'whatsapp-video-' + Date.now() + '.mp4' };
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

const BASE = (process.env.DNUZ_API_BASE || 'https://db.dnuz.top').replace(/\/$/, '');
const KEY = process.env.DNUZ_API_KEY || '';

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

function getMedia(ctx) {
    const own = unwrap(ctx.m.message);
    const keys = ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage'];
    for (const key of keys) if (own?.[key]) return { node: own[key], type: key.replace('Message', '') };

    const context = own?.extendedTextMessage?.contextInfo ||
        own?.imageMessage?.contextInfo || own?.videoMessage?.contextInfo ||
        own?.audioMessage?.contextInfo || own?.documentMessage?.contextInfo;
    const quoted = unwrap(context?.quotedMessage);
    for (const key of keys) if (quoted?.[key]) return { node: quoted[key], type: key.replace('Message', '') };
    return null;
}

async function download(found) {
    if (!found.node?.url && !found.node?.directPath) {
        throw new Error('Media download path එක හමු වුණේ නැහැ. Media එක නැවත WhatsApp එකෙන් එවන්න.');
    }
    const stream = await downloadContentFromMessage(found.node, found.type);
    const chunks = [];
    let total = 0;
    for await (const chunk of stream) {
        total += chunk.length;
        if (total > 150 * 1024 * 1024) throw new Error('File එක 150 MB limit එක ඉක්මවා ඇත.');
        chunks.push(Buffer.from(chunk));
    }
    const buffer = Buffer.concat(chunks);
    if (!buffer.length) throw new Error('Downloaded media එක හිස්.');
    return buffer;
}

export default {
    name: 'link',
    aliases: ['uploadlink'],
    desc: 'Upload replied media to DNUZ and return a public URL',
    ownerOnly: true,

    async run(ctx) {
        if (!KEY) return ctx.reply('❌ DNUZ_API_KEY එක hosting environment secrets වලට add කරන්න.');
        const found = getMedia(ctx);
        if (!found) return ctx.reply('📎 Image / Video / Audio / Document එකකට reply කරලා .link යවන්න.');

        const status = await ctx.reply('⏳ Media එක DNUZ වෙත upload කරනවා...');
        try {
            const downloaded = await download(found);
            const sourceMime = found.node.mimetype || 'application/octet-stream';
            const sourceName = String(found.node.fileName || `whatsapp-${Date.now()}`).slice(0, 150);
            const converted = await convertForPlayback(downloaded, found, sourceMime, sourceName);
            const buffer = converted.buffer;
            const mime = converted.mime;
            const name = String(converted.name || sourceName).slice(0, 150);
            const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + KEY };

            const presignResponse = await fetch(BASE + '/api/presign', {
                method: 'POST',
                headers,
                body: JSON.stringify({ name, size: buffer.length, type: mime }),
                signal: AbortSignal.timeout(30000),
            });
            const presign = await presignResponse.json().catch(() => ({}));
            if (!presignResponse.ok || !presign.uploadUrl || !presign.key || !presign.url) {
                throw new Error(presign.error || `DNUZ presign failed (HTTP ${presignResponse.status})`);
            }

            const uploadResponse = await fetch(presign.uploadUrl, {
                method: 'PUT',
                headers: { 'Content-Type': presign.contentType || mime },
                body: buffer,
                signal: AbortSignal.timeout(120000),
            });
            if (!uploadResponse.ok) throw new Error('DNUZ upload failed: HTTP ' + uploadResponse.status);

            const completeResponse = await fetch(BASE + '/api/complete', {
                method: 'POST',
                headers,
                body: JSON.stringify({ key: presign.key, name, expires: 0 }),
                signal: AbortSignal.timeout(30000),
            });
            const complete = await completeResponse.json().catch(() => ({}));
            if (!completeResponse.ok || complete.error) {
                throw new Error(complete.error || `DNUZ complete failed (HTTP ${completeResponse.status})`);
            }

            await ctx.reply(`✅ *Upload completed*

📁 Type: ${found.type.toUpperCase()}
📦 Size: ${(buffer.length / 1024 / 1024).toFixed(2)} MB

🔗 *Your link:*
${presign.url}

> ✦ ${ctx.config.botName}`);
        } catch (error) {
            await ctx.reply('❌ *.link* error: ' + (error?.message || 'Unknown upload error'));
        }
    },
};
