// GOD VOIP MD — SinhalaSub movie search and quality picker
import { getPluginSessionKey } from '../lib/plugin-session.js';

const BASE = 'https://shadow-movie-x-sinhalasub-api.lakshandamayantha592.workers.dev';
const TTL = 15 * 60 * 1000;
const sessions = new Map();
let flowSequence = 0;
const clean = (v, n = 180) => String(v ?? '').replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const safeUrl = value => {
  try { const u = new URL(String(value || '')); return u.protocol === 'https:' ? u.href : ''; } catch { return ''; }
};
const keyFor = ctx => getPluginSessionKey(ctx);

async function api(endpoint, params = {}) {
  const url = new URL(endpoint, BASE + '/');
  for (const [key, value] of Object.entries(params)) if (value != null && value !== '') url.searchParams.set(key, String(value));
  const response = await fetch(url, {
    headers: {
      accept: 'application/json, text/plain, */*',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
      'accept-language': 'en-US,en;q=0.9'
    },
    signal: AbortSignal.timeout(30000)
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body || body.success === false || body.status === false || body.error) {
    throw new Error(clean(body?.message || body?.error || 'API HTTP ' + response.status, 200));
  }
  return body.data && typeof body.data === 'object' ? body.data : body;
}
function arrayFrom(value, keys) {
  if (Array.isArray(value)) return value;
  for (const key of keys) if (Array.isArray(value?.[key])) return value[key];
  return [];
}
function save(ctx, state) {
  sessions.set(keyFor(ctx), { ...state, flowId: ++flowSequence, at: Date.now() });
  if (sessions.size > 500) {
    for (const [key, value] of sessions) if (Date.now() - value.at > TTL) sessions.delete(key);
    while (sessions.size > 500) sessions.delete(sessions.keys().next().value);
  }
}
function get(ctx) {
  const key = keyFor(ctx), state = sessions.get(key);
  if (!state || Date.now() - state.at > TTL) { sessions.delete(key); return null; }
  state.at = Date.now();
  return state;
}
async function prompt(ctx, text) {
  const before = get(ctx);
  const flowId = before?.flowId;
  const sent = await ctx.reply(text);
  const current = get(ctx);
  if (current && current.flowId === flowId) save(ctx, { ...current, promptId: sent?.key?.id || null, busy: false });
  return sent;
}
function quotedMenuId(ctx) {
  const message = ctx.m?.message || {};
  return message.extendedTextMessage?.contextInfo?.stanzaId
    || message.imageMessage?.contextInfo?.stanzaId
    || message.videoMessage?.contextInfo?.stanzaId
    || message.documentMessage?.contextInfo?.stanzaId
    || null;
}
function movieTitle(item, index) {
  return clean(item?.title || item?.name || item?.movie || item?.movie_name || 'Movie ' + (index + 1), 130);
}
function movieUrl(item) {
  return safeUrl(item?.url || item?.link || item?.movieUrl || item?.pageUrl);
}
function qualityOptions(dl) {
  const raw = [];
  const qualities = dl?.qualities ?? dl?.data?.qualities;
  if (Array.isArray(qualities)) raw.push(...qualities);
  else if (qualities && typeof qualities === 'object') {
    for (const [name, value] of Object.entries(qualities)) raw.push(typeof value === 'string' ? { quality: name, url: value } : { quality: name, ...value });
  }
  const servers = dl?.server1 ?? dl?.data?.server1;
  if (Array.isArray(servers)) raw.push(...servers.map(x => ({ server: 'Server 1', ...x })));
  else if (typeof servers === 'string') raw.push({ quality: 'Server 1', url: servers });
  else if (servers && typeof servers === 'object') {
    if (servers.url || servers.link || servers.download || servers.href) raw.push({ server: 'Server 1', ...servers });
    else for (const [name, value] of Object.entries(servers)) raw.push(typeof value === 'string' ? { quality: name, url: value, server: 'Server 1' } : { quality: name, server: 'Server 1', ...value });
  }
  const seen = new Set();
  return raw.map((x, i) => ({
    label: clean(x?.quality || x?.name || x?.resolution || x?.type || x?.server || 'Download ' + (i + 1), 90),
    server: clean(x?.server || x?.host || '', 50),
    url: safeUrl(x?.url || x?.link || x?.download || x?.href || x?.downloadUrl),
    size: clean(x?.size || x?.filesize || '', 30)
  })).filter(x => x.url).filter(x => {
    if (seen.has(x.url)) return false;
    seen.add(x.url); return true;
  });
}
async function search(ctx) {
  const query = String(ctx.text || '').trim();
  if (!query) return ctx.reply('╭━━〔 🎬 SINHALASUB MOVIES 〕━━╮\n\nUsage: ' + ctx.prefix + 'sinhalasub <movie name>\nExample: ' + ctx.prefix + 'sinhalasub Bad Newz\n\n✦ GOD VOIP MD');
  try {
    const data = await api('search', { q: query });
    const items = arrayFrom(data, ['items', 'results', 'movies', 'data']);
    if (!items.length) return ctx.reply('❌ No SinhalaSub movie results found. Try another title.');
    save(ctx, { step: 'results', items, query });
    return prompt(ctx, '╭━━〔 🎬 SINHALASUB MOVIES 〕━━╮\n\n🔎 *Search:* ' + clean(query, 100) + '\n📦 *Results:* ' + items.length + '\n\n' + items.slice(0, 10).map((item, i) => '*' + (i + 1) + '.* ' + movieTitle(item, i)).join('\n') + '\n\n↪️ Reply with a movie number.\n⏳ Expires in 15 minutes\n\n✦ GOD VOIP MD');
  } catch (error) {
    return ctx.reply('⚠️ SinhalaSub search failed: ' + clean(error.message, 200));
  }
}
function extractMediaCandidates(html) {
  const found = new Set();
  const patterns = [
    /(?:src|href|data-src|data-url|data-download)=["']([^"']+)["']/gi,
    /https?:\/\/[^"'\s<>]+/gi
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      const raw = match[1] || match[0];
      const value = raw.replace(/&amp;/g, '&').replace(/\\\//g, '/');
      const url = safeUrl(value);
      if (url && /\.(?:mp4|mkv|avi|mov|webm|m4v)(?:$|[?#])/i.test(url)) found.add(url);
    }
  }
  return [...found];
}
async function resolveMediaUrl(input) {
  let current = safeUrl(input);
  if (!current) throw new Error('Selected quality does not contain a valid HTTPS download URL.');
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(current, {
      headers: { 'user-agent': 'Mozilla/5.0', accept: '*/*', range: 'bytes=0-2047' },
      redirect: 'follow',
      signal: AbortSignal.timeout(30000)
    });
    if (!response.ok && response.status !== 206) {
      await response.body?.cancel().catch(() => {});
      throw new Error('Download host returned HTTP ' + response.status);
    }
    const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (type.includes('text/html') || type.includes('application/xhtml')) {
      const html = (await response.text()).slice(0, 2_000_000);
      const candidates = extractMediaCandidates(html);
      if (!candidates.length) throw new Error('The selected link opens a web page, not the movie file. Try another server/quality.');
      current = candidates[0];
      continue;
    }
    if (type.includes('application/json')) {
      const json = await response.json().catch(() => null);
      const candidates = [];
      const walk = (value, depth = 0) => {
        if (!value || depth > 5) return;
        if (typeof value === 'string') {
          const url = safeUrl(value);
          if (url && /\.(?:mp4|mkv|avi|mov|webm|m4v)(?:$|[?#])/i.test(url)) candidates.push(url);
        } else if (Array.isArray(value)) value.forEach(x => walk(x, depth + 1));
        else if (typeof value === 'object') for (const [key, child] of Object.entries(value)) {
          if (/url|link|download|src|file/i.test(key)) walk(child, depth + 1);
        }
      };
      walk(json);
      if (!candidates.length) throw new Error('The download API returned JSON instead of a movie file.');
      current = candidates[0];
      continue;
    }
    const range = response.headers.get('content-range') || '';
    const totalMatch = range.match(/\/(\d+)$/);
    const totalBytes = totalMatch ? Number(totalMatch[1]) : Number(response.headers.get('content-length') || 0);
    const reader = response.body?.getReader();
    if (reader) {
      const first = await reader.read();
      await reader.cancel().catch(() => {});
      const head = Buffer.from(first?.value?.subarray(0, 32) || []).toString('latin1');
      const looksLikeMedia = /ftyp|moov|mdat|RIFF|ID3/.test(head);
      if (type === 'text/plain' && !looksLikeMedia) throw new Error('The selected server returned text, not a playable movie file.');
    }
    if (totalBytes > 0 && totalBytes < 50 * 1024) {
      throw new Error('The selected link is only ' + Math.ceil(totalBytes / 1024) + ' KB, not a full movie. Choose another quality/server.');
    }
    if (/mpegurl/.test(type) || /\.m3u8(?:$|[?#])/i.test(response.url || current)) throw new Error('This is an HLS playlist, not a single MP4 movie file.');
    return response.url || current;
  }
  throw new Error('Could not resolve a direct movie download URL.');
}
async function onMessage(ctx) {
  const state = get(ctx);
  if (!state) return false;
  const text = String(ctx.text || '').trim();
  if (!/^\d{1,2}$/.test(text)) return false;
  if (!state.promptId || quotedMenuId(ctx) !== state.promptId) return false;
  if (state.busy) return true;
  const n = Number(text);
  save(ctx, { ...state, busy: true });
  if (state.step === 'results') {
    const item = state.items[n - 1];
    if (!item) { save(ctx, { ...state, busy: false }); await ctx.reply('❌ Invalid movie number. Reply to the latest SinhalaSub results menu.'); return true; }
    const url = movieUrl(item);
    if (!url) { save(ctx, { ...state, busy: false }); await ctx.reply('❌ This movie result has no valid HTTPS page URL.'); return true; }
    try {
      const [info, dl] = await Promise.all([api('info', { url }), api('dl', { url })]);
      const title = clean(info.title || info.name || movieTitle(item, n - 1), 140);
      const qualities = qualityOptions(dl);
      if (!qualities.length) {
        const fallback = safeUrl(dl.downloadUrl || dl.url || dl.link || dl.server1);
        if (fallback) {
          save(ctx, { step: 'done' });
          await ctx.reply('╭━━〔 🎬 GOD VOIP MD 〕━━╮\n\n🎬 *' + title + '*\n\n⬇️ *Download:*\n' + fallback + '\n\n✦ GOD VOIP MD');
          return true;
        }
        throw new Error('No downloadable qualities were returned by the API.');
      }
      save(ctx, { step: 'qualities', title, qualities, info });
      const imdb = info.imdb ? '\n⭐ IMDb: ' + clean(info.imdb, 40) : '';
      await prompt(ctx, '╭━━〔 🎬 SINHALASUB DOWNLOAD 〕━━╮\n\n🎬 *' + title + '*' + imdb + '\n📦 *Available links:* ' + qualities.length + '\n\n' + qualities.slice(0, 15).map((q, i) => '*' + (i + 1) + '.* ' + q.label + (q.server ? ' — ' + q.server : '') + (q.size ? ' (' + q.size + ')' : '')).join('\n') + '\n\n↪️ Reply with a quality number.\n\n✦ GOD VOIP MD');
    } catch (error) {
      const current = get(ctx);
      if (current?.step === 'results') save(ctx, { ...current, busy: false });
      await ctx.reply('⚠️ Could not load movie details: ' + clean(error.message, 200));
    }
    return true;
  }
  if (state.step === 'qualities') {
    const quality = state.qualities[n - 1];
    if (!quality) { save(ctx, { ...state, busy: false }); await ctx.reply('❌ Invalid quality number.'); return true; }
    save(ctx, { step: 'sending', title: state.title });
    await ctx.sock.sendMessage(ctx.jid, { react: { text: '⬇️', key: ctx.m.key } }).catch(() => {});
    try {
      // Baileys fetches the selected media URL and uploads the bytes as a WhatsApp document.
      let mimetype = 'video/mp4';
      let fileName = clean(state.title, 120).replace(/[^a-z0-9._-]+/gi, '_') + '.mp4';
      let sizeLabel = quality.size;
      let mediaUrl;
      try {
        mediaUrl = await resolveMediaUrl(quality.url);
      } catch (resolveError) {
        // SinhalaSub's ad-gateway links are web pages, not video files. Never
        // attach that HTML as a fake .mp4; return the original gateway link.
        save(ctx, { step: 'done', title: state.title });
        await ctx.reply(
          '╭━━〔 🎬 SINHALASUB DOWNLOAD 〕━━╮\\n\\n' +
          '🎬 *' + clean(state.title, 140) + '*\\n' +
          '📺 *Quality:* ' + clean(quality.label, 90) +
          (quality.server ? '\\n🌐 *Server:* ' + clean(quality.server, 50) : '') +
          (quality.size ? '\\n💾 *Size:* ' + clean(quality.size, 30) : '') +
          '\\n\\n🔗 *Download gateway:*\\n' + quality.url +
          '\\n\\n⚠️ This host requires browser verification before the actual file is unlocked. It is not a direct MP4 URL, so it cannot safely be sent as a movie attachment.\\n\\n✦ GOD VOIP MD'
        );
        return true;
      }
      try {
        const head = await fetch(mediaUrl, {
          method: 'HEAD',
          headers: { 'user-agent': 'Mozilla/5.0', accept: '*/*' },
          redirect: 'follow',
          signal: AbortSignal.timeout(20000)
        });
        if (head.ok) {
          const type = (head.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
          if (type && !type.includes('text/html') && !type.includes('mpegurl') && !type.includes('json')) mimetype = type;
          const disposition = head.headers.get('content-disposition') || '';
          const match = disposition.match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i);
          const fromHeader = match ? (match[1] || match[2]) : '';
          if (fromHeader) { try { fileName = decodeURIComponent(fromHeader.replace(/^["']|["']$/g, '')); } catch { fileName = fromHeader; } }
          const length = Number(head.headers.get('content-length') || 0);
          if (length) sizeLabel = (length / 1048576).toFixed(1) + ' MB';
        }
      } catch {}
      if (mimetype.includes('mpegurl') || /\.m3u8(?:$|\?)/i.test(quality.url)) {
        throw new Error('This server returned an HLS playlist, not a single downloadable movie file. Choose another quality/server.');
      }
      if (!/\.(mp4|mkv|avi|mov|webm|m4v)$/i.test(fileName)) {
        const ext = mimetype.includes('matroska') ? '.mkv' : mimetype.includes('webm') ? '.webm' : '.mp4';
        fileName += ext;
      }
      await ctx.sock.sendMessage(ctx.jid, {
        document: { url: mediaUrl },
        mimetype,
        fileName,
        caption: '╭━━〔 🎬 GOD VOIP MD 〕━━╮\n\n🎬 *' + clean(state.title, 140) + '*\n📺 *Quality:* ' + quality.label + (quality.server ? '\n🖥️ *Server:* ' + quality.server : '') + (sizeLabel ? '\n💾 *Size:* ' + clean(sizeLabel, 30) : '') + '\n\n✅ *Movie file attached*\n✦ GOD VOIP MD'
      }, { quoted: ctx.m });
      await ctx.sock.sendMessage(ctx.jid, { react: { text: '✅', key: ctx.m.key } }).catch(() => {});
    } catch (error) {
      await ctx.reply('⚠️ *Movie upload failed:* ' + clean(error.message, 220) + '\nPlease choose another quality/server if available.');
    }
    return true;
  }
  return false;
}
export default {
  name: 'sinhalasub',
  aliases: ['slmovie', 'slmovies', 'sinhalamovie', 'submovie'],
  desc: 'Search SinhalaSub movies and choose download quality',
  category: 'download',
  ownerOnly: false,
  async run(ctx) { await search(ctx); },
  async onMessage(ctx) { return onMessage(ctx); }
};
