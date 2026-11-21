// GOD VOIP MD — CineSubz optimized season/episode selector
const BASE = 'https://mochi-apis.koyeb.app/api/movie/cinesubz';
const KEY = process.env.MOCHI_API_KEY || process.env.DNUZ_API_KEY || process.env.CINESUBZ_API_KEY || '';
const sessions = new Map();
const TTL = 30 * 60 * 1000;
const clean = (v, n = 180) => String(v ?? '').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&#8217;|&#039;/g, "'").replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const bold = v => '*' + clean(v, 450) + '*';
const validPage = value => {
  try {
    const u = new URL(String(value || ''));
    return u.protocol === 'https:' && (u.hostname === 'cinesubz.net' || u.hostname.endsWith('.cinesubz.net'));
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
async function api(endpoint, params = {}) {
  if (!KEY) throw new Error('MOCHI_API_KEY secret එක hosting environment secrets වල configure කරන්න.');
  const url = new URL(BASE + '/' + endpoint);
  for (const [key, value] of Object.entries(params)) if (value != null && value !== '') url.searchParams.set(key, String(value));
  url.searchParams.set('api_key', KEY);
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'GOD-VOIP-MD-CineSubz/4.0' },
    signal: AbortSignal.timeout(40000)
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data || data.success === false || data.status === false) {
    throw new Error(clean(data?.message || data?.error || 'API HTTP ' + response.status));
  }
  return data;
}
const say = (c, text) => c.reply(text);
async function react(c, emoji = '🎬') {
  try { await c.sock.sendMessage(c.jid, { react: { text: emoji, key: c.m.key } }); } catch {}
}
function numbered(items, render, start = 1) {
  return items.map((item, i) => '*' + (start + i) + '.* ' + render(item)).join('\n');
}
function resultsText(query, movies, tvs) {
  const lines = ['*╭━━〔 🎬 CINESUBZ RESULTS 〕━━╮*', '', '*🔎 SEARCH:* ' + bold(query), '*📦 RESULTS:* ' + bold(movies.length + tvs.length), ''];
  if (movies.length) lines.push('*🎬 MOVIES*', numbered(movies, x => bold(x.title) + (x.rating ? ' ⭐ ' + bold(x.rating) : '')), '');
  if (tvs.length) lines.push('*📺 TV SHOWS*', numbered(tvs, x => bold(x.title) + (x.rating ? ' ⭐ ' + bold(x.rating) : ''), movies.length + 1), '');
  lines.push('*━━━━━━━━━━━━━━━━━━━━*', '*↪ Reply with a number to select*', '*⏳ Menu expires in 30 minutes*', '*✦ GOD VOIP MD*', '*╰━━━━━━━━━━━━━━━━━━━━╯*');
  return lines.join('\n');
}
function movieText(d) {
  const lines = ['*╭━━〔 🎬 MOVIE DETAILS 〕━━╮*', '', bold(d.title || 'Movie'), '📅 *Year:* ' + bold(d.year || 'N/A'), '⭐ *IMDb ID:* ' + bold(d.imdbId || 'N/A'), '🎥 *Quality:* ' + bold(d.quality || 'N/A'), '⏱️ *Duration:* ' + bold(d.duration || 'N/A'), '🌍 *Country:* ' + bold(d.country || 'N/A'), '🎬 *Director:* ' + bold(d.director || 'N/A'), '📝 *Subtitles:* ' + bold(d.subtitleBy || 'N/A')];
  if (d.genres?.length) lines.push('🏷️ *Genres:* ' + bold(d.genres.join(', ')));
  if (d.cast?.length) lines.push('', '*CAST*', ...d.cast.slice(0, 6).map(x => '• ' + bold(x.name) + ' — ' + bold(x.role || '')));
  if (d.description) lines.push('', '*DESCRIPTION*', bold(clean(d.description, 850)));
  if (d.downloadLinks?.length) lines.push('', '*DOWNLOAD OPTIONS*', numbered(d.downloadLinks.slice(0, 10), x => bold(x.info || x.quality || 'Download')), '', '*↪ Reply with a number to get the direct link*');
  lines.push('', '*✦ GOD VOIP MD*', '*╰━━━━━━━━━━━━━━━━━━━━╯*');
  return lines.join('\n');
}
function makeTvMenu(data) {
  const seasons = (data.seasons || []).map((season, index) => ({
    ...season,
    season_no: season.season_no ?? index + 1,
    episodes: (season.episodes || []).filter(ep => validPage(ep.url))
  })).filter(season => season.episodes.length);
  const choices = [];
  const lines = ['*╭━━〔 📺 CINESUBZ TV MENU 〕━━╮*', '', bold(data.title || 'TV Show'), ''];
  for (const season of seasons) {
    lines.push('*━━━ ' + bold('SEASON ' + season.season_no) + ' ━━━*');
    const allNumber = choices.length + 1;
    choices.push({ type: 'bulk', seasonIndex: seasons.indexOf(season) });
    lines.push('*' + allNumber + '.* 📦 ' + bold('Season ' + season.season_no + ' — All Episodes Download'));
    for (const episode of season.episodes) {
      const number = choices.length + 1;
      choices.push({ type: 'episode', episode });
      lines.push('*' + number + '.* 📺 ' + bold('Episode ' + (episode.episode_no ?? number)) + (episode.title ? ' — ' + bold(episode.title) : ''));
    }
    lines.push('');
  }
  lines.push('*━━━━━━━━━━━━━━━━━━━━*', '*↪ Reply with the number you want*', '*1 = Download every episode in that season*', '*Single episode = choose its number*', '*⏳ Menu expires in 30 minutes*', '*✦ GOD VOIP MD*', '*╰━━━━━━━━━━━━━━━━━━━━╯*');
  return { seasons, choices, text: lines.join('\n') };
}
function episodeText(data) {
  const lines = ['*╭━━〔 📺 EPISODE DETAILS 〕━━╮*', '', bold(data.title || 'Episode'), '📺 *Show:* ' + bold(data.show_name || 'N/A'), '📅 *Year:* ' + bold(data.year || 'N/A'), '⭐ *Rating:* ' + bold(data.rating || 'N/A')];
  if (data.dl_links?.length) lines.push('', '*DOWNLOAD QUALITIES*', numbered(data.dl_links.slice(0, 10), x => bold(x.info || 'Download')), '', '*↪ Reply with a number to get the direct link*');
  lines.push('', '*✦ GOD VOIP MD*', '*╰━━━━━━━━━━━━━━━━━━━━╯*');
  return lines.join('\n');
}
async function search(c, query, filter = 'all') {
  if (!query) return say(c, '*Usage: .cz Movie Name*');
  const result = await api('search', { q: query, filter });
  const data = result.data || {};
  const movies = (data.movies || []).filter(x => validPage(x.url)).slice(0, 12);
  const tvs = (data.tvshows || []).filter(x => validPage(x.url)).slice(0, 12);
  const items = [...movies.map(x => ({ ...x, kind: 'movie' })), ...tvs.map(x => ({ ...x, kind: 'tv' }))];
  if (!items.length) return say(c, '*😕 No results found. Try another title.*');
  setSession(c, { mode: 'search', items });
  return say(c, resultsText(result.query || query, movies, tvs));
}
async function openMovie(c, item) {
  const data = (await api('info', { url: item.url })).data || {};
  setSession(c, { mode: 'movie', links: data.downloadLinks || [] });
  return say(c, movieText(data));
}
async function openTv(c, item) {
  const data = (await api('tv', { url: item.url })).data || {};
  const menu = makeTvMenu(data);
  if (!menu.choices.length) return say(c, '*❌ No valid seasons or episode links were found.*');
  setSession(c, { mode: 'tv', seasons: menu.seasons, choices: menu.choices, title: data.title || item.title });
  return say(c, menu.text);
}
async function openEpisode(c, episode) {
  if (!validPage(episode?.url)) throw new Error('Invalid episode URL');
  const data = (await api('episode', { url: episode.url })).data || {};
  setSession(c, { mode: 'episode', data, links: data.dl_links || [] });
  return say(c, episodeText(data));
}
async function resolveDownload(c, session, index) {
  const option = session.links?.[index];
  if (!option) return say(c, '*❌ Invalid download number. Reply with a number shown in the quality menu.*');
  const pageUrl = option.link || option.url;
  if (!validPage(pageUrl)) throw new Error('Invalid download page URL');
  const data = (await api('download', { url: pageUrl, type: session.mode === 'episode' ? 'episode' : 'movie' })).data || {};
  const links = (data.dl_links || []).filter(link => /^https:\/\//i.test(link?.url || ''));
  if (!links.length) throw new Error('No direct download URL returned');
  const lines = ['*╭━━〔 ⬇️ DIRECT DOWNLOAD 〕━━╮*', '', bold(data.name || option.info || 'Download'), '💾 *Size:* ' + bold(data.size || 'N/A'), ''];
  links.slice(0, 5).forEach((link, i) => lines.push('*' + (i + 1) + '. ' + clean(link.type || 'Direct', 20) + '*', link.url));
  lines.push('', '*⚠️ Signed links may expire. Save soon.*', '*✦ GOD VOIP MD*', '*╰━━━━━━━━━━━━━━━━━━━━╯*');
  return say(c, lines.join('\n'));
}
function qualityScore(option) {
  return Number((String(option?.info || '').match(/(2160|1080|720|480|360)p/i) || [])[1] || 0);
}
async function resolveOneEpisode(episode) {
  try {
    const data = (await api('episode', { url: episode.url })).data || {};
    const options = (data.dl_links || []).filter(option => validPage(option.link || option.url)).sort((a, b) => qualityScore(b) - qualityScore(a));
    for (const option of options) {
      try {
        const result = (await api('download', { url: option.link || option.url, type: 'episode' })).data || {};
        const direct = (result.dl_links || []).find(link => /^https:\/\//i.test(link?.url || ''));
        if (direct) return { episode, url: direct.url, quality: option.info || direct.type || 'Direct' };
      } catch {}
    }
    return { episode, error: 'No direct link' };
  } catch (error) {
    return { episode, error: clean(error.message || 'Failed') };
  }
}
async function downloadSeason(c, session, seasonIndex) {
  const season = session.seasons?.[seasonIndex];
  if (!season) return say(c, '*❌ Season not found. Open a TV show first.*');
  const episodes = season.episodes || [];
  if (!episodes.length) return say(c, '*❌ No episodes found in this season.*');
  if (episodes.length > 30) return say(c, '*⚠️ This season has more than 30 episodes. Use individual episode options.*');
  await react(c, '⏳');
  await say(c, '*⏳ Preparing Season ' + clean(season.season_no, 12) + ' links...* ' + bold(episodes.length + ' episodes'));
  const results = new Array(episodes.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(3, episodes.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= episodes.length) return;
      results[index] = await resolveOneEpisode(episodes[index]);
    }
  });
  await Promise.all(workers);
  const ready = results.filter(result => result?.url);
  const failed = results.filter(result => !result?.url);
  if (!ready.length) return say(c, '*❌ Could not resolve any episode links. Please try again later.*');
  const lines = ['*╭━━〔 📦 SEASON DOWNLOAD LINKS 〕━━╮*', bold(session.title || 'TV Show'), '*Season:* ' + bold(season.season_no), '*Ready:* ' + bold(ready.length + '/' + episodes.length), ''];
  for (const result of ready) {
    lines.push('*Episode ' + clean(result.episode.episode_no ?? '?', 8) + ' — ' + clean(result.episode.title || 'Episode', 75) + '*', bold(result.quality), result.url, '');
  }
  if (failed.length) lines.push('*⚠️ Failed episodes:* ' + bold(failed.map(result => result.episode.episode_no ?? '?').join(', ')), '');
  lines.push('*⚠️ Signed links may expire. Save them soon.*', '*✦ GOD VOIP MD*', '*╰━━━━━━━━━━━━━━━━━━━━╯*');
  const message = lines.join('\n');
  for (let offset = 0; offset < message.length; offset += 3300) await say(c, message.slice(offset, offset + 3300));
}
async function choose(c, number) {
  const session = getSession(c);
  if (!session) return false;
  if (session.mode === 'search') {
    const item = session.items[number - 1];
    if (!item) { await say(c, '*❌ Invalid result number.*'); return true; }
    if (item.kind === 'tv') await openTv(c, item);
    else await openMovie(c, item);
    return true;
  }
  if (session.mode === 'tv') {
    const choice = session.choices?.[number - 1];
    if (!choice) { await say(c, '*❌ Invalid menu number. Reply using a number shown in the TV menu.*'); return true; }
    if (choice.type === 'bulk') await downloadSeason(c, session, choice.seasonIndex);
    else await openEpisode(c, choice.episode);
    return true;
  }
  if (session.mode === 'movie' || session.mode === 'episode') {
    await resolveDownload(c, session, number - 1);
    return true;
  }
  return false;
}
async function plainReply(c, text) {
  const value = String(text || '').trim();
  if (!/^\d{1,3}$/.test(value)) return false;
  if (!getSession(c)) return false;
  await react(c);
  try { return await choose(c, Number(value)); }
  catch (error) {
    console.error('[CINESUBZ REPLY]', error?.stack || error);
    await say(c, '*❌ CineSubz error:* ' + bold(error.message || 'Unknown error'));
    return true;
  }
}
export default {
  name: 'cinesubz',
  aliases: ['cz', 'cs', 'cinesearch'],
  desc: 'CineSubz movies, TV seasons, bulk episode links and individual downloads',
  ownerOnly: false,
  async onMessage(context) { return plainReply(context, context.text); },
  async run(c) {
    await react(c);
    try {
      const raw = String(c.text || '').trim();
      const parts = raw.split(/\s+/).filter(Boolean);
      const first = (parts[0] || '').toLowerCase();
      if (!KEY) throw new Error('MOCHI_API_KEY secret එක hosting environment එකේ configure කරලා නැහැ.');
      if (!raw || first === 'help') {
        return say(c, '*CINESUBZ COMMANDS*\n\n*.cz Movie Name* — Search\n*Reply with a number* — Select movie, season-all, episode or quality\n*.cz movie Name* — Movies only\n*.cz tv Name* — TV shows only\n*.cz next / .cz prev* — Episode navigation\n\n*✦ GOD VOIP MD*');
      }
      if (first === 'movie' || first === 'movies') return search(c, parts.slice(1).join(' '), 'movies');
      if (['tv', 'show', 'tvshow'].includes(first)) return search(c, parts.slice(1).join(' '), 'tvshows');
      if (['next', 'prev', 'previous'].includes(first)) {
        const session = getSession(c);
        if (!session || session.mode !== 'episode') return say(c, '*Open an episode first.*');
        const url = first === 'next' ? session.data?.nav?.next_episode : session.data?.nav?.previous_episode;
        if (!validPage(url)) return say(c, '*No more episodes.*');
        return openEpisode(c, { url });
      }
      if (/^\d+$/.test(first)) return choose(c, Number(first));
      return search(c, raw, 'all');
    } catch (error) {
      console.error('[CINESUBZ]', error?.stack || error);
      return say(c, '*❌ CineSubz error:* ' + bold(error.message || 'Unknown error'));
    }
  }
};