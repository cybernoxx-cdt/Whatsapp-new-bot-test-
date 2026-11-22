// GOD VOIP MD — SinhalaSub movie search and quality picker
import { getPluginSessionKey } from '../lib/plugin-session.js';

const BASE = 'https://shadow-movie-x-sinhalasub-api.lakshandamayantha592.workers.dev';
const TTL = 15 * 60 * 1000;
const sessions = new Map();
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
  sessions.set(keyFor(ctx), { ...state, at: Date.now() });
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
    return ctx.reply('╭━━〔 🎬 SINHALASUB MOVIES 〕━━╮\n\n🔎 *Search:* ' + clean(query, 100) + '\n📦 *Results:* ' + items.length + '\n\n' + items.slice(0, 10).map((item, i) => '*' + (i + 1) + '.* ' + movieTitle(item, i)).join('\n') + '\n\n↪️ Reply with a movie number.\n⏳ Expires in 15 minutes\n\n✦ GOD VOIP MD');
  } catch (error) {
    return ctx.reply('⚠️ SinhalaSub search failed: ' + clean(error.message, 200));
  }
}
async function onMessage(ctx) {
  const state = get(ctx);
  if (!state) return false;
  const text = String(ctx.text || '').trim();
  if (!/^\d{1,2}$/.test(text)) return false;
  const n = Number(text);
  if (state.step === 'results') {
    const item = state.items[n - 1];
    if (!item) { await ctx.reply('❌ Invalid movie number. Reply with a number from the latest list.'); return true; }
    const url = movieUrl(item);
    if (!url) { await ctx.reply('❌ This movie result has no valid HTTPS page URL.'); return true; }
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
      await ctx.reply('╭━━〔 🎬 SINHALASUB DOWNLOAD 〕━━╮\n\n🎬 *' + title + '*' + imdb + '\n📦 *Available links:* ' + qualities.length + '\n\n' + qualities.slice(0, 15).map((q, i) => '*' + (i + 1) + '.* ' + q.label + (q.server ? ' — ' + q.server : '') + (q.size ? ' (' + q.size + ')' : '')).join('\n') + '\n\n↪️ Reply with a quality number.\n\n✦ GOD VOIP MD');
    } catch (error) {
      await ctx.reply('⚠️ Could not load movie details: ' + clean(error.message, 200));
    }
    return true;
  }
  if (state.step === 'qualities') {
    const quality = state.qualities[n - 1];
    if (!quality) { await ctx.reply('❌ Invalid quality number.'); return true; }
    save(ctx, { step: 'sending', title: state.title });
    await ctx.sock.sendMessage(ctx.jid, { react: { text: '⬇️', key: ctx.m.key } }).catch(() => {});
    try {
      // Baileys fetches the selected media URL and uploads the bytes as a WhatsApp document.
      let mimetype = 'video/mp4';
      let fileName = clean(state.title, 120).replace(/[^a-z0-9._-]+/gi, '_') + '.mp4';
      let sizeLabel = quality.size;
      try {
        const head = await fetch(quality.url, {
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
        document: { url: quality.url },
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
