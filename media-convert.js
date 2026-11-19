// ============================================================
// media-convert.js
// Turns ANY audio/video (local file or link, whatever the extension)
// into a call-friendly file:
//   audio  -> .ogg (Opus, 48 kHz mono)
//   video  -> .mp4 (H.264 baseline + AAC)
// Detection is done with ffprobe on the REAL content, never the URL.
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const TMP = path.resolve(process.env.TMP_DIR || './tmp');
const CACHE = path.join(TMP, 'media-cache');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let FFMPEG = 'ffmpeg';
let FFPROBE = 'ffprobe';
export function setBinaries({ ffmpeg, ffprobe } = {}) {
    if (ffmpeg) FFMPEG = ffmpeg;
    if (ffprobe) FFPROBE = ffprobe;
}

const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);
const isUrl = (s) => /^https?:\/\//i.test(String(s || ''));

// ---------- helpers ----------
function run(bin, args, { timeout = 300000 } = {}) {
    return new Promise((resolve, reject) => {
        const p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
        let out = '', err = '';
        const t = setTimeout(() => p.kill('SIGKILL'), timeout);
        p.stdout.on('data', d => { out += d; if (out.length > 2e6) out = out.slice(-2e6); });
        p.stderr.on('data', d => { err += d; if (err.length > 8192) err = err.slice(-8192); });
        p.on('error', e => { clearTimeout(t); reject(e); });
        p.on('close', code => {
            clearTimeout(t);
            code === 0 ? resolve(out) : reject(new Error(`${path.basename(bin)} exit ${code}: ${err.trim().slice(-300)}`));
        });
    });
}

export async function probe(file) {
    const out = await run(FFPROBE, [
        '-v', 'error', '-show_entries',
        'format=duration:stream=codec_type,codec_name,width,height',
        '-of', 'json', file,
    ], { timeout: 20000 });
    const j = JSON.parse(out || '{}');
    const streams = j.streams || [];
    // cover-art in mp3 shows up as a "video" stream - ignore attached pictures
    const video = streams.filter(s => s.codec_type === 'video' && !['mjpeg', 'png', 'bmp'].includes(s.codec_name));
    return {
        hasAudio: streams.some(s => s.codec_type === 'audio'),
        hasVideo: video.length > 0,
        duration: Number(j.format?.duration || 0) || 0,
    };
}

// ---------- download (any link, any extension) ----------
async function download(url, dest) {
    const candidates = [url];
    if (url.startsWith('https://github.com/') && url.includes('/raw/')) {
        candidates.push(url.replace('https://github.com/', 'https://raw.githubusercontent.com/').replace('/raw/refs/heads/', '/refs/heads/'));
    }
    // Google Drive / Dropbox share links -> direct links
    const gd = url.match(/drive\.google\.com\/file\/d\/([^/]+)/);
    if (gd) candidates.unshift(`https://drive.google.com/uc?export=download&id=${gd[1]}`);
    if (/dropbox\.com/.test(url)) candidates.unshift(url.replace(/[?&]dl=0/, '').replace(/(\?|$)/, '$1dl=1&').replace(/&$/, ''));

    let lastErr;
    for (const candidate of [...new Set(candidates)]) {
        let origin = ''; try { origin = new URL(candidate).origin; } catch {}
        // Some hosts answer 403 to "bot-looking" requests, so try several header sets.
        const headerSets = [
            { 'User-Agent': UA, Accept: '*/*', 'Accept-Language': 'en-US,en;q=0.9', Referer: origin + '/', Origin: origin },
            { 'User-Agent': 'curl/8.5.0', Accept: '*/*' },
            { 'User-Agent': UA, Accept: '*/*', Range: 'bytes=0-' },
            { 'User-Agent': 'Mozilla/5.0 (Linux; Android 13; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36', Accept: 'audio/*,video/*,*/*;q=0.8', Referer: origin + '/' },
            { 'User-Agent': 'WhatsApp/2.24.12.78 A', Accept: '*/*' },
        ];
        for (let h = 0; h < headerSets.length; h++) {
            try {
                const res = await fetch(candidate, {
                    redirect: 'follow',
                    headers: headerSets[h],
                    signal: AbortSignal.timeout(120000),
                });
                if (!res.ok && res.status !== 206) {
                    const e = new Error('HTTP ' + res.status);
                    if ([404, 410].includes(res.status)) e.permanent = true;
                    throw e; // 401/403/5xx -> try next header set
                }
                const ct = (res.headers.get('content-type') || '').toLowerCase();
                if (ct.includes('text/html')) throw new Error('link returned a web page, not a media file');
                const len = Number(res.headers.get('content-length') || 0);
                if (len > 250 * 1024 * 1024) throw Object.assign(new Error('file larger than 250 MB'), { permanent: true });
                const buf = Buffer.from(await res.arrayBuffer());
                if (!buf.length) throw new Error('empty response');
                if (buf.length > 250 * 1024 * 1024) throw Object.assign(new Error('file larger than 250 MB'), { permanent: true });
                fs.writeFileSync(dest + '.part', buf);
                fs.renameSync(dest + '.part', dest);
                return;
            } catch (e) {
                lastErr = e;
                try { fs.rmSync(dest + '.part', { force: true }); } catch {}
                if (e.permanent) break;
                await sleep(300);
            }
        }
    }
    const msg = lastErr?.message || 'unknown error';
    throw new Error('Download failed: ' + msg + (/403|401/.test(msg) ? ' — link එක server එකෙන් block කරනවා. Media එකට reply කරලා .tourl යවලා, ඉන්පසු link නැතුව .vcall <number> කරන්න.' : ''));
}

// ---------- converters ----------
async function toOgg(src, out) {
    await run(FFMPEG, [
        '-y', '-v', 'error', '-i', src,
        '-vn', '-map', '0:a:0',
        '-c:a', 'libopus', '-b:a', '64k', '-ar', '48000', '-ac', '1',
        '-application', 'voip', out,
    ]);
}

async function toCallMp4(src, out, hasAudio) {
    const args = [
        '-y', '-v', 'error', '-i', src,
        '-map', '0:v:0',
        '-vf', 'scale=480:-2:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=24',
        '-c:v', 'libx264', '-profile:v', 'baseline', '-level', '3.0', '-pix_fmt', 'yuv420p',
        '-preset', 'veryfast', '-b:v', '500k', '-maxrate', '600k', '-bufsize', '1200k', '-g', '48',
    ];
    if (hasAudio) args.push('-map', '0:a:0', '-c:a', 'aac', '-b:a', '64k', '-ar', '48000', '-ac', '1');
    else args.push('-an');
    args.push('-movflags', '+faststart', out);
    await run(FFMPEG, args, { timeout: 600000 });
}

const inflight = new Map(); // de-dupe concurrent prep of the same source

/**
 * prepare(source, { wantVideo, maxSeconds })
 *  source : URL or local path (any extension)
 *  returns: { file, kind: 'audio'|'video', duration, ogg }
 *     audio  => always an .ogg file (Opus)
 *     video  => always an .mp4 (H.264 baseline); `ogg` is the extracted audio track
 */
export function prepare(source, opts = {}) {
    const key = `${source}|${opts.wantVideo ? 'v' : 'a'}`;
    if (inflight.has(key)) return inflight.get(key);
    const p = doPrepare(source, opts).finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
}

async function doPrepare(source, { wantVideo = false, maxSeconds = 900 } = {}) {
    fs.mkdirSync(CACHE, { recursive: true });
    source = String(source).trim();
    const id = hash(source);
    const tag = wantVideo ? 'v' : 'a';
    const outFile = path.join(CACHE, `${id}_${tag}${wantVideo ? '.mp4' : '.ogg'}`);

    // cached conversion
    if (fs.existsSync(outFile) && fs.statSync(outFile).size > 0) {
        const info = await probe(outFile).catch(() => null);
        if (info && (wantVideo ? info.hasVideo : info.hasAudio)) {
            return { file: outFile, kind: wantVideo ? 'video' : 'audio', duration: info.duration, ogg: wantVideo ? await extractOgg(outFile, id) : outFile };
        }
    }

    // get the raw file (extension irrelevant)
    let raw;
    if (isUrl(source)) {
        raw = path.join(CACHE, `${id}.src`);
        if (!fs.existsSync(raw) || fs.statSync(raw).size === 0) await download(source, raw);
    } else {
        raw = path.resolve(source);
        if (!fs.existsSync(raw)) throw new Error('local file not found: ' + source);
    }

    let info;
    try { info = await probe(raw); }
    catch (e) { throw new Error('Not a valid audio/video file (' + e.message.slice(0, 120) + ')'); }
    if (info.duration > maxSeconds) throw new Error(`Media is longer than ${Math.round(maxSeconds / 60)} minutes.`);

    if (wantVideo) {
        if (!info.hasVideo) throw new Error('This link/file has no video stream - use an audio call instead.');
        await toCallMp4(raw, outFile, info.hasAudio);
        const ogg = await extractOgg(outFile, id);
        const out = await probe(outFile);
        return { file: outFile, kind: 'video', duration: out.duration || info.duration, ogg };
    }

    if (!info.hasAudio) throw new Error('This link/file has no audio stream.');
    await toOgg(raw, outFile);
    const out = await probe(outFile);
    return { file: outFile, kind: 'audio', duration: out.duration || info.duration, ogg: outFile };
}

async function extractOgg(mp4, id) {
    const ogg = path.join(CACHE, `${id}_vaudio.ogg`);
    if (fs.existsSync(ogg) && fs.statSync(ogg).size > 0) return ogg;
    try {
        const info = await probe(mp4);
        if (!info.hasAudio) return null;
        await toOgg(mp4, ogg);
        return ogg;
    } catch { return null; }
}

// keep the cache from growing forever (called on start)
export function cleanCache(maxAgeMs = 6 * 3600 * 1000) {
    try {
        for (const f of fs.readdirSync(CACHE)) {
            const full = path.join(CACHE, f);
            if (Date.now() - fs.statSync(full).mtimeMs > maxAgeMs) fs.rmSync(full, { force: true });
        }
    } catch {}
}
