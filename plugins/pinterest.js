// ============================================================
// Pinterest image search — native WhatsApp album (DNUZI Baileys)
// Usage: .pinterest <query> | .pin <query>
// Returns up to 15 images in one WhatsApp album.
// ============================================================

const API_URL = 'https://mochi-apis.koyeb.app/api/search/pinterest';
const API_KEY = process.env.PINTEREST_API_KEY || '';

function cleanText(value, max = 180) {
    return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function validImageUrl(value) {
    try {
        const url = new URL(String(value || ''));
        return url.protocol === 'https:' && /(^|\.)pinimg\.com$/i.test(url.hostname);
    } catch {
        return false;
    }
}

export default {
    name: 'pinterest',
    aliases: ['pin', 'pins', 'pinsearch'],
    desc: 'Search Pinterest and send up to 15 images as one album',
    ownerOnly: false,

    async run({ sock, jid, m, text, reply }) {
        const query = cleanText(text, 120);
        if (!query) {
            return reply('🖼️ *Pinterest Image Search*\n\nUsage: .pinterest anime wallpaper\n\n> Up to 15 images will be sent together as a WhatsApp album.');
        }
        if (!API_KEY) {
            return reply('❌ Pinterest API key එක configure කරලා නැහැ. GitHub Secrets වල PINTEREST_API_KEY add කරන්න.');
        }

        const status = await reply('🔎 Pinterest images සොයනවා...\n> ' + query);
        try {
            const endpoint = new URL(API_URL);
            endpoint.searchParams.set('q', query);
            endpoint.searchParams.set('limit', '15');
            endpoint.searchParams.set('api_key', API_KEY);

            const response = await fetch(endpoint, {
                method: 'GET',
                headers: { Accept: 'application/json', 'User-Agent': 'GOD-VOIP-MD/1.0' },
                signal: AbortSignal.timeout(45000),
            });
            const payload = await response.json().catch(() => null);
            if (!response.ok) {
                throw new Error(cleanText(payload?.message || payload?.error, 180) || 'Pinterest API HTTP ' + response.status);
            }
            if (!payload || payload.success === false || payload.status === false) {
                throw new Error(cleanText(payload?.message || payload?.error, 180) || 'Pinterest search failed.');
            }

            const source = Array.isArray(payload.results) ? payload.results
                : Array.isArray(payload.data) ? payload.data : [];
            const seen = new Set();
            const images = source.map(item => {
                const imageUrl = [item?.imageUrl, item?.fallbackUrl, item?.originalUrl].find(validImageUrl);
                if (!imageUrl || seen.has(imageUrl)) return null;
                seen.add(imageUrl);
                return {
                    image: { url: imageUrl },
                    caption: cleanText(item?.title, 140) || 'Pinterest • ' + query,
                };
            }).filter(Boolean).slice(0, 15);

            if (!images.length) {
                return reply('😕 *No Pinterest images found.*\n\nවෙනත් keyword එකක් try කරන්න.');
            }

            const creator = cleanText(payload.creator, 80);
            const header = '📌 *PINTEREST IMAGE SEARCH*\n'
                + '🔎 Query: ' + query + '\n'
                + '🖼️ Images: ' + images.length + '/15'
                + (creator ? '\n👨‍💻 API: ' + creator : '')
                + '\n\n> ✦ GOD VOIP MD';

            if (images.length === 1) {
                await sock.sendMessage(jid, {
                    image: images[0].image,
                    caption: header + '\n\n' + images[0].caption,
                }, { quoted: m });
            } else {
                // Native album support is available in the repository's pinned
                // @dnuzi/baileys version. Keep all images in one grouped message.
                images[0].caption = header + '\n\n' + images[0].caption;
                await sock.sendMessage(jid, { album: images }, { quoted: m });
            }

            if (status?.key) {
                try { await sock.sendMessage(jid, { react: { text: '✅', key: status.key } }); } catch {}
            }
        } catch (error) {
            console.error('[PINTEREST] Search/send failed:', error?.message || error);
            await reply('❌ *Pinterest Search Error*\n\n' + cleanText(error?.message || 'Unknown error', 220));
        }
    },
};
