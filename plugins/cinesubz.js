// GOD VOIP MD — CineSubz TV quality picker + real WhatsApp MP4 document delivery
const BASE = 'https://mochi-apis.koyeb.app/api/movie/cinesubz';
const KEY = process.env.MOCHI_API_KEY || process.env.DNUZ_API_KEY || process.env.CINESUBZ_API_KEY || '';
const sessions = new Map();
const TTL = 30 * 60 * 1000;
const MAX_BULK_EPISODES = 20;
const clean = (v, n = 180) => String(v ?? '').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&#8217;|&#039;/g, "'").replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const bold = v => '*' + clean(v, 450) + '*';
const validPage = value => {
  try {
    const u = new URL(String(value || ''));
    return u.protocol === 'https:' && (u.hostname === 'cinesubz.net' || u.hostname.endsWith('.cinesubz.net'));
  } catch { return false; }
};
const validDirect = value => {
  try {
    const u = new URL(String(value || ''));
    return u.protocol === 'https:' && !['localhost', '127.0.0.1'].includes(u.hostname);
  } catch { return false; }
};
const sessionKey = c => String(c.jid) + '|' + String(c.m?.key?.participantAlt || c.m?.key?.participant || c.m?.key?.remoteJidAlt || c.jid);
function getSession(c) {
  const key = sessionKey(c), session = sessions.get(key);
  if (!session || Date.now() - session.at > TTL) { sessions.delete(key); return null; }
  session.at = Date.now();
  return session;
}
function setSession(c, value) {
  sessions.set(sessionKey(c), { ...value, at: Date.now() });
  if (sessions.size > 1000) {
    const oldest = [...sessions].sort((a, b) => a[1].at - b[1].at).slice(0, 200);
    for (const [key] of oldest) sessions.delete(key);
  }
}
async function react(c, emoji) {
  try { await c.sock.sendMessage(c.jid, { react: { text: emoji, key: c.m.key } }); } catch {}
}
const say = (c, text) => c.reply(text);
async function api(endpoint, params = {}) {
  if (!KEY) throw new Error('MOCHI_API_KEY secret එක hosting environment secrets වල configure කරන්න.');
  const url = new URL(BASE + '/' + endpoint);
  for (const [key, value] of Object.entries(params)) if (value != null && value !== '') url.searchParams.set(key, String(value));
  url.searchParams.set('api_key', KEY);
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'GOD-VOIP-MD-CineSubz/5.0' },
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
  return clean(option?.info || option?.quality || option?.name || option?.type || 'Available quality', 130);
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
function makeTvMenu(data) {
  const seasons = (data.seasons || []).map((season, i) => ({
    ...season,
    season_no: season.season_no ?? season.season ?? i + 1,
    episodes: (season.episodes || []).filter(ep => validPage(ep.url))
  })).filter(season => season.episodes.length);
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
  return say(c, formatSearch(data.query || query, movies, tvs));
}
async function openMovie(c, item) {
  const data = await api('info', { url: item.url });
  const links = data.downloadLinks || [];
  setSession(c, { mode: 'movie', title: data.title || item.title, links });
  const lines = ['*╭━━〔 🎬 MOVIE DETAILS 〕━━╮*', '', bold(data.title || item.title), '📅 *Year:* ' + bold(data.year || 'N/A'), '⭐ *Rating:* ' + bold(data.rating || data.imdbId || 'N/A')];
  if (data.description) lines.push('', bold(clean(data.description, 700)));
  if (links.length) lines.push('', '*⬇️ DOWNLOAD QUALITIES*', numbered(links.slice(0, 10), qualityLabel), '', '↪️ Reply with a quality number');
  else lines.push('', '❌ No download qualities found.');
  return say(c, lines.join('\n'));
}
async function openTv(c, item) {
  const data = await api('tv', { url: item.url });
  const menu = makeTvMenu(data);
  if (!menu.choices.length) return say(c, '*❌ No valid seasons or episodes found.*');
  setSession(c, { mode: 'tv', seasons: menu.seasons, choices: menu.choices, title: data.title || item.title });
  return say(c, menu.text);
}
async function getEpisodeOptions(episode) {
  if (!validPage(episode?.url)) throw new Error('Invalid episode URL');
  const data = await api('episode', { url: episode.url });
  const options = (data.dl_links || []).filter(x => validPage(x.link || x.url));
  return { data, options };
}
async function openEpisode(c, episode, title) {
  const result = await getEpisodeOptions(episode);
  if (!result.options.length) return say(c, '*❌ No download qualities found for this episode.*');
  setSession(c, { mode: 'episode_quality', title: title || result.data.title || episode.title || 'Episode', episode, options: result.options });
  const lines = ['*╭━━〔 🎞️ SELECT EPISODE QUALITY 〕━━╮*', '', bold(result.data.title || episode.title || 'Episode'), ''];
  lines.push(numbered(result.options.slice(0, 10), option => '🎥 ' + bold(qualityLabel(option)) + (sizeLabel(option) ? ' • 💾 ' + bold(sizeLabel(option)) : '')));
  lines.push('', '↪️ Reply with a number to download this episode', '*✦ GOD VOIP MD*');
  return say(c, lines.join('\n'));
}
async function resolveDirect(option, type = 'episode') {
  const pageUrl = option?.link || option?.url;
  if (!validPage(pageUrl)) throw new Error('Invalid download page URL');
  const data = await api('download', { url: pageUrl, type });
  const links = (data.dl_links || []).filter(x => validDirect(x?.url));
  if (!links.length) throw new Error('Download API did not return a valid direct media URL');
  const preferred = links.find(x => /direct/i.test(x.type || '')) || links[0];
  return { url: preferred.url, name: data.name || option.info || 'CineSubz Episode', size: data.size || sizeLabel(option), quality: qualityLabel(option) };
}
async function sendMedia(c, media, episode, index, total) {
  const epNo = episode.episode_no ?? index + 1;
  const epTitle = clean(episode.title || 'Episode ' + epNo, 90);
  const fileName = clean((media.name || ('Episode ' + epNo)) + '.mp4', 150).replace(/[\\/:*?"<>|]/g, '_');
  const caption = '📺 *' + clean(c._seriesTitle || 'CineSubz Series', 100) + '*\n' +
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
    await c.sock.sendMessage(c.jid, { document: { url: media.url }, mimetype: 'video/mp4', fileName: clean(media.name, 150) + '.mp4', caption: '🎬 *' + clean(session.title, 120) + '*\n🎥 *Quality:* ' + clean(media.quality, 100) + '\n✦ *GOD VOIP MD*' }, { quoted: c.m });
  } else {
    await sendMedia(c, media, session.episode, 0, 1);
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
  lines.push('', '↪️ Reply with a number to send every episode as an MP4 document', '⚠️ Files will be sent one by one', '*✦ GOD VOIP MD*');
  return say(c, lines.join('\n'));
}
function selectEpisodeOption(item, quality) {
  const exact = item.options.find(option => qualityKey(option) === quality.key);
  if (exact) return exact;
  const sorted = [...item.options].sort((a, b) => qualityRank(b) - qualityRank(a));
  return sorted.find(option => qualityRank(option) <= quality.rank) || sorted[0];
}
async function deliverSeason(c, session, quality) {
  const total = session.episodeData.length;
  await react(c, '⬇️');
  await say(c, '📦 *Starting Season ' + clean(session.season.season_no, 10) + ' MP4 delivery…*\n🎥 Quality: ' + bold(quality.label) + '\n📺 Files: *' + total + '*\n\nFiles are sent one by one. Keep the chat open.');
  let sent = 0, failed = [];
  for (let i = 0; i < total; i++) {
    const item = session.episodeData[i];
    try {
      const option = selectEpisodeOption(item, quality);
      const media = await resolveDirect(option, 'episode');
      await sendMedia(c, media, item.episode, i, total);
      sent++;
      await react(c, '📤');
    } catch (error) {
      failed.push('Episode ' + clean(item.episode.episode_no ?? i + 1, 8) + ': ' + clean(error.message || 'Failed', 100));
    }
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
  if (!/^\d{1,3}$/.test(value) || !getSession(c)) return false;
  try { return await choose(c, Number(value)); }
  catch (error) {
    console.error('[CINESUBZ REPLY]', error?.stack || error);
    await react(c, '⚠️');
    await say(c, '*❌ CineSubz error:* ' + bold(error.message || 'Unknown error'));
    return true;
  }
}
export default {
  name: 'cinesubz',
  aliases: ['cz', 'cs', 'cinesearch'],
  desc: 'CineSubz movies, TV seasons, quality selection and MP4 document downloads',
  ownerOnly: false,
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