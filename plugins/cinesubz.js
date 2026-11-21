// CineSubz plugin for GOD VOIP MD
// Commands: .cs <query> / .cz <query>; .cs movie <query>; .cs tv <query>
// Flow: .cs 1 opens a result; .cs ep 1 opens an episode; .cs dl 1 resolves a download.
const BASE = 'https://mochi-apis.koyeb.app/api/movie/cinesubz';
// Shared Mochi API credential. DNUZ_API_KEY remains a backward-compatible fallback.
const KEY = process.env.MOCHI_API_KEY || process.env.DNUZ_API_KEY || process.env.CINESUBZ_API_KEY || '';
const sessions = new Map();
const TTL = 20 * 60 * 1000;
const clean = (v, n = 220) => String(v ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&#8217;|&#039;/g, "'").replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const valid = value => { try { const u = new URL(String(value || '')); return u.protocol === 'https:' && (u.hostname === 'cinesubz.net' || u.hostname.endsWith('.cinesubz.net')); } catch { return false; } };
const keyOf = c => String(c.jid) + ':' + String(c.m?.key?.participant || c.m?.key?.participantAlt || c.m?.key?.remoteJid || c.jid);
function get(c) { const s = sessions.get(keyOf(c)); if (!s || Date.now() - s.at > TTL) { sessions.delete(keyOf(c)); return null; } s.at = Date.now(); return s; }
function set(c, s) { sessions.set(keyOf(c), { ...s, at: Date.now() }); if (sessions.size > 500) for (const [k] of [...sessions].sort((a,b)=>a[1].at-b[1].at).slice(0,100)) sessions.delete(k); }
async function api(path, params = {}) {
    if (!KEY) throw new Error('MOCHI_API_KEY (හෝ DNUZ_API_KEY) GitHub Secret එක configure කරලා නැහැ.');
    const u = new URL(BASE + '/' + path);
    for (const [k,v] of Object.entries(params)) if (v != null && v !== '') u.searchParams.set(k, String(v));
    u.searchParams.set('api_key', KEY);
    const r = await fetch(u, { headers: { Accept: 'application/json', 'User-Agent': 'GOD-VOIP-MD/1.0' }, signal: AbortSignal.timeout(45000) });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || j.success === false || j.status === false) throw new Error(clean(j?.message || j?.error) || 'CineSubz API HTTP ' + r.status);
    return j;
}
const numbered = (a, fn, max = 15) => a.slice(0,max).map((x,i)=>(i+1)+'. '+fn(x)).join('\n');
function help(p) { return ['╭━━〔 🎬 CINESUBZ 〕━━╮','','🔎 '+p+'cs Deadpool','🎞️ '+p+'cs movie Avatar','📺 '+p+'cs tv Loki','','➡️ Open result: '+p+'cs 1','📺 Open episode: '+p+'cs ep 1','⬇️ Download link: '+p+'cs dl 1','⏮️ '+p+'cs prev | ⏭️ '+p+'cs next','','Selection expires in 20 minutes.','> ✦ GOD VOIP MD','╰━━━━━━━━━━━━━━━━━━━━╯'].join('\n'); }
function movieInfo(d) {
    const a=['╭━━〔 🎬 MOVIE DETAILS 〕━━╮','','🎞️ *'+clean(d.title,170)+'*','📅 Year: '+clean(d.year||'N/A',25),'⭐ IMDb ID: '+clean(d.imdbId||'N/A',25),'🎥 Quality: '+clean(d.quality||'N/A',30),'⏱️ Duration: '+clean(d.duration||'N/A',30),'🌍 Country: '+clean(d.country||'N/A',45),'🎬 Director: '+clean(d.director||'N/A',150),'📝 Subtitles: '+clean(d.subtitleBy||'N/A',90)];
    if(d.genres?.length)a.push('🏷️ Genres: '+d.genres.map(x=>clean(x,30)).join(', '));
    if(d.cast?.length)a.push('','*CAST*',...d.cast.slice(0,6).map(x=>'• '+clean(x.name,50)+' — '+clean(x.role||'',60)));
    if(d.description)a.push('','*DESCRIPTION*',clean(d.description,900));
    if(d.downloadLinks?.length)a.push('','*DOWNLOAD OPTIONS*',numbered(d.downloadLinks,x=>clean(x.info||x.quality||x.link,120),10),'','Download with: .cz dl 1');
    a.push('','> ✦ GOD VOIP MD','╰━━━━━━━━━━━━━━━━━━━━╯'); return a.join('\n');
}
function tvInfo(d) {
    const seasons=(d.seasons||[]).map(s=>({...s,episodes:(s.episodes||[]).filter(e=>valid(e.url))}));
    const eps=[]; for(const s of seasons)for(const e of s.episodes)eps.push({...e,season_no:s.season_no});
    const a=['╭━━〔 📺 TV SHOW DETAILS 〕━━╮','','📺 *'+clean(d.title,160)+'*','📅 Year: '+clean(d.year||'N/A',20),'⭐ IMDb: '+clean(d.imdbRating||'N/A',20),'🆔 IMDb ID: '+clean(d.imdbId||'N/A',25)];
    if(d.genres?.length)a.push('🏷️ Genres: '+d.genres.map(x=>clean(x,30)).join(', '));
    if(d.cast?.length)a.push('','*CAST*',...d.cast.slice(0,5).map(x=>'• '+clean(x.name,50)+' — '+clean(x.role||'',60)));
    if(seasons.length)a.push('','*SEASONS*',...seasons.map((s,i)=>'S'+s.season_no+' — '+s.episodes.length+' episodes | Select: .cz season '+(i+1)));
    if(eps.length)a.push('','*EPISODES ('+eps.length+')*',numbered(eps,e=>'S'+e.season_no+' E'+e.episode_no+' — '+clean(e.title,80),40),'','Open episode: .cz ep 1','Download a whole season: .cz season 1 then .cz season dl 1');
    a.push('','> ✦ GOD VOIP MD','╰━━━━━━━━━━━━━━━━━━━━╯'); return { text:a.join('\n'), eps, seasons };
}
function episodeInfo(d) {
    const a=['╭━━〔 📺 EPISODE DETAILS 〕━━╮','','🎬 *'+clean(d.title||'Episode',140)+'*','📺 Show: '+clean(d.show_name||'N/A',80),'📅 Year: '+clean(d.year||'N/A',20),'⭐ Rating: '+clean(d.rating||'N/A',20)];
    if(d.description&&d.description!=='N/A')a.push('',clean(d.description,500));
    if(d.dl_links?.length)a.push('','*DOWNLOAD QUALITIES*',numbered(d.dl_links,x=>clean(x.info||x.link,120),10),'','Download with: .cs dl 1');
    if(d.nav?.previous_episode)a.push('','Previous: .cz prev'); if(d.nav?.next_episode)a.push('Next: .cz next');
    a.push('','> ✦ GOD VOIP MD','╰━━━━━━━━━━━━━━━━━━━━╯'); return a.join('\n');
}
async function search(c,q,filter='all') {
    if(!q)return c.reply(help(c.prefix));
    await c.reply('🔎 CineSubz search කරනවා...\n\n> '+clean(q,100));
    const j=await api('search',{q,filter}),d=j.data||{};
    const items=[...(d.movies||[]).map(x=>({...x,kind:'movie'})),...(d.tvshows||[]).map(x=>({...x,kind:'tv'}))].filter(x=>valid(x.url)).slice(0,15);
    if(!items.length)return c.reply('😕 Results හමු වුණේ නැහැ. වෙනත් keyword එකක් try කරන්න.');
    set(c,{mode:'search',items});
    return c.reply(['╭━━〔 🎬 CINESUBZ RESULTS 〕━━╮','','🔎 Query: *'+clean(j.query||q,100)+'*','📦 Results: '+items.length,'',numbered(items,x=>(x.kind==='tv'?'📺 TV | ':'🎬 Movie | ')+clean(x.title,130)+(x.rating?' ⭐ '+clean(x.rating,8):'')),'','Select: '+c.prefix+'cz 1','> ✦ GOD VOIP MD','╰━━━━━━━━━━━━━━━━━━━━╯'].join('\n'));
}
async function openMovie(c,x) {
    await c.reply('🎬 Movie details load කරනවා...');
    const d=(await api('info',{url:x.url})).data||{}; set(c,{mode:'movie',links:d.downloadLinks||[]});
    if(d.poster&&/^https:\/\//i.test(d.poster))await c.sock.sendMessage(c.jid,{image:{url:d.poster},caption:movieInfo(d)},{quoted:c.m}); else await c.reply(movieInfo(d));
}
async function openTv(c,x) {
    await c.reply('📺 TV show details load කරනවා...');
    const d=(await api('tv',{url:x.url})).data||{},f=tvInfo(d); set(c,{mode:'tv',eps:f.eps,seasons:f.seasons,selectedSeason:null});
    if(d.image&&/^https:\/\//i.test(d.image))await c.sock.sendMessage(c.jid,{image:{url:d.image},caption:f.text},{quoted:c.m}); else await c.reply(f.text);
}
async function openEpisode(c,x) {
    if(!valid(x?.url))throw new Error('Episode URL එක valid නැහැ.');
    await c.reply('📺 Episode details load කරනවා...');
    const d=(await api('episode',{url:x.url})).data||{}; set(c,{mode:'episode',data:d,links:d.dl_links||[]}); await c.reply(episodeInfo(d));
}
function qualityScore(info) {
    const m=String(info||'').match(/(2160|1440|1080|720|480|360)p/i);
    return m ? Number(m[1]) : 0;
}
async function resolveEpisodeDirect(ep) {
    if(!valid(ep?.url))throw new Error('Invalid episode URL');
    const info=(await api('episode',{url:ep.url})).data||{};
    const options=(info.dl_links||[]).filter(x=>valid(x?.link||x?.url)).sort((a,b)=>qualityScore(b.info)-qualityScore(a.info));
    if(!options.length)throw new Error('No episode download options');
    let lastError;
    for(const option of options) {
        try {
            const page=option.link||option.url;
            const result=(await api('download',{url:page,type:'episode'})).data||{};
            const direct=(result.dl_links||[]).find(x=>/^https:\/\//i.test(x?.url||''));
            if(direct)return {url:direct.url,name:result.name||info.title||ep.title||'Episode',size:result.size||'',quality:option.info||'Best available'};
            lastError=new Error('No direct URL returned');
        } catch(error) { lastError=error; }
    }
    throw lastError||new Error('Could not resolve episode');
}
async function downloadSeason(c,s,index) {
    const season=s.seasons?.[index];
    if(!season)return c.reply('❌ Season එක හමු වුණේ නැහැ.');
    const episodes=(season.episodes||[]).filter(e=>valid(e.url));
    if(!episodes.length)return c.reply('❌ මේ season එකේ valid episode links නැහැ.');
    if(episodes.length>50)return c.reply('⚠️ මේ season එකේ episodes 50කට වැඩියි. Server/API overload නොවීමට එකවර 50ක් දක්වා පමණක් support කරනවා.');
    await c.reply('⏳ *Season '+clean(season.season_no,8)+' bulk download links සකස් කරනවා...*\n📺 Episodes: '+episodes.length+'\n\nඑක් එක් episode එකේ හොඳම available quality එක resolve කරනවා. ටිකක් ඉවසන්න.');
    const resolved=[],failed=[];
    for(let i=0;i<episodes.length;i++) {
        const ep=episodes[i];
        try {
            const direct=await resolveEpisodeDirect(ep);
            resolved.push({episode:ep,url:direct.url,quality:direct.quality,size:direct.size});
        } catch(error) {
            failed.push({episode:ep,error:clean(error?.message||'Resolve failed',90)});
        }
        if((i+1)%4===0 && i+1<episodes.length) {
            await c.reply('⏳ Progress: '+(i+1)+'/'+episodes.length+' episodes processed...');
        }
    }
    const lines=resolved.map((x,i)=>(i+1)+'. *E'+clean(x.episode.episode_no,8)+' — '+clean(x.episode.title||'Episode',75)+'*\n'+clean(x.quality,90)+(x.size?' • '+clean(x.size,20):'')+'\n'+x.url);
    const header='╭━━〔 📦 SEASON '+clean(season.season_no,8)+' DOWNLOADS 〕━━╮\n📺 *'+clean(s.title||'TV Series',120)+'*\n✅ Ready: '+resolved.length+'/'+episodes.length+'\n';
    const footer='\n\nSigned URLs may expire; download/save them soon.\n> ✦ GOD VOIP MD\n╰━━━━━━━━━━━━━━━━━━━━╯';
    if(!resolved.length) {
        await c.reply('❌ Direct links resolve වුණේ නැහැ. '+failed.length+' episodes fail වුණා. ටිකකින් නැවත try කරන්න.');
        return;
    }
    const chunks=[];
    let current=header;
    for(const line of lines) {
        if((current+'\n\n'+line+footer).length>3200 && current!==header) { chunks.push(current); current=header+'(continued)\n'; }
        current+=(current===header?'':'\n\n')+line;
    }
    if(current.trim())chunks.push(current+footer);
    for(const chunk of chunks)await c.reply(chunk);
    if(failed.length) {
        await c.reply('⚠️ *Failed episodes ('+failed.length+'):*\n'+failed.map(x=>'• E'+clean(x.episode.episode_no,8)+' — '+clean(x.error,90)).join('\n'));
    }
    set(c,{...s,mode:'tv',selectedSeason:index});
}
async function download(c,s,n) {
    const item=s.links?.[n]; if(!item)return c.reply('❌ Download option එක හමු වුණේ නැහැ.');
    const target=item.link||item.url; if(!valid(target))return c.reply('❌ CineSubz download page URL එක valid නැහැ.');
    await c.reply('⬇️ Download link generate කරනවා...');
    const d=(await api('download',{url:target,type:s.mode==='episode'?'episode':'movie'})).data||{};
    const links=(d.dl_links||[]).filter(x=>/^https:\/\//i.test(x?.url||'')); if(!links.length)throw new Error('Direct download URL එකක් ලැබුණේ නැහැ.');
    const a=['╭━━〔 ⬇️ CINESUBZ DOWNLOAD 〕━━╮','','📁 *'+clean(d.name||item.info||'Download file',160)+'*','💾 Size: '+clean(d.size||'N/A',25),''];
    links.slice(0,5).forEach((x,i)=>a.push((i+1)+'. *'+clean(x.type||'Direct',20)+'*\n'+x.url));
    a.push('','Signed download URL expire විය හැකියි.','> ✦ GOD VOIP MD','╰━━━━━━━━━━━━━━━━━━━━╯'); await c.reply(a.join('\n'));
}
export default {
    name:'cinesubz', aliases:['cs','cz','cinesearch'],
    desc:'Search CineSubz movies/TV shows, browse seasons and bulk-download episode links',
    ownerOnly:false,
    async run(c) {
        const raw=clean(c.text||'',350),p=raw.split(/\s+/).filter(Boolean),first=(p[0]||'').toLowerCase();
        try {
            if(!KEY)return c.reply('❌ MOCHI_API_KEY GitHub Secret එක configure කරලා නැහැ.');
            if(!raw||first==='help'||first==='menu')return c.reply(help(c.prefix));
            if(first==='movie'||first==='movies')return search(c,p.slice(1).join(' '),'movies');
            if(first==='tv'||first==='show'||first==='tvshow')return search(c,p.slice(1).join(' '),'tvshows');
            if(first==='search')return search(c,p.slice(1).join(' '));
            const s=get(c);
            if(first==='season') {
                if(!s||s.mode!=='tv'||!s.seasons?.length)return c.reply('⚠️ මුලින් TV show එකක් open කරන්න.');
                const action=(p[1]||'').toLowerCase();
                if(action==='dl'||action==='download') {
                    const selected=Number(p[2]);
                    const index=Number.isInteger(selected)&&selected>0?selected-1:s.selectedSeason;
                    if(!Number.isInteger(index)||index<0)return c.reply('Usage: .cz season 1\nඊට පස්සේ: .cz season dl 1');
                    return downloadSeason(c,s,index);
                }
                const n=Number(p[1]);
                if(!Number.isInteger(n)||n<1||n>s.seasons.length)return c.reply('Season number එක 1-'+s.seasons.length+' අතරින් දෙන්න.');
                const season=s.seasons[n-1];
                set(c,{...s,selectedSeason:n-1});
                return c.reply('📺 *Season '+clean(season.season_no,8)+' selected*\nEpisodes: '+season.episodes.length+'\n\n⬇️ All episode links: '+c.prefix+'cz season dl '+n+'\n\nහොඳම available quality එකෙන් episodes සියල්ලටම direct links සකස් කරනවා.');
            }
            if(first==='dl'||first==='download') {const n=Number(p[1]);if(!s||!['movie','episode'].includes(s.mode))return c.reply('⚠️ Movie/Episode details open කරන්න.');if(!Number.isInteger(n)||n<1)return c.reply('Usage: .cz dl 1');return download(c,s,n-1);}
            if(first==='ep'||first==='episode') {const n=Number(p[1]);if(!s||s.mode!=='tv')return c.reply('⚠️ මුලින් TV show එකක් open කරන්න.');if(!Number.isInteger(n)||n<1||n>s.eps.length)return c.reply('Episode number එක 1-'+s.eps.length+' අතරින් දෙන්න.');return openEpisode(c,s.eps[n-1]);}
            if(first==='next'||first==='prev'||first==='previous') {if(!s||s.mode!=='episode')return c.reply('⚠️ Episode එකක් open කරන්න.');const u=first==='next'?s.data?.nav?.next_episode:s.data?.nav?.previous_episode;if(!valid(u))return c.reply('ℹ️ තවත් episode එකක් නැහැ.');return openEpisode(c,{url:u});}
            if(/^\d+$/.test(first)) {const n=Number(first);if(!s)return c.reply('⚠️ Search session expire වෙලා. නැවත search කරන්න.');if(s.mode==='search'){if(n<1||n>s.items.length)return c.reply('Result number එක 1-'+s.items.length+' අතරින් දෙන්න.');const x=s.items[n-1];return x.kind==='tv'?openTv(c,x):openMovie(c,x);}if(s.mode==='tv'){if(n<1||n>s.eps.length)return c.reply('Episode number එක 1-'+s.eps.length+' අතරින් දෙන්න.');return openEpisode(c,s.eps[n-1]);}if(s.mode==='movie'||s.mode==='episode')return download(c,s,n-1);}
            return search(c,raw,'all');
        } catch(e) {console.error('[CINESUBZ]',e?.stack||e?.message||e);return c.reply('❌ CineSubz Error\n\n'+clean(e?.message||'Unknown error',240));}
    }
};
