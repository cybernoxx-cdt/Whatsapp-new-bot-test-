// GOD VOIP MD catalog search helper. API responses are treated as untrusted data.
const TTL = 15 * 60 * 1000;
const sessions = new Map();
const clean = (v, max = 180) => String(v ?? '').replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const list = value => Array.isArray(value) ? value : [];
const pickArray = (obj, keys) => {
  for (const key of keys) if (Array.isArray(obj?.[key])) return obj[key];
  return [];
};
const validHttps = value => {
  try { const u = new URL(String(value || '')); return u.protocol === 'https:'; } catch { return false; }
};
async function api(base, endpoint, params = {}) {
  const url = new URL(endpoint, base + '/');
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'GOD-VOIP-MD/1.0' }, signal: AbortSignal.timeout(25000) });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.success === false || data.status === false || data.error) {
    throw new Error(clean(data?.message || data?.error || `API returned HTTP ${res.status}`, 220));
  }
  return data.data && typeof data.data === 'object' ? data.data : data;
}
const keyFor = c => String(c.jid) + '|' + String(c.m?.key?.participantAlt || c.m?.key?.participant || c.m?.key?.remoteJidAlt || c.jid);
function save(c, value) {
  const key = keyFor(c);
  sessions.set(key, { ...value, at: Date.now() });
  if (sessions.size > 500) {
    for (const [k, v] of sessions) if (Date.now() - v.at > TTL) sessions.delete(k);
    while (sessions.size > 500) sessions.delete(sessions.keys().next().value);
  }
}
function get(c) {
  const key = keyFor(c), value = sessions.get(key);
  if (!value || Date.now() - value.at > TTL) { sessions.delete(key); return null; }
  value.at = Date.now();
  return value;
}
function label(item, i) {
  return `*${i + 1}.* ${clean(item?.title || item?.name || item?.appName || item?.gameName || 'Untitled item', 140)}`;
}
function itemUrl(item) {
  const u = item?.url || item?.link || item?.pageUrl || item?.downloadPageUrl;
  return validHttps(u) ? u : '';
}
function makeFileLines(files) {
  return files.map((f, i) => `*${i + 1}.* ${clean(f?.fileName || f?.name || f?.title || f?.quality || 'Download file', 100)}${f?.size ? ' — ' + clean(f.size, 30) : ''}`).join('\n');
}
export function createCatalogPlugin({ name, aliases = [], description, base, searchEndpoint, searchParam = 'q', fixedEndpoint, fixedParam, mode = 'app' }) {
  async function run(ctx) {
    const query = ctx.text.trim();
    if (!query) return ctx.reply(`╭━━〔 ✦ GOD VOIP MD 〕━━╮\n\n🔎 *${name.toUpperCase()} SEARCH*\n\nUsage: ${ctx.prefix}${name} <name>\nExample: ${ctx.prefix}${name} ${name === 'oldgame' ? 'taxi racer' : name === 'modgame' ? 'gta san andreas' : 'spotify'}\n\n⏳ Search sessions expire in 15 minutes.\n╰━━━━━━━━━━━━━━━━━━━━╯`);
    try {
      const data = fixedEndpoint
        ? await api(base, fixedEndpoint, { [fixedParam]: 1 })
        : await api(base, searchEndpoint, { [searchParam]: query, page: 1 });
      const items = pickArray(data, ['items', 'results', 'apps', 'games', 'data']);
      if (!items.length) return ctx.reply('❌ No results found. Try another search phrase.');
      save(ctx, { step: 'results', items, query, mode });
      return ctx.reply(`╭━━〔 ${mode === 'oldgame' ? '🎮 OLD PC GAMES' : mode === 'modgame' ? '🎮 MOD GAMES' : '📱 MOD APK'} 〕━━╮\n\n🔎 *Search:* ${clean(query, 100)}\n📦 *Results:* ${items.length}\n\n${items.slice(0, 10).map(label).join('\n')}\n\n↪️ Reply with a result number.\n⏳ Expires in 15 minutes\n\n✦ GOD VOIP MD`);
    } catch (e) {
      return ctx.reply(`⚠️ Search failed: ${clean(e.message, 220)}\nPlease try again later.`);
    }
  }
  async function onMessage(ctx) {
    const s = get(ctx);
    if (!s) return false;
    const text = String(ctx.text || '').trim();
    if (!/^\d{1,3}$/.test(text)) return false;
    const n = Number(text);
    if (s.step === 'results') {
      const item = s.items[n - 1];
      if (!item) { await ctx.reply('❌ Invalid number. Reply with a number shown in the latest menu.'); return true; }
      const url = itemUrl(item);
      if (!url) { await ctx.reply('❌ This result does not contain a valid HTTPS page URL.'); return true; }
      try {
        const info = await api(base, mode === 'oldgame' ? 'info' : 'information', { url });
        const title = clean(info.title || info.name || item.title || item.name || 'Download', 140);
        if (mode === 'oldgame') {
          const platforms = pickArray(info, ['platforms', 'platform', 'systems']);
          const files = pickArray(info, ['files', 'downloads', 'links']);
          if (platforms.length) {
            save(ctx, { ...s, step: 'platforms', info, title, platforms });
            await ctx.reply(`🎮 *${title}*\n\nChoose a platform:\n${platforms.slice(0, 20).map(label).join('\n')}\n\nReply with a platform number.`);
            return true;
          }
          if (files.length) {
            save(ctx, { ...s, step: 'files', info, title, files });
            await ctx.reply(`🎮 *${title}*\n\nChoose a file:\n${makeFileLines(files.slice(0, 20))}\n\nReply with a file number.`);
            return true;
          }
          await ctx.reply(`🎮 *${title}*\nNo downloadable files were returned by the API.`);
          return true;
        }
        const downloadPageUrl = info.downloadPageUrl || item.url || url;
        const dl = await api(base, 'dl', { url: downloadPageUrl });
        const downloadUrl = dl.downloadUrl || dl.url || dl.link;
        if (!validHttps(downloadUrl)) throw new Error('The API did not return a valid HTTPS download link.');
        save(ctx, { step: 'done', items: [], mode });
        await ctx.reply(`╭━━〔 ✦ GOD VOIP MD 〕━━╮\n\n📦 *${title}*\n${info.version ? '🔖 Version: ' + clean(info.version, 50) + '\n' : ''}${info.size ? '💾 Size: ' + clean(info.size, 40) + '\n' : ''}\n⬇️ *Download link:*\n${downloadUrl}\n\n⚠️ Install APKs only from sources you trust.\n✦ GOD VOIP MD`);
        return true;
      } catch (e) { await ctx.reply(`⚠️ Could not load this result: ${clean(e.message, 220)}`); return true; }
    }
    if (s.step === 'platforms') {
      const platform = s.platforms[n - 1];
      if (!platform) { await ctx.reply('❌ Invalid platform number.'); return true; }
      try {
        let files = pickArray(platform, ['files', 'downloads', 'links']);
        if (!files.length) {
          const pname = platform.name || platform.platform || platform.title;
          const data = await api(base, 'platform', { name: pname, page: 1 });
          files = pickArray(data, ['items', 'files', 'downloads', 'games']);
        }
        if (!files.length) throw new Error('No files were returned for this platform.');
        save(ctx, { ...s, step: 'files', selectedPlatform: platform, files });
        await ctx.reply(`🕹️ *${clean(platform.name || platform.title || platform.platform || 'Platform', 80)}*\n\nChoose a file:\n${makeFileLines(files.slice(0, 20))}\n\nReply with a file number.`);
      } catch (e) { await ctx.reply(`⚠️ Platform lookup failed: ${clean(e.message, 200)}`); }
      return true;
    }
    if (s.step === 'files') {
      const file = s.files[n - 1];
      if (!file) { await ctx.reply('❌ Invalid file number.'); return true; }
      const url = itemUrl(file);
      if (!url) { await ctx.reply('❌ This file has no valid HTTPS URL.'); return true; }
      try {
        const dl = await api(base, 'dl', { url });
        const downloadUrl = dl.downloadUrl || dl.url || dl.link;
        if (!validHttps(downloadUrl)) throw new Error('The API did not return a valid HTTPS download link.');
        save(ctx, { ...s, step: 'done' });
        await ctx.reply(`╭━━〔 🎮 OLD PC GAME 〕━━╮\n\n🎯 *${clean(s.title, 140)}*\n🕹️ Platform: ${clean(s.selectedPlatform?.name || s.selectedPlatform?.title || s.selectedPlatform?.platform || 'Selected', 80)}\n📁 File: ${clean(file.fileName || file.name || file.title || 'Game file', 120)}\n${file.size ? '💾 Size: ' + clean(file.size, 40) + '\n' : ''}\n⬇️ *Download:*\n${downloadUrl}\n\n✦ GOD VOIP MD`);
      } catch (e) { await ctx.reply(`⚠️ Download lookup failed: ${clean(e.message, 220)}`); }
      return true;
    }
    return false;
  }
  return { name, aliases, desc: description, category: 'download', ownerOnly: false, async run(ctx) { await run(ctx); }, async onMessage(ctx) { return onMessage(ctx); } };
}
