// .link — upload replied WhatsApp media to DNUZ and return its public URL.
import { downloadContentFromMessage } from '@dnuzi/baileys';

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
            const buffer = await download(found);
            const mime = found.node.mimetype || 'application/octet-stream';
            const ext = mime.split('/')[1]?.split(';')[0]?.replace(/[^a-z0-9.+-]/gi, '') || 'bin';
            const name = String(found.node.fileName || `whatsapp-${Date.now()}.${ext}`).slice(0, 150);
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
