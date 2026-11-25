// GOD VOIP MD — CineSubz TV quality picker + real WhatsApp MP4 document delivery
import { getPluginSessionKey } from '../lib/plugin-session.js';
const BASE = 'https://mochi-apis.koyeb.app/api/movie/cinesubz';
const KEY = process.env.MOCHI_API_KEY || process.env.DNUZ_API_KEY || process.env.CINESUBZ_API_KEY || '';
const sessions = new Map();
let flowSequence = 0;
const TTL = 30 * 60 * 1000;
const MAX_BULK_EPISODES = 20;
const cancelledSeasons = new Set(); // session keys whose delivery was cancelled (P7)
const clean = (v, n = 180) => String(v ?? '').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&#8217;|&#039;/g, "'").replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const bold = v => '*' + clean(v, 450) + '*';
const validPage = value => {
  try {
    const u = new URL(String(value || ''));
    return u.protocol === 'https:' && (u.hostname === 'cinesubz.net' || u.hostname.endsWith('.cinesubz.net'));
  } catch { return false; }
};
function isPrivateOrReservedHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1' || host === '[::1]') return true;
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false; // non-IP hostnames are checked by protocol + allowlist elsewhere
  const [a, b] = m.slice(1).map(Number);
  if (m.slice(1).some(n => Number(n) > 255)) return true;
  return a === 0 || a === 10 || a === 127 || a === 169 && b === 254 ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) || a >= 224 ||
    (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19 || b === 51 || b === 100)) ||
    (a === 203 && b === 0 && Number(m[3]) === 113);
}
export function isPrivateOrReservedHostPublic(hostname) { return isPrivateOrReservedHost(hostname); }
const validDirect = value => {
  try {
    const u = new URL(String(value || ''));
    return u.protocol === 'https:' && !isPrivateOrReservedHost(u.hostname);
  } catch { return false; }
};
const sessionKey = c => getPluginSessionKey(c);
function getSession(c) {
  const key = sessionKey(c), session = sessions.get(key);
  if (!session || Date.now() - session.at > TTL) { sessions.delete(key); return null; }
  session.at = Date.now();
  return session;
}
function setSession(c, value) {
  sessions.set(sessionKey(c), { ...value, flowId: ++flowSequence, at: Date.now() });
  if (sessions.size > 1000) {
    const oldest = [...sessions].sort((a, b) => a[1].at - b[1].at).slice(0, 200);
    for (const [key] of oldest) sessions.delete(key);
  }
}
async function react(c, emoji) {
  try { await c.sock.sendMessage(c.jid, { react: { text: emoji, key: c.m.key } }); } catch {}
}
const say = (c, text) => c.reply(text);
async function prompt(c, text) {
  const before = getSession(c);
  const flowId = before?.flowId;
  const sent = await say(c, text);
  const current = getSession(c);
  if (current && current.flowId === flowId) {
    setSession(c, { ...current, promptId: sent?.key?.id || null, busy: false });
  }
  return sent;
}
async function api(endpoint, params = {}) {
  if (!KEY) throw new Error('MOCHI_API_KEY secret එක hosting environment secrets වල configure කරන්න.');
  const url = new URL(BASE + '/' + endpoint);
  for (const [key, value] of Object.entries(params)) if (value != null && value !== '') url.searchParams.set(key, String(value));
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'GOD-VOIP-MD-CineSubz/5.0', Authorization: 'Bearer ' + KEY },
    signal: AbortSignal.timeout(40000)
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body || body.success === false || body.status === false) {
    throw new Error(clean(body?.message || body?.error || 'API HTTP ' + response.status));
  }
  return body.data || {};
}
function numbered(items, render) {
  return items.map((item, i) => '*' + (i + 1) + '.* ' + render(item)).join('\n');
}
function qualityLabel(option) {
  if (typeof option === 'string') return clean(option, 130);
  return clean(option?.info || option?.quality || option?.name || option?.type || option?.label || 'Available quality', 130);
}
function qualityKey(option) {
  const label = qualityLabel(option);
  const match = label.match(/(2160|1440|1080|720|576|480|360|240)\s*p?/i);
  return match ? match[1] + 'p' : label.toLowerCase().split(/[•|]/)[0].trim();
}
function qualityRank(option) {
  const match = qualityKey(option).match(/\d+/);
  return match ? Number(match[0]) : 0;
}
function sizeLabel(option) {
  const label = qualityLabel(option);
  const match = label.match(/\b\d+(?:\.\d+)?\s*(?:GB|MB|KB)\b/i);
  return match ? match[0] : '';
}
function formatSearch(query, movies, tvs) {
  const lines = ['*╭━━〔 🎬 CINESUBZ SEARCH 〕━━╮*', '', '🔎 *Search:* ' + bold(query), '📦 *Results:* ' + bold(movies.length + tvs.length), ''];
  if (movies.length) lines.push('*🎬 MOVIES*', ...movies.map((x, i) => '*' + (i + 1) + '.* ' + bold(x.title)), '');
  if (tvs.length) lines.push('*📺 TV SERIES*', ...tvs.map((x, i) => '*' + (movies.length + i + 1) + '.* ' + bold(x.title)), '');
  lines.push('*━━━━━━━━━━━━━━━━━━━━*', '↪️ Reply with a number to open', '⏳ Expires in 30 minutes', '*✦ GOD VOIP MD*');
  return lines.join('\n');
}
function pageUrlOf(value) {
  if (!value || typeof value !== 'object') return '';
  for (const candidate of [value.url, value.link, value.page_url, value.pageUrl, value.episode_url, value.episodeUrl, value.href]) {
    if (validPage(candidate)) return candidate;
  }
  return '';
}
function listFrom(data, keys) {
  for (const key of keys) if (Array.isArray(data?.[key])) return data[key];
  return [];
}
function makeTvMenu(data) {
  const sourceSeasons = listFrom(data, ['seasons']).length
    ? data.seasons
    : listFrom(data?.tvshow, ['seasons']).length
      ? data.tvshow.seasons
      : listFrom(data?.series, ['seasons']).length
        ? data.series.seasons
        : listFrom(data?.tv, ['seasons']);
  const seasons = sourceSeasons.map((season, i) => {
    const sourceEpisodes = listFrom(season, ['episodes', 'items', 'results']);
    const episodes = sourceEpisodes
      .map(ep => ({ ...ep, url: pageUrlOf(ep) }))
      .filter(ep => validPage(ep.url));
    return { ...season, season_no: season.season_no ?? season.season ?? season.number ?? i + 1, episodes };
  }).filter(season => season.episodes.length);
  const choices = [];
  const lines = ['*╭━━〔 📺 CINESUBZ TV SERIES 〕━━╮*', '', bold(data.title || 'TV Series'), ''];
  for (let si = 0; si < seasons.length; si++) {
    const season = seasons[si];
    lines.push('*━━━ ' + bold('SEASON ' + season.season_no) + ' ━━━*');
    choices.push({ type: 'bulk', seasonIndex: si });
    lines.push('*' + choices.length + '.* 📦 ' + bold('Season ' + season.season_no + ' — All Episodes'));
    for (let ei = 0; ei < season.episodes.length; ei++) {
      const episode = season.episodes[ei];
      choices.push({ type: 'episode', episode, seasonIndex: si });
      lines.push('*' + choices.length + '.* 🎞️ ' + bold('Episode ' + (episode.episode_no ?? ei + 1)) + (episode.title ? ' — ' + bold(episode.title) : ''));
    }
    lines.push('');
  }
  lines.push('*━━━━━━━━━━━━━━━━━━━━*', '1️⃣ Select Season All to choose quality for every episode', '🎬 Select an episode to choose its own quality', '↪️ Reply with a menu number', '⏳ Expires in 30 minutes', '*✦ GOD VOIP MD*');
  return { seasons, choices, text: lines.join('\n') };
}
async function search(c, query, filter = 'all') {
  if (!query) return say(c, '*Usage: .cz Movie or TV Series Name*');
  const data = await api('search', { q: query, filter });
  const movies = (data.movies || []).filter(x => validPage(x.url)).slice(0, 10);
  const tvs = (data.tvshows || []).filter(x => validPage(x.url)).slice(0, 10);
  const items = [...movies.map(x => ({ ...x, kind: 'movie' })), ...tvs.map(x => ({ ...x, kind: 'tv' }))];
  if (!items.length) return say(c, '*😕 No results found. Try another title.*');
  setSession(c, { mode: 'search', items });
  return prompt(c, formatSearch(data.query || query, movies, tvs));
}

function firstValue(objects, keys) {
  for (const object of objects) {
    if (!object || typeof object !== 'object') continue;
    for (const key of keys) {
      const value = object[key];
      if (value != null && value !== '' && !(Array.isArray(value) && !value.length)) return value;
    }
  }
  return '';
}
function imageFrom(objects) {
  const keys = /^(poster|poster_url|posterUrl|image|image_url|imageUrl|thumbnail|thumbnail_url|thumbnailUrl|cover|cover_url|coverUrl|backdrop|backdrop_url|backdropUrl|thumb|img|banner)$/i;
  const seen = new Set();
  const walk = (value, depth = 0) => {
    if (!value || typeof value !== 'object' || depth > 4 || seen.has(value)) return '';
    seen.add(value);
    for (const [key, child] of Object.entries(value)) {
      if (keys.test(key)) {
        const candidate = typeof child === 'string' ? child : (child?.url || child?.src || '');
        if (validImage(candidate)) return candidate;
      }
    }
    for (const child of Object.values(value)) {
      if (child && typeof child === 'object') {
        const found = walk(child, depth + 1);
        if (found) return found;
      }
    }
    return '';
  };
  for (const object of objects) {
    const found = walk(object);
    if (found) return found;
  }
  return '';
}
function validImage(value) {
  try {
    const u = new URL(String(value || ''));
    return u.protocol === 'https:' && !isPrivateOrReservedHost(u.hostname) && !/\.(?:mp4|mkv|mp3|zip|pdf)(?:$|[?#])/i.test(u.pathname + u.search);
  } catch { return false; }
}
async function pagePoster(pageUrl) {
  if (!validPage(pageUrl)) return '';
  try {
    const response = await fetch(pageUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GOD-VOIP-MD/1.0)', Accept: 'text/html' },
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) return '';
    const html = (await response.text()).slice(0, 500000);
    const patterns = [
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
      /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i
    ];
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match && validImage(match[1])) return match[1];
    }
  } catch {}
  return '';
}
function detailText(data, item, kind) {
  const sources = [data, data?.details, data?.movie, data?.tvshow, data?.series, item];
  const title = clean(firstValue(sources, ['title', 'name', 'original_title']) || item?.title || (kind === 'tv' ? 'TV Series' : 'Movie'), 160);
  const year = firstValue(sources, ['year', 'release_year', 'releaseDate', 'release_date', 'first_air_date']);
  const rating = firstValue(sources, ['rating', 'imdb_rating', 'imdbRating', 'vote_average', 'imdb']);
  const genre = firstValue(sources, ['genres', 'genre', 'categories']);
  const description = firstValue(sources, ['description', 'overview', 'plot', 'synopsis', 'story']);
  const runtime = firstValue(sources, ['runtime', 'duration', 'time']);
  const status = firstValue(sources, ['status']);
  const seasons = firstValue(sources, ['total_seasons', 'season_count']);
  const genreText = Array.isArray(genre) ? genre.map(x => typeof x === 'object' ? x.name : x).join(', ') : genre;
  const lines = [kind === 'tv' ? '*📺 TV SERIES DETAILS*' : '*🎬 MOVIE DETAILS*', '', '*' + title + '*'];
  if (year) lines.push('📅 *Year:* ' + clean(year, 40));
  if (rating) lines.push('⭐ *Rating:* ' + clean(rating, 40));
  if (genreText) lines.push('🎭 *Genre:* ' + clean(genreText, 160));
  if (runtime) lines.push('⏱️ *Runtime:* ' + clean(runtime, 50));
  if (status) lines.push('📌 *Status:* ' + clean(status, 50));
  if (seasons || (kind === 'tv' && Array.isArray(data?.seasons))) lines.push('📚 *Seasons:* ' + clean(seasons || data.seasons.length, 20));
  if (description) lines.push('', '📝 *Overview:*', clean(description, 650));
  lines.push('', '*✦ GOD VOIP MD*');
  return lines.join('\n');
}
async function sendInfoCard(c, data, item, kind) {
  const sources = [data, data?.details, data?.movie, data?.tvshow, data?.series, item];
  const caption = detailText(data, item, kind);
  const imageUrl = imageFrom(sources) || await pagePoster(item?.url);
  if (imageUrl) {
    try {
      await c.sock.sendMessage(c.jid, { image: { url: imageUrl }, caption }, { quoted: c.m });
      return true;
    } catch (error) {
      console.error('[CINESUBZ POSTER]', error?.message || error);
    }
  }
  await say(c, caption + '\n\n🖼️ *Poster image is not available from the source.*');
  return false;
}

async function openMovie(c, item) {
  const data = await api('info', { url: item.url });
  const rawLinks = [
    data?.downloadLinks, data?.download_links, data?.dl_links,
    data?.qualities, data?.options, data?.links
  ].find(Array.isArray) || [];
  const links = rawLinks
    .map(option => typeof option === 'string' ? option : ({ ...option, link: optionPageUrl(option) }))
    .filter(option => !!optionPageUrl(option));
  setSession(c, { mode: 'movie', title: data.title || item.title, links });
  await sendInfoCard(c, data, item, 'movie');
  if (links.length) {
    const lines = ['*⬇️ MOVIE DOWNLOAD QUALITIES*', numbered(links.slice(0, 10), qualityLabel), '', '↪️ Reply with a quality number'];
    return prompt(c, lines.join('\n'));
  }
  return say(c, '*❌ No download qualities found for this movie.*');
}
async function openTv(c, item) {
  const [tvResult, infoResult] = await Promise.allSettled([
    api('tv', { url: item.url }),
    api('info', { url: item.url })
  ]);
  if (tvResult.status !== 'fulfilled') throw tvResult.reason;
  const data = tvResult.value || {};
  const info = infoResult.status === 'fulfilled' ? infoResult.value || {} : {};
  const merged = { ...info, ...data, title: data.title || info.title || item.title };
  const menu = makeTvMenu(merged);
  if (!menu.choices.length) {
    await sendInfoCard(c, merged, item, 'tv');
    return say(c, '*❌ No valid seasons or episodes found.*');
  }
  setSession(c, { mode: 'tv', seasons: menu.seasons, choices: menu.choices, title: merged.title });
  await sendInfoCard(c, merged, item, 'tv');
  return prompt(c, menu.text);
}
function optionPageUrl(option) {
  if (typeof option === 'string') return validPage(option) ? option : '';
  if (!option || typeof option !== 'object') return '';
  for (const candidate of [option.link, option.url, option.page_url, option.pageUrl, option.download_page, option.downloadPage, option.href]) {
    if (validPage(candidate)) return candidate;
  }
  return '';
}
function episodeQualityOptions(data) {
  const candidates = [
    data?.dl_links, data?.downloadLinks, data?.download_links,
    data?.qualities, data?.options, data?.links,
    data?.episode?.dl_links, data?.episode?.downloadLinks
  ];
  const source = candidates.find(Array.isArray) || [];
  return source
    .filter(option => option && typeof option === 'object')
    .map(option => ({ ...option, link: optionPageUrl(option) }))
    .filter(option => validPage(option.link));
}
async function getEpisodeOptions(episode) {
  const episodeUrl = pageUrlOf(episode);
  if (!validPage(episodeUrl)) throw new Error('Invalid episode page URL');
  const data = await api('episode', { url: episodeUrl });
  const options = episodeQualityOptions(data);
  return { data, options };
}
async function openEpisode(c, episode, title) {
  const result = await getEpisodeOptions(episode);
  if (!result.options.length) return say(c, '*❌ No download qualities found for this episode.*');
  setSession(c, { mode: 'episode_quality', title: title || result.data.title || episode.title || 'Episode', episode, options: result.options });
  const lines = ['*╭━━〔 🎞️ SELECT EPISODE QUALITY 〕━━╮*', '', bold(result.data.title || episode.title || 'Episode'), ''];
  lines.push(numbered(result.options.slice(0, 10), option => '🎥 ' + bold(qualityLabel(option)) + (sizeLabel(option) ? ' • 💾 ' + bold(sizeLabel(option)) : '')));
  lines.push('', '↪️ Reply with a number to download this episode', '*✦ GOD VOIP MD*');
  return prompt(c, lines.join('\n'));
}
async function resolveDirect(option, type = 'episode') {
  const pageUrl = optionPageUrl(option);
  if (!validPage(pageUrl)) throw new Error('Invalid download page URL');
  const data = await api('download', { url: pageUrl, type });
  const candidates = [
    data?.dl_links, data?.downloadLinks, data?.download_links,
    data?.links, data?.downloads, data?.servers
  ];
  const source = candidates.find(Array.isArray) || [];
  const links = source.map(item => {
    if (typeof item === 'string') return { url: item, type: '' };
    return {
      ...item,
      url: item?.url || item?.link || item?.download_url || item?.downloadUrl || item?.direct_url || item?.directUrl || ''
    };
  }).filter(item => validDirect(item.url));
  const single = data?.downloadUrl || data?.download_url || data?.directUrl || data?.direct_url || data?.url;
  if (validDirect(single)) links.unshift({ url: single, type: 'direct' });
  if (!links.length) throw new Error('Download API did not return a valid direct media URL');
  const preferred = links.find(x => /direct/i.test(x.type || x.server || '')) || links[0];
  return {
    url: preferred.url,
    name: data.name || data.title || option.info || option.quality || 'CineSubz Episode',
    size: data.size || preferred.size || sizeLabel(option),
    quality: qualityLabel(option)
  };
}
async function sendMedia(c, media, episode, index, total, seriesTitle = 'CineSubz Series') {
  const epNo = episode.episode_no ?? index + 1;
  const epTitle = clean(episode.title || 'Episode ' + epNo, 90);
  const baseName = String(media.name || ('Episode ' + epNo)).replace(/\.mp4$/i, '');
  const fileName = clean(baseName + '.mp4', 150).replace(/[\\/:*?"<>|]/g, '_');
  const caption = '📺 *' + clean(seriesTitle || 'CineSubz Series', 100) + '*\n' +
    '🎞️ *Episode ' + epNo + ':* ' + epTitle + '\n' +
    '🎥 *Quality:* ' + clean(media.quality, 100) + '\n' +
    (media.size ? '💾 *Size:* ' + clean(media.size, 40) + '\n' : '') +
    (total > 1 ? '📦 *Episode:* ' + (index + 1) + '/' + total + '\n' : '') +
    '✦ *GOD VOIP MD*';
  // Send as an MP4 document: episode files are commonly 200–500 MB, above
  // WhatsApp's normal video-message limit. Baileys streams the remote URL.
  await c.sock.sendMessage(c.jid, {
    document: { url: media.url },
    mimetype: 'video/mp4',
    fileName,
    caption
  }, { quoted: c.m });
}
async function downloadOne(c, session, option) {
  await react(c, '⬇️');
  await say(c, '⏳ *Preparing ' + bold(session.title || 'episode') + ' — ' + bold(qualityLabel(option)) + '*\nPlease wait while WhatsApp uploads the MP4 file…');
  const media = await resolveDirect(option, session.mode === 'movie_quality' ? 'movie' : 'episode');
  if (session.mode === 'movie_quality') {
    await c.sock.sendMessage(c.jid, { document: { url: media.url }, mimetype: 'video/mp4', fileName: clean(String(media.name || '').replace(/\.mp4$/i, ''), 150) + '.mp4', caption: '🎬 *' + clean(session.title, 120) + '*\n🎥 *Quality:* ' + clean(media.quality, 100) + '\n✦ *GOD VOIP MD*' }, { quoted: c.m });
  } else {
    await sendMedia(c, media, session.episode, 0, 1, session.title);
  }
  await react(c, '✅');
  await say(c, '*✅ MP4 sent successfully.*');
}
async function mapLimit(items, limit, worker) {
  const output = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      try { output[i] = await worker(items[i], i); }
      catch (error) { output[i] = { error: clean(error.message || 'Failed') }; }
    }
  }));
  return output;
}
function bulkQualityOptions(episodesWithOptions) {
  const sets = episodesWithOptions.map(item => new Set(item.options.map(qualityKey)));
  if (!sets.length) return [];
  const common = [...sets[0]].filter(key => sets.every(set => set.has(key)));
  const keys = common.length ? common : [...new Set(sets.flatMap(set => [...set]))];
  return keys.map(key => {
    const matching = episodesWithOptions.flatMap(item => item.options).find(option => qualityKey(option) === key);
    return { key, label: qualityLabel(matching), rank: qualityRank(matching) };
  }).sort((a, b) => b.rank - a.rank);
}
async function prepareSeason(c, session, seasonIndex) {
  const season = session.seasons?.[seasonIndex];
  if (!season) return say(c, '*❌ Season not found.*');
  if (season.episodes.length > MAX_BULK_EPISODES) return say(c, '*⚠️ This season has ' + season.episodes.length + ' episodes. Bulk delivery is limited to ' + MAX_BULK_EPISODES + ' at once to avoid WhatsApp rate limits. Select episodes individually.*');
  await react(c, '📦');
  await say(c, '🔎 *Checking available qualities for Season ' + clean(season.season_no, 10) + '…*\n📺 Episodes: *' + season.episodes.length + '*');
  const episodeData = await mapLimit(season.episodes, 4, async episode => {
    const result = await getEpisodeOptions(episode);
    return { episode, data: result.data, options: result.options };
  });
  const ready = episodeData.filter(x => x && !x.error && x.options.length);
  if (!ready.length) return say(c, '*❌ Could not find download qualities for this season.*');
  const qualities = bulkQualityOptions(ready);
  if (!qualities.length) return say(c, '*❌ No common download quality is available.*');
  setSession(c, { mode: 'bulk_quality', title: session.title, season, episodeData: ready, failedEpisodes: episodeData.length - ready.length, qualities });
  const lines = ['*╭━━〔 📦 SEASON QUALITY MENU 〕━━╮*', '', bold(session.title), '📺 *Season:* ' + bold(season.season_no), '🎞️ *Episodes ready:* ' + bold(ready.length + '/' + season.episodes.length), '', '*Choose quality for all episodes:*'];
  lines.push(numbered(qualities, q => '🎥 ' + bold(q.label)));
  lines.push('', '↪️ Reply directly to THIS quality menu with a number', '⚠️ Files will be sent one by one', '✦ *GOD VOIP MD*');
  return prompt(c, lines.join('\n'));
}
function selectEpisodeOption(item, quality) {
  const exact = item.options.find(option => qualityKey(option) === quality.key);
  if (exact) return exact;
  const sorted = [...item.options].sort((a, b) => qualityRank(b) - qualityRank(a));
  return sorted.find(option => qualityRank(option) <= quality.rank) || sorted[0];
}
async function deliverSeason(c, session, quality) {
  const total = session.episodeData.length;
  const cancelKey = sessionKey(c);
  const startAt = Math.max(0, Math.min(total, Number(session.lastDelivered || session.cancelledAt || 0)));
  cancelledSeasons.delete(cancelKey);
  await react(c, '⬇️');
  await say(c, '📦 *Starting Season ' + clean(session.season.season_no, 10) + ' MP4 delivery…*\n🎥 Quality: ' + bold(quality.label) + '\n📺 Remaining files: *' + (total - startAt) + '/' + total + '*\n\nFiles are sent one by one. Keep the chat open.');
  let sent = 0, failed = [];
  for (let i = startAt; i < total; i++) {
    if (cancelledSeasons.has(cancelKey)) {
      setSession(c, { ...session, mode: 'bulk_quality', cancelledAt: i, sent });
      await say(c, '*⏹️ Season delivery cancelled.*\n✅ Sent: *' + sent + '/' + total + '*\nReply with the quality number again to resume from episode ' + (i + 1) + '.');
      return;
    }
    const item = session.episodeData[i];
    try {
      const option = selectEpisodeOption(item, quality);
      const media = await resolveDirect(option, 'episode');
      await sendMedia(c, media, item.episode, i, total, session.title);
      sent++;
      await react(c, '📤');
    } catch (error) {
      failed.push('Episode ' + clean(item.episode.episode_no ?? i + 1, 8) + ': ' + clean(error.message || 'Failed', 100));
    }
    // Persist progress so a cancelled/restarted delivery can resume (P7).
    setSession(c, { ...session, mode: 'bulk_quality', sentSoFar: sent, lastDelivered: i + 1 });
    // Small pause reduces WhatsApp upload throttling without slowing API lookups.
    if (i < total - 1) await new Promise(resolve => setTimeout(resolve, 1200));
  }
  await react(c, failed.length ? '⚠️' : '✅');
  const summary = ['*╭━━〔 📦 SEASON DELIVERY REPORT 〕━━╮*', '📺 *Season:* ' + bold(session.season.season_no), '🎥 *Quality:* ' + bold(quality.label), '✅ *Sent:* ' + bold(sent + '/' + total)];
  if (failed.length) summary.push('❌ *Failed:* ' + bold(failed.length), ...failed.slice(0, 15).map(x => '• ' + x));
  summary.push('*✦ GOD VOIP MD*');
  await say(c, summary.join('\n'));
}
async function choose(c, number) {
  const session = getSession(c);
  if (!session) return false;
  if (session.mode === 'search') {
    const item = session.items[number - 1];
    if (!item) { await say(c, '*❌ Invalid result number.*'); return true; }
    await react(c, item.kind === 'tv' ? '📺' : '🎬');
    if (item.kind === 'tv') await openTv(c, item);
    else await openMovie(c, item);
    return true;
  }
  if (session.mode === 'tv') {
    const choice = session.choices[number - 1];
    if (!choice) { await say(c, '*❌ Invalid menu number.*'); return true; }
    if (choice.type === 'bulk') await prepareSeason(c, session, choice.seasonIndex);
    else {
      await react(c, '🎞️');
      await openEpisode(c, choice.episode, session.title);
    }
    return true;
  }
  if (session.mode === 'episode_quality' || session.mode === 'movie') {
    const option = session.options?.[number - 1] || session.links?.[number - 1];
    if (!option) { await say(c, '*❌ Invalid quality number.*'); return true; }
    await downloadOne(c, { ...session, mode: session.mode === 'movie' ? 'movie_quality' : session.mode }, option);
    return true;
  }
  if (session.mode === 'bulk_quality') {
    const quality = session.qualities[number - 1];
    if (!quality) { await say(c, '*❌ Invalid quality number.*'); return true; }
    await deliverSeason(c, session, quality);
    return true;
  }
  return false;
}
async function plainReply(c, text) {
  const value = String(text || '').trim();
  const state = getSession(c);
  let message = c.m?.message || {};
  // Handle ephemeral / view-once wrappers before reading the quoted menu ID.
  for (let i = 0; i < 6; i++) {
    const wrapped = message.ephemeralMessage?.message
      || message.viewOnceMessage?.message
      || message.viewOnceMessageV2?.message
      || message.documentWithCaptionMessage?.message;
    if (!wrapped) break;
    message = wrapped;
  }
  const contextInfo = message?.extendedTextMessage?.contextInfo
    || message?.imageMessage?.contextInfo
    || message?.videoMessage?.contextInfo
    || message?.documentMessage?.contextInfo
    || {};
  const repliedTo = contextInfo.stanzaId;

  if (/^cancel$/i.test(value)) {
    if (state && state.mode === 'bulk_quality') {
      cancelledSeasons.add(sessionKey(c));
      await say(c, '*⏹️ Cancelling season delivery…*');
      return true;
    }
    return false;
  }

  // Accept only a reply to the exact active menu message. This prevents a
  // stale number from a previous movie/series flow selecting the wrong item.
  if (!/^\d{1,3}$/.test(value) || !state || !state.promptId || repliedTo !== state.promptId) return false;
  if (state.busy) return true;

  setSession(c, { ...state, busy: true });
  try {
    return await choose(c, Number(value));
  } catch (error) {
    console.error('[CINESUBZ REPLY]', error?.stack || error);
    await react(c, '⚠️');
    await say(c, '*❌ CineSubz error:* ' + bold(error.message || 'Unknown error'));
    return true;
  } finally {
    const current = getSession(c);
    if (current?.busy) setSession(c, { ...current, busy: false });
  }
}
export default {
  name: 'cinesubz',
  aliases: ['cz', 'cs', 'cinesearch'],
  desc: 'CineSubz movies, TV seasons, quality selection and MP4 document downloads',
  ownerOnly: true,
  async onMessage(context) { return plainReply(context, context.text); },
  async run(c) {
    const raw = String(c.text || '').trim();
    const parts = raw.split(/\s+/).filter(Boolean);
    const first = (parts[0] || '').toLowerCase();
    try {
      await react(c, '🔎');
      if (!KEY) throw new Error('MOCHI_API_KEY secret එක hosting environment එකේ configure කරලා නැහැ.');
      if (!raw || first === 'help') {
        return say(c, '*🎬 CINESUBZ COMMANDS*\n\n*.cz Movie Name* — Search movies and TV series\n*.cz tv Series Name* — Search TV series\n*.cz movie Movie Name* — Search movies only\n\n📺 Select a season or episode by number\n🎥 Select quality by number\n📥 MP4 files are sent directly to WhatsApp\n\n*✦ GOD VOIP MD*');
      }
      if (first === 'movie' || first === 'movies') return search(c, parts.slice(1).join(' '), 'movies');
      if (['tv', 'show', 'tvshow'].includes(first)) return search(c, parts.slice(1).join(' '), 'tvshows');
      if (/^\d+$/.test(first)) return choose(c, Number(first));
      return search(c, raw, 'all');
    } catch (error) {
      console.error('[CINESUBZ]', error?.stack || error);
      await react(c, '⚠️');
      return say(c, '*❌ CineSubz error:* ' + bold(error.message || 'Unknown error'));
    }
  }
};