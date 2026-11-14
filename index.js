// ============================================================
//  GOD VOIP MD
//  Pair code (logs) → session MongoDB එකේ save • Auto call + .vcall / .acall
// ============================================================

import * as B from '@dnuzi/baileys';
import Voip from '@dnuzi/baileys/voip';
import pino from 'pino';
import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import mongoose from 'mongoose';
import express from 'express';
import { spawn } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';
import config from './config.js';
import { loadSession, sessionHash } from './session.js';
import { validateMediaFile } from './security.js';
import { getLatestCallMedia } from './media-store.js';

// ---- Safe, concise logging: never print Signal ratchet/session objects ----
const _rawLog = console.log.bind(console);
const _rawWarn = console.warn.bind(console);
const _rawError = console.error.bind(console);
const _logSeen = new Map();

function safeLog(level, args) {
    const first = args.find(v => typeof v === 'string') || '';
    const joined = args.map(v => typeof v === 'string' ? v : '').join(' ');
    const ratchetDump = /Closing session:\s*SessionEntry|Closing open session in favor of incoming prekey bundle/i.test(joined)
        || ( /Closing session:/i.test(first) && args.some(v => v && typeof v === 'object') );
    if (ratchetDump) {
        const key = 'signal-ratchet';
        const now = Date.now();
        if (now - (_logSeen.get(key) || 0) > 600000) {
            _logSeen.set(key, now);
            _rawWarn('🔐 [SECURITY] WhatsApp encryption session updated. Sensitive session data suppressed.');
        }
        return;
    }

    const badMac = /Bad MAC|Failed to decrypt message with any known session/i.test(joined);
    if (badMac) {
        const key = 'bad-mac', now = Date.now();
        if (now - (_logSeen.get(key) || 0) > 600000) {
            _logSeen.set(key, now);
            _rawWarn('⚠️ [SECURITY] A message could not be decrypted. Check linked-device session if this repeats.');
        }
        return;
    }

    const safeArgs = args.map(value => {
        if (value instanceof Error) return value.message;
        if (value && typeof value === 'object') return '[object details suppressed]';
        if (typeof value === 'string') {
            let out = value.replace(/\b\d{9,15}(?=[:@\s|)])/g, n => n.slice(0, 3) + 'xxxxxx' + n.slice(-2));
            if (process.env.GITHUB_ACTIONS) out = out.replace(/(mongodb(?:\+srv)?:\/\/)[^\s]+/gi, '$1[REDACTED]');
            return out;
        }
        return value;
    });
    (level === 'error' ? _rawError : level === 'warn' ? _rawWarn : _rawLog)(...safeArgs);
}
console.log = (...args) => safeLog('log', args);
console.warn = (...args) => safeLog('warn', args);
console.error = (...args) => safeLog('error', args);

// ================= SETTINGS =================
const { prefix, texts } = config;
const clean = (n) => String(n).replace(/[^0-9]/g, '');
const NUMBER = clean(config.number);
const OWNERS = [...new Set([NUMBER, ...config.owners.map(clean), clean(process.env.OWNER_NUMBER || '')].filter(Boolean))];
const MONGODB_URI = config.mongodbUri;
const SESSION_KEY = config.sessionKey;
const AUDIO_URL = config.audioUrl;
const VIDEO_URL = config.videoUrl;
console.log('🧩 BUILD v5 | local-tourl-media | direct-call | video-validate | vv-reupload | self-public');

// ================= BAILEYS EXPORTS =================
const pick = (name) => B[name] ?? B.default?.[name] ?? B.default?.default?.[name];

const makeWASocket =
    typeof B.default === 'function' ? B.default :
    typeof B.default?.default === 'function' ? B.default.default :
    pick('makeWASocket');

const useMultiFileAuthState = pick('useMultiFileAuthState');
const DisconnectReason = pick('DisconnectReason');
const fetchLatestBaileysVersion = pick('fetchLatestBaileysVersion');
const makeCacheableSignalKeyStore = pick('makeCacheableSignalKeyStore');

if (typeof useMultiFileAuthState !== 'function') {
    console.log('❌ Baileys exports:', Object.keys(B), Object.keys(B.default || {}));
    process.exit(1);
}

let FFPROBE = 'ffprobe';
try {
    const m = await import('ffprobe-static');
    FFPROBE = m.default?.path || m.path || 'ffprobe';
} catch {}

let FFMPEG = 'ffmpeg';
try {
    const m = await import('ffmpeg-static');
    FFMPEG = m.default || FFMPEG;
} catch {}

// make bundled ffmpeg/ffprobe visible to the voip library (it searches PATH)
for (const bin of [FFMPEG, FFPROBE]) {
    if (bin && bin.includes(path.sep)) {
        process.env.PATH = path.dirname(path.resolve(bin)) + path.delimiter + process.env.PATH;
    }
}

// ================= MESSAGE STYLES =================
const statusIcon = () => (CALL_ON ? '🟢 *ON*' : '🔴 *OFF*');

const MENU_TEXT = () =>
`📞 *${config.botName}*

*Auto Call:* ${statusIcon()}

*Auto answer*
▫️ \`${prefix}call on\` — auto call ON
▫️ \`${prefix}call off\` — auto call OFF
▫️ \`${prefix}call\` — status බලන්න

*Call යවන්න (owner)*
▫️ \`${prefix}vcall 94771234567\` — video call using latest .tourl media
▫️ \`${prefix}acall 94771234567\` — audio call using latest .tourl media
▫️ \`${prefix}tourl\` — reply to audio/video to save latest local call media
▫️ \`${prefix}self\` / \`${prefix}public\` — bot access mode
▫️ \`${prefix}call-menu\` — මේ menu එක
▫️ \`${prefix}c-ping\` — speed

*Auto answer වැඩ කරන විදිහ*
Audio call → voice file
Video call → video file

👤 *Owner:* ${config.ownerName}

${texts.footer}`;

const STATUS_TEXT = () =>
`📞 *Auto Call:* ${statusIcon()}

${CALL_ON
    ? 'එන one-to-one calls සඳහා පමණක් configured media auto play වෙනවා.'
    : 'ඔයා ON කරනකම් bot එක calls ignore කරනවා.'}

සියලු commands සඳහා \`${prefix}call-menu\` use කරන්න.

${texts.footer}`;

// ================= SETTINGS (ON/OFF) =================
// MongoDB තියෙනවා නම් එහි save වෙනවා, නැත්නම් ./data/settings.json
const Setting = mongoose.models.Setting || mongoose.model('Setting', new mongoose.Schema({
    key: { type: String, unique: true },
    value: mongoose.Schema.Types.Mixed,
}, { collection: 'settings', autoIndex: false }));
const SETTINGS_FILE = './data/settings.json';
const dbOn = () => mongoose.connection.readyState === 1;
let CALL_ON = config.autoCallDefault;
let BOT_MODE = 'self';
let ACTIVE_SOCKET = null;
const DEFAULT_CONNECT_IMAGE = 'https://file.dnuz.top/ulyg5b.png';
const DEFAULT_MENU_IMAGE = 'https://file.dnuz.top/4bo96s.jpg';
let CONNECT_IMAGE_URL = DEFAULT_CONNECT_IMAGE;
let MENU_IMAGE_URL = DEFAULT_MENU_IMAGE;

async function loadSettings() {
    try {
        if (dbOn()) {
            const st = await Setting.findOne({ key: 'autoCall' });
            if (st) CALL_ON = !!st.value;
            const mode = await Setting.findOne({ key: 'botMode' });
            if (mode?.value === 'public' || mode?.value === 'self') BOT_MODE = mode.value;
            const connectImage = await Setting.findOne({ key: 'connectImageUrl' });
            const menuImage = await Setting.findOne({ key: 'menuImageUrl' });
            CONNECT_IMAGE_URL = connectImage?.value || DEFAULT_CONNECT_IMAGE;
            MENU_IMAGE_URL = menuImage?.value || DEFAULT_MENU_IMAGE;
        } else if (fs.existsSync(SETTINGS_FILE)) {
            const j = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
            if (typeof j.autoCall === 'boolean') CALL_ON = j.autoCall;
            if (j.botMode === 'public' || j.botMode === 'self') BOT_MODE = j.botMode;
            CONNECT_IMAGE_URL = j.connectImageUrl || DEFAULT_CONNECT_IMAGE;
            MENU_IMAGE_URL = j.menuImageUrl || DEFAULT_MENU_IMAGE;
        }
    } catch {}
    await saveImageSettings();
    console.log('📞 Auto call:', CALL_ON ? 'ON' : 'OFF');
}

async function setCallOn(v) {
    CALL_ON = v;
    try {
        if (dbOn()) {
            await Setting.findOneAndUpdate({ key: 'autoCall' }, { value: v }, { upsert: true });
        } else {
            fs.mkdirSync('./data', { recursive: true });
            fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ autoCall: v, botMode: BOT_MODE }, null, 2));
        }
    } catch (e) { console.log('Settings save error:', e.message); }
}

async function saveImageSettings() {
    try {
        if (dbOn()) {
            await Promise.all([
                Setting.findOneAndUpdate({ key: 'connectImageUrl' }, { value: CONNECT_IMAGE_URL }, { upsert: true }),
                Setting.findOneAndUpdate({ key: 'menuImageUrl' }, { value: MENU_IMAGE_URL }, { upsert: true }),
            ]);
        } else {
            fs.mkdirSync('./data', { recursive: true });
            const current = fs.existsSync(SETTINGS_FILE) ? JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) : {};
            fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ ...current, connectImageUrl: CONNECT_IMAGE_URL, menuImageUrl: MENU_IMAGE_URL }, null, 2));
        }
    } catch (e) { console.log('Image settings save error:', e.message); }
}

async function setBotMode(mode) {
    BOT_MODE = mode === 'public' ? 'public' : 'self';
    try {
        if (dbOn()) await Setting.findOneAndUpdate({ key: 'botMode' }, { value: BOT_MODE }, { upsert: true });
        else {
            fs.mkdirSync('./data', { recursive: true });
            const current = fs.existsSync(SETTINGS_FILE) ? JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) : {};
            fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ ...current, botMode: BOT_MODE }, null, 2));
        }
    } catch (e) { console.log('Bot mode save error:', e.message); }
    if (ACTIVE_SOCKET) ACTIVE_SOCKET.public = BOT_MODE === 'public';
    console.log('🔐 Bot mode:', BOT_MODE);
}

// ================= MEDIA =================
const pcmCache = new Map();
const fileCache = new Map();
const endedCalls = new Set();
const waiters = new Map();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function downloadFile(url, file) {
    // A 403/401/404 is a permanent origin response, not a transient network
    // failure. Retrying it three times only spams logs and wastes call setup time.
    const candidates = [url];
    if (url.startsWith('https://github.com/') && url.includes('/raw/')) {
        candidates.push(url.replace('https://github.com/', 'https://raw.githubusercontent.com/').replace('/raw/refs/heads/', '/refs/heads/'));
    }

    let lastErr;
    for (const candidate of [...new Set(candidates)]) {
        for (let attempt = 1; attempt <= 3; attempt++) {
            let response;
            try {
                response = await fetch(candidate, {
                    redirect: 'follow',
                    // Do not send synthetic Origin/Referer or Range headers.
                    // Some object-storage/CDN hosts reject server-side hotlink headers with 403.
                    headers: {
                        'User-Agent': UA,
                        Accept: '*/*'
                    },
                    signal: AbortSignal.timeout(60000),
                });

                if ([401, 403, 404, 410].includes(response.status)) {
                    throw Object.assign(new Error(`HTTP ${response.status} - media host denied access or the link is unavailable`), { permanent: true });
                }
                if (!response.ok) {
                    throw new Error('HTTP ' + response.status);
                }

                const contentType = (response.headers.get('content-type') || '').toLowerCase();
                const data = Buffer.from(await response.arrayBuffer());
                if (!data.length) throw new Error('empty response');
                if (data.length > 250 * 1024 * 1024) throw new Error('media exceeds 250 MB limit');
                if (contentType.includes('text/html') || data.subarray(0, 100).toString('utf8').toLowerCase().includes('<!doctype html')) {
                    throw Object.assign(new Error('host returned an HTML page instead of a media file'), { permanent: true });
                }

                const tempFile = file + '.part';
                fs.writeFileSync(tempFile, data);
                fs.renameSync(tempFile, file);
                return;
            } catch (e) {
                lastErr = e;
                try { fs.rmSync(file + '.part', { force: true }); } catch {}
                const permanent = e.permanent || /HTTP (401|403|404|410)/.test(e.message) || /HTML page instead of a media file/.test(e.message);
                console.log(`⚠️ [MEDIA] Download ${permanent ? 'rejected' : 'failed'}: ${e.message}`);
                if (permanent) {
                    throw new Error(`Media URL is not publicly downloadable (${e.message}). Check that the pasted link is a direct, publicly downloadable media URL.`);
                }
                if (attempt < 3) await sleep(1200 * attempt);
            }
        }
    }
    throw new Error('Media download failed after temporary network retries: ' + (lastErr?.message || 'unknown error'));
}

async function getPcm(url) {
    if (pcmCache.has(url)) return pcmCache.get(url);
    fs.mkdirSync('./tmp', { recursive: true });

    let file;
    if (/^https?:\/\//i.test(url)) {
        file = cacheName(url);
        if (!fs.existsSync(file) || fs.statSync(file).size === 0) await downloadFile(url, file);
        console.log('⬇️ ready', fs.statSync(file).size, 'bytes');
    } else {
        file = url; // local file, e.g. './media/voice.opus'
        if (!fs.existsSync(file)) throw new Error('local file not found: ' + file);
        console.log('📁 using local file', file);
    }

    const buf = await new Promise((resolve, reject) => {
        const ff = spawn(FFMPEG, ['-v', 'error', '-i', file, '-f', 'f32le', '-ar', '16000', '-ac', '1', 'pipe:1']);
        const chunks = [];
        ff.stdout.on('data', d => chunks.push(d));
        ff.stderr.on('data', d => console.log('ffmpeg:', String(d).slice(0, 300)));
        ff.on('error', reject);
        ff.on('close', (code) => { console.log('ffmpeg exit code:', code); resolve(Buffer.concat(chunks)); });
    });

    const pcm = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
    console.log('🎧 decoded samples:', pcm.length, `(~${(pcm.length / 16000).toFixed(1)}s)`);
    fileCache.set(url, path.resolve(file));
    if (pcm.length > 0) pcmCache.set(url, pcm);
    return pcm;
}

// unique, collision-free cache file name for a URL
function cacheName(url) {
    const ext = (path.extname(new URL(url).pathname) || '.bin').slice(0, 8);
    return './tmp/media_' + crypto.createHash('sha1').update(url).digest('hex').slice(0, 16) + ext;
}

// does this file really contain a video stream?
function hasVideoStream(file) {
    return new Promise((resolve) => {
        const p = spawn(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', file]);
        let out = '';
        p.stdout.on('data', d => out += d);
        p.on('error', () => resolve(false));
        p.on('close', () => resolve(/video/.test(out)));
    });
}

// download (if URL) + for video: convert to a call-friendly local .mp4.
// Returns { file, kind } where kind is 'video' or 'audio' (decided from the REAL file content, not the URL extension).
async function prepareMedia(url, wantVideo) {
    fs.mkdirSync('./tmp', { recursive: true });
    let file;
    if (/^https?:\/\//i.test(url)) {
        file = cacheName(url);
        if (!fs.existsSync(file) || fs.statSync(file).size === 0) await downloadFile(url, file);
    } else {
        file = url;
        if (!fs.existsSync(file)) throw new Error('local file not found: ' + file);
    }
    // Validate container and stream metadata before handing media to FFmpeg/VoIP.
    const inspection = await validateMediaFile(file, { ffprobe: FFPROBE, maxBytes: 150 * 1024 * 1024, maxDurationSeconds: 900 });
    if (!wantVideo) {
        if (!inspection.hasAudio) throw new Error('Media file does not contain an audio stream.');
        return { file: path.resolve(file), kind: 'audio' };
    }

    if (!inspection.hasVideo) throw new Error('මෙම media file එකේ video stream එකක් නැහැ. .vcall සඳහා video එකක් .tourl කරන්න.');
    file = await makeCallVideo(file);
    const converted = await validateMediaFile(file, { ffprobe: FFPROBE, maxBytes: 150 * 1024 * 1024, maxDurationSeconds: 900 });
    if (!converted.hasVideo) throw new Error('FFmpeg conversion එකෙන් valid video stream එකක් ලැබුණේ නැහැ.');
    return { file: path.resolve(file), kind: 'video' };
}

// real duration of a media file in ms (0 if unknown)
function mediaDurationMs(file) {
    return new Promise((resolve) => {
        const p = spawn(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
        let out = '';
        p.stdout.on('data', d => out += d);
        p.on('error', () => resolve(0));
        p.on('close', () => { const n = parseFloat(out); resolve(isNaN(n) ? 0 : Math.ceil(n * 1000)); });
    });
}

// Options used for EVERY call we place / answer:
//  - autoDowngrade:false → never drop to audio just because the other person's camera is off (this was the "sound only" bug)
//  - autoEndCall:true, loop:false → hang up when the media finishes (no repeating)
const CALL_OPTS = { autoEndCall: true, loop: false, autoDowngrade: false };

// Logs the whole life of a call so we can see exactly where video stops (send these lines when reporting a problem)
function watchCall(call, label) {
    for (const ev of ['ringing', 'connected', 'item', 'peer_video', 'downgraded', 'playlist_ended', 'playlist_looped', 'audio_finished']) {
        call.on(ev, (info) => console.log(`🔎 [${label}] ${ev}`, info !== undefined ? JSON.stringify(info) : ''));
    }
}

// Make sure the call really ends when the media is over (library has no end-timer for video + loops audio).
// startNow=true for incoming calls (already connected); otherwise the timer starts when the other side answers.
async function armAutoHangup(call, file, label, startNow = false) {
    const ms = await mediaDurationMs(file);
    if (!ms) return;
    let timer = null;
    const start = () => {
        if (timer) return;
        timer = setTimeout(() => {
            console.log(`⏹️ ${label}: media finished → hangup`);
            call.hangup().catch(() => {});
        }, ms + 3000);
    };
    call.on('connected', start);
    call.on('ended', () => { if (timer) clearTimeout(timer); });
    if (startNow) start();
}

async function playAudioOnCall(voip, callId, url) {
    const co = voip.coordinator;
    const all = await getPcm(url);
    if (!all.length) return false;
    const file = fileCache.get(url);
    const secs = all.length / 16000;

    let done;
    const finished = new Promise(r => { done = r; });
    waiters.set(callId, done);

    // method 1: loadAudio
    try {
        await co.loadAudio(callId, file);
        console.log('▶️ loadAudio OK, playing ~' + secs.toFixed(0) + 's');
        await Promise.race([finished, sleep((secs + 3) * 1000)]);
        waiters.delete(callId);
        console.log('🎵 audio finished (loadAudio)');
        return true;
    } catch (e) {
        console.log('loadAudio error:', e.message);
    }

    // method 2: feedLiveAudio
    try { co.setExternalAudioMode?.(callId, true); console.log('externalAudioMode ON'); }
    catch (e) { console.log('setExternalAudioMode error:', e.message); }

    const FRAME = 320;
    let pos = 0, logged = false, failed = false;
    while (pos < all.length && !endedCalls.has(callId) && !failed) {
        const frame = all.slice(pos, pos + FRAME);
        pos += FRAME;
        try {
            await co.feedLiveAudio(callId, frame);
            if (!logged) { logged = true; console.log('✅ first audio frame fed'); }
        } catch (e) {
            console.log('feedLiveAudio error:', e.message);
            failed = true;
        }
        await sleep(20);
    }
    waiters.delete(callId);
    console.log('🎵 audio feed finished', failed ? '(error)' : '');
    return logged;
}

// Convert the video to a small, call-friendly version (480px, baseline H.264, low bitrate)
async function makeCallVideo(src) {
    const out = src.replace(/\.[^.]+$/, '') + '_call.mp4';
    if (fs.existsSync(out) && fs.statSync(out).size > 0) return out;
    await new Promise((resolve, reject) => {
        const ff = spawn(FFMPEG, [
            '-y', '-v', 'error', '-i', src,
            '-vf', 'scale=480:-2,fps=24',
            '-c:v', 'libx264', '-profile:v', 'baseline', '-level', '3.0', '-pix_fmt', 'yuv420p',
            '-b:v', '500k', '-maxrate', '600k', '-bufsize', '1200k', '-g', '48',
            '-c:a', 'aac', '-b:a', '64k', '-ar', '48000', '-ac', '1',
            '-movflags', '+faststart', out,
        ]);
        ff.stderr.on('data', d => console.log('ffmpeg:', String(d).slice(0, 300)));
        ff.on('error', reject);
        ff.on('close', code => code === 0 ? resolve() : reject(new Error('ffmpeg exit ' + code)));
    });
    return out;
}

async function playVideoOnCall(voip, callId, url) {
    const co = voip.coordinator;
    const pcm = await getPcm(url);
    let file = fileCache.get(url);
    if (!file) return false;
    try { file = await makeCallVideo(file); console.log('🎬 call video ready:', file); }
    catch (e) { console.log('video convert error:', e.message); }
    const secs = pcm.length ? pcm.length / 16000 : 30;

    let done;
    const finished = new Promise(r => { done = r; });
    waiters.set(callId, done);

    let ok = false;
    try {
        await co.loadVideo(callId, file);
        console.log('🎥 loadVideo OK');
        ok = true;
    } catch (e) {
        console.log('loadVideo error:', e.message);
    }
    if (ok && pcm.length) {
        try {
            await co.loadAudio(callId, file);
            console.log('🔊 loadAudio (video sound) OK');
        } catch (e) {
            console.log('loadAudio(video) error:', e.message);
        }
    }
    if (ok) {
        await Promise.race([finished, sleep((secs + 3) * 1000)]);
        console.log('🎞️ video finished');
    }
    waiters.delete(callId);
    return ok;
}

// ================= SESSION =================
const SESSION_DIR = fs.existsSync('./auth_baileys/creds.json') ? './auth_baileys' : './session';
const SESSION_SRC = path.join(SESSION_DIR, '.session.src');
const Session = mongoose.models.Session || mongoose.model('Session', new mongoose.Schema({
    sessionId: { type: String, unique: true },
    data: { type: Object, default: {} },
    src: { type: String, default: '' },
}, { minimize: false, collection: 'sessions', autoIndex: false }));
let CURRENT_SRC = '';

async function getSavedSession() {
    if (!dbOn()) return null;
    const st = await Session.findOne({ sessionId: SESSION_KEY });
    return st && st.data?.['creds.json'] ? st : null;
}

async function restoreSession(st) {
    if (!st) return false;
    fs.rmSync(SESSION_DIR, { recursive: true, force: true });
    fs.mkdirSync(SESSION_DIR, { recursive: true });
    for (const f in st.data) fs.writeFileSync(path.join(SESSION_DIR, f), st.data[f]);
    console.log('✅ Session restored from MongoDB');
    return true;
}

async function saveSession() {
    if (!dbOn() || saveInFlight) return;
    try {
        if (!fs.existsSync(SESSION_DIR)) return;
        const data = {};
        for (const f of fs.readdirSync(SESSION_DIR)) {
            const full = path.join(SESSION_DIR, f);
            if (fs.statSync(full).isFile() && f.endsWith('.json')) data[f] = fs.readFileSync(full, 'utf-8');
        }
        const digest = crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
        if (digest === lastSavedDigest) return;
        // Avoid hammering MongoDB while credentials are rotating rapidly.
        if (Date.now() - lastSaveAt < 10000) { debouncedSave(); return; }
        saveInFlight = true;
        await Session.findOneAndUpdate(
            { sessionId: SESSION_KEY },
            { $set: { data, src: CURRENT_SRC, updatedAt: new Date() } },
            { upsert: true, setDefaultsOnInsert: true }
        );
        lastSavedDigest = digest;
        lastSaveAt = Date.now();
        console.log('💾 Session saved to MongoDB');
    } catch (e) {
        console.log('Session save error:', e.message);
    } finally {
        saveInFlight = false;
    }
}

let saveTimer;
let saveInFlight = false;
let lastSavedDigest = '';
let lastSaveAt = 0;
const debouncedSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveSession, 15000);
};

async function wipeSession() {
    fs.rmSync(SESSION_DIR, { recursive: true, force: true });
    fs.rmSync(SESSION_SRC, { force: true });
    if (dbOn()) await Session.deleteOne({ sessionId: SESSION_KEY }).catch(() => {});
}

// ================= VOIP =================
const handled = new Set();      // calls already played / playing (prevents duplicates)
const accepting = new Set();
const pendingOut = new Map();   // outgoing calls waiting for the other side to answer
let VOIP = null;                // current Voip instance (set after connect)
let voipInitPromise = null;     // resolves only after Voip.listen() succeeds
let manualDialing = 0;          // .vcall / .acall වලින් යවන calls auto-handler එකෙන් ignore කරන්න

async function runPlayback(voip, sock, callId, isVideo, replyJid, mediaUrl) {
    if (handled.has(callId)) return;
    handled.add(callId);
    console.log('▶️ Peer answered; starting call media:', callId);
    try {
        let played = false;
        if (isVideo) {
            played = await playVideoOnCall(voip, callId, mediaUrl).catch(e => {
                console.log('video play error:', e.message);
                return false;
            });
        }
        if (isVideo && !played) console.log('⚠️ Video playback failed; refusing silent audio-only downgrade.');
        if (!isVideo && !played) {
            played = await playAudioOnCall(voip, callId, mediaUrl).catch(e => {
                console.log('play error:', e.message);
                return false;
            });
        }
        if (!played && sock && replyJid) {
            try { await sock.sendMessage(replyJid, { text: `${texts.fail}\\n\\n${texts.footer}` }); } catch {}
        }
        await sleep(1500);
        await voip.hangup(callId).catch(() => {});
    } finally {
        setTimeout(() => handled.delete(callId), 60000);
    }
}

// Answer incoming calls using the documented acceptCall() method and local media.
async function answerIncoming(voip, sock, callId, isVideo, replyJid) {
    if (handled.has(callId) || accepting.has(callId)) return;
    accepting.add(callId);
    try {
        const latest = getLatestCallMedia()?.file || '';
        const candidates = isVideo ? [latest, VIDEO_URL] : [latest, AUDIO_URL, VIDEO_URL].filter(Boolean);
        let prepared = null; const errors = [];
        for (const candidate of [...new Set(candidates.filter(Boolean))]) {
            try { prepared = await prepareMedia(candidate, isVideo); break; }
            catch (error) { errors.push(error.message); }
        }
        if (!prepared) throw new Error(`Incoming ${isVideo ? 'video' : 'audio'} call සඳහා සුදුසු media එකක් නැහැ. ${errors.join(' | ')}`);
        console.log(`📦 incoming ${isVideo ? 'video' : 'audio'} media ready:`, prepared.kind, prepared.file);
        await voip.acceptCall(callId);
        console.log('✅ Call accepted:', callId);
        await runPlayback(voip, sock, callId, isVideo, replyJid, prepared.file);
    } catch (e) {
        console.log('❌ Incoming call error:', e.message);
        try { await voip.rejectCall(callId); } catch {}
        try { await sock.sendMessage(replyJid, { text: `${texts.fail}\n${e.message}\n\n${texts.footer}` }); } catch {}
        setTimeout(() => handled.delete(callId), 60000);
    } finally { accepting.delete(callId); }
}

const ANSWERED_RE = /connected|active|answered|in_call|incall|established|accepted/i;

async function setupVoip(sock) {
    fs.mkdirSync('./tmp', { recursive: true });
    const voip = new Voip(sock, {
        ffprobePath: FFPROBE,
        voipLogLevel: config.voip.logLevel,
        tmpDir: './tmp',
        maxConcurrentCalls: config.voip.maxConcurrentCalls,
    });

    await voip.listen();
    VOIP = voip;
    console.log('📡 Voip listening');

    // Do not eagerly fetch config URLs: a stale/protected URL should not
    // spam HTTP 403 at every reconnect. Selected media is prepared on demand.
    console.log('🎞️ Media loader ready (on-demand; saved uploads preferred).');

    // call_incoming handles one-to-one audio/video calls and tracks outgoing calls.
    voip.on('call_incoming', async (call) => {
        const callId = call.callId;
        const from = call.peerJid;
        // Group voice calls are intentionally unsupported and must never be auto-accepted.
        if (call.groupJid || String(from || '').endsWith('@g.us')) {
            console.log('⏭️ Group call ignored (one-to-one calls only):', callId);
            try { await voip.rejectCall(callId); } catch {}
            return;
        }
        const replyJid = from;
        const isVideo = call.video === true || call.isVideo === true ||
            /video/i.test(String(call.mediaType ?? call.media ?? call.type ?? ''));
        const outgoing = String(call.direction || '').toLowerCase().includes('out');
        // Manual outgoing calls are handled by the library's native media pipeline.

        if (!CALL_ON) {
            console.log('⏸️ auto call OFF → ignore:', from);
            return;
        }

        console.log(`📞 ${outgoing ? 'OUTGOING' : 'INCOMING'} one-to-one ${isVideo ? 'video' : 'audio'} call | ${from}`);
        console.log('mediaType:', call.mediaType, '| keys:', Object.keys(call).join(','));

        if (outgoing) {
            // VOIP.call(number, localMedia, ...) owns outgoing playback.
            // Starting runPlayback() here would create a second pipeline and
            // re-fetch stale config URLs (often the source of HTTP 403 errors).
            console.log('📤 Outgoing call tracked by native media pipeline:', callId);
            return;
        }

        await answerIncoming(voip, sock, callId, isVideo, replyJid);
    });


    voip.on('call_ended', (c) => {
        console.log('📴 Call ended', c?.callId, '| reason:', c?.endReason ?? c?.reason ?? '');
        endedCalls.add(c?.callId);
        pendingOut.delete(c?.callId);
        waiters.get(c?.callId)?.();
    });
    voip.on('call_outbound_audio_finished', (c) => {
        waiters.get(c?.callId ?? c?.call?.callId)?.();
    });
    voip.on('call_error', (e) => console.log('Call error:', e?.message ?? e));

    return voip;
}

// ================= MANUAL CALLS (.vcall / .acall) =================
const isHttpUrl = (u) => /^https?:\/\/\S+$/i.test(u || '');

async function dialOut(kind, number, url) {
    const readyDeadline = Date.now() + 30000;
    while (!VOIP && Date.now() < readyDeadline) {
        if (voipInitPromise) { try { await Promise.race([voipInitPromise, sleep(1000)]); } catch {} }
        else await sleep(500);
    }
    if (!VOIP) throw new Error('Voip initialize වුණේ නැහැ. Logs වල "Voip setup error" හෝ "Voip listening" පරීක්ෂා කරන්න.');
    let source = url; let sourceLabel = 'command URL';
    if (!source) {
        const latest = getLatestCallMedia();
        if (!latest?.file) throw new Error(`Latest .tourl media එකක් නැහැ. Media එකකට reply කරලා .tourl යවන්න. ඉන්පසු .${kind === 'video' ? 'vcall' : 'acall'} NUMBER භාවිතා කරන්න.`);
        source = latest.file; sourceLabel = 'latest .tourl local media';
    }
    let prepared;
    if (isHttpUrl(source)) { console.log('[MEDIA] Checking source:', sourceLabel); prepared = await prepareMedia(source, kind === 'video'); }
    else if (fs.existsSync(source)) { console.log('[MEDIA] Checking local source:', sourceLabel); prepared = await prepareMedia(source, kind === 'video'); }
    else throw new Error('Media source එක හමු වුණේ නැහැ. නැවත .tourl යවන්න.');
    console.log('[MEDIA] Source selected:', sourceLabel);
    const size = fs.statSync(prepared.file).size;
    const limit = (kind === 'video' ? 50 : 20) * 1024 * 1024;
    if (size > limit) throw new Error(`${kind === 'video' ? 'Video' : 'Audio'} media එක ${kind === 'video' ? '50' : '20'} MB limit එක ඉක්මවා ඇත. .tourl කිරීමට පෙර file එක compress කරන්න.`);
    console.log(`📦 ${kind} call media prepared:`, prepared.kind, prepared.file, `(${(size / 1024 / 1024).toFixed(2)} MB)`);
    const media = prepared.kind === 'video' ? prepared.file : { audio: prepared.file };
    console.log(`📞 Starting outgoing ${kind} call to ${number}`);
    const call = await VOIP.call(number, media, prepared.kind === 'video' ? (config.voip.callResolution || '480p') : undefined, { ...CALL_OPTS, autoEndCall: true, loop: false });
    const callId = call?.callId ?? call?.id;
    console.log('📡 VOIP.call returned:', callId || 'no callId', '| target:', call?.target || number);
    if (!callId) throw new Error('VOIP.call() did not return a callId; inspect VOIP call_error logs.');
    watchCall(call, `manual ${kind}`);
    call.on('ringing', () => console.log(`📳 ${kind} call is ringing:`, callId));
    call.on('connected', () => console.log(`✅ ${kind} call connected:`, callId));
    call.on('ended', reason => console.log(`📴 ${kind} call ended:`, reason || ''));
    call.on('error', error => console.error(`❌ ${kind} call error:`, error?.message || error));
    return call;
}

async function handleDial(sock, m, kind, rawArgs, reply) {
    const label = kind === 'video' ? 'Video' : 'Audio';
    const cmd = kind === 'video' ? 'vcall' : 'acall';
    let number = clean(rawArgs[0] || '');
    let url = rawArgs[1];
    if (number.length < 8 || number.length > 15) {
        await reply(`❌ Number එක වැරදියි.\n\n*Use:* \`${prefix}${cmd} 94771234567 ${kind === 'video' ? 'https://site.com/video.mp4' : 'https://site.com/audio.mp3'}\`\n(country code එක්ක, "+" නැතුව)\n\n${texts.footer}`);
        return;
    }
    if (url && !isHttpUrl(url)) {
        await reply(`❌ URL එක වැරදියි. \`http://\` හෝ \`https://\` වලින් පටන් ගන්න direct link එකක් දෙන්න.\n\n${texts.footer}`);
        return;
    }

    const latest = getLatestCallMedia();
    if (!url && !latest?.file) {
        await reply(`❌ Latest .tourl media එකක් හමු වුණේ නැහැ. Audio/Video එකකට reply කරලා .tourl යවන්න. ඉන්පසු .${cmd} ${number} භාවිතා කරන්න.`);
        return;
    }
    await reply(url
        ? `📞 ${label} call එකක් *${number}* ට යවනවා...\\n🔗 Direct URL භාවිතා කරනවා.`
        : `📞 ${label} call එකක් *${number}* ට යවනවා...\\n📁 Latest .tourl local media භාවිතා කරනවා.`);
    try {
        await dialOut(kind, number, url);
        await reply(`✅ ${label} call එක ring වෙනවා → *${number}*\nAnswer කළාම media එක play වෙලා call එක auto end වෙනවා.\n\n${texts.footer}`);
    } catch (e) {
        console.log(`${cmd} error:`, e.message);
        await reply(`⚠️ ${label} call එක යවන්න බැරි වුණා:\n${e.message}\n\n${texts.footer}`);
    }
}

// ================= PLUGINS =================
// Every file in ./plugins (not starting with "_") is loaded as a command.
const PLUGINS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'plugins');
const PLUGIN_LIST = [];
const PLUGIN_MAP = new Map(); // name / alias -> plugin

async function loadPlugins() {
    if (!fs.existsSync(PLUGINS_DIR)) return;
    const files = fs.readdirSync(PLUGINS_DIR).filter(f => f.endsWith('.js') && !f.startsWith('_'));
    for (const f of files) {
        try {
            const mod = await import(pathToFileURL(path.join(PLUGINS_DIR, f)).href);
            const p = mod.default;
            if (!p?.name || typeof p.run !== 'function') {
                console.log(`⚠️ plugin skipped (needs name + run): ${f}`);
                continue;
            }
            p.name = String(p.name).toLowerCase();
            const names = [p.name, ...(p.aliases || []).map(a => String(a).toLowerCase())];
            for (const n of names) {
                if (PLUGIN_MAP.has(n)) console.log(`⚠️ plugin command "${n}" overridden by ${f}`);
                PLUGIN_MAP.set(n, p);
            }
            PLUGIN_LIST.push(p);
        } catch (e) {
            console.log(`❌ plugin load error (${f}):`, e.message);
        }
    }
    console.log(`🔌 Plugins loaded: ${PLUGIN_LIST.length} (${PLUGIN_LIST.map(p => p.name).join(', ')})`);
}

// ================= COMMANDS =================
function unwrapMessage(message) {
    let current = message || {};
    for (let i = 0; i < 5; i++) {
        const next = current.ephemeralMessage?.message ||
            current.documentWithCaptionMessage?.message ||
            current.viewOnceMessage?.message ||
            current.viewOnceMessageV2?.message;
        if (!next) break;
        current = next;
    }
    return current;
}

function extractCommandText(message) {
    const current = unwrapMessage(message);
    return current.conversation ||
        current.extendedTextMessage?.text ||
        current.imageMessage?.caption ||
        current.videoMessage?.caption ||
        current.documentMessage?.caption ||
        current.buttonsResponseMessage?.selectedButtonId ||
        current.templateButtonReplyMessage?.selectedId ||
        current.listResponseMessage?.singleSelectReply?.selectedRowId ||
        current.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson ||
        '';
}

function senderNumbers(m) {
    const key = m.key || {};
    const candidates = [
        key.participant,
        key.participantAlt,
        key.participantPn,
        key.remoteJidAlt,
        key.remoteJid,
        m.participant,
        m.participantPn,
        m.sender,
        m.senderPn,
    ];
    return [...new Set(candidates.filter(Boolean).map(value =>
        clean(String(value).split('@')[0].split(':')[0])
    ).filter(Boolean))];
}

async function handleCommand(sock, m) {
    const body = extractCommandText(m.message);
    const trimmed = String(body || '').trim();
    if (!trimmed.toLowerCase().startsWith(prefix)) return;

    // Keep URLs case-sensitive; normalize only the command name.
    const parts = trimmed.slice(prefix.length).trim().split(/\s+/);
    const name = (parts[0] || '').toLowerCase();
    const rawArgs = parts.slice(1);
    const arg = rawArgs[0]?.toLowerCase();
    const extra = rawArgs[1];
    const jid = m.key.remoteJid;
    if (!jid || jid === 'status@broadcast') return;

    const isCall = name === 'call' && !extra && (arg === undefined || arg === 'on' || arg === 'off');
    const isMenu = name === 'call-menu' && arg === undefined;
    const isPing = name === 'c-ping' && arg === undefined;
    const isVcall = name === 'vcall';
    const isAcall = name === 'acall';
    const isSelf = name === 'self';
    const isPublic = name === 'public';
    const plugin = PLUGIN_MAP.get(name);
    if (!plugin && !isCall && !isMenu && !isPing && !isVcall && !isAcall && !isSelf && !isPublic) return;

    // Group messages identify the sender via participant; newer Baileys builds
    // may expose the phone-number JID as participantAlt when the primary is an LID.
    const senders = senderNumbers(m);
    const isOwner = !!m.key.fromMe || senders.some(number => OWNERS.includes(number));

    const publicAllowed = BOT_MODE === 'public' && ((plugin && !plugin.ownerOnly) || isMenu || isPing || (isCall && arg !== 'on' && arg !== 'off'));
    const allowed = isOwner || publicAllowed;
    if (!allowed) {
        await sock.sendMessage(jid, { text: `${texts.ownerOnly}\n\n${texts.footer}` }, { quoted: m });
        return;
    }

    const reply = (t) => sock.sendMessage(jid, { text: t }, { quoted: m });

    if (isSelf || isPublic) {
        if (!isOwner) return reply(`${texts.ownerOnly}\n\n${texts.footer}`);
        await setBotMode(isSelf ? 'self' : 'public');
        return reply(`✅ Bot mode: *${BOT_MODE.toUpperCase()}*\n${BOT_MODE === 'self' ? 'Owner commands only.' : 'Public commands enabled (owner-only commands remain protected).'}\n\n${texts.footer}`);
    }

    if (isVcall || isAcall) {
        if (!isOwner) return reply(`${texts.ownerOnly}\n\n${texts.footer}`);
        await handleDial(sock, m, isVcall ? 'video' : 'audio', rawArgs, reply);
        return;
    }

    if (plugin) {
        const ctx = {
            sock, m, jid, config, prefix, isOwner,
            args: rawArgs,
            text: rawArgs.join(' '),
            reply,
            state: { callOn: CALL_ON, pluginCount: PLUGIN_LIST.length, plugins: PLUGIN_LIST, dbConnected: dbOn(), menuImageUrl: MENU_IMAGE_URL, connectImageUrl: CONNECT_IMAGE_URL },
        };
        try {
            await plugin.run(ctx);
        } catch (e) {
            console.log(`plugin error (${plugin.name}):`, e.message);
            try { await ctx.reply(`⚠️ *${prefix}${plugin.name}* error: ${e.message}`); } catch {}
        }
        return;
    }

    if (isMenu) {
        await reply(MENU_TEXT());
        return;
    }

    if (isCall) {
        if (arg === 'on') await setCallOn(true);
        if (arg === 'off') {
            await setCallOn(false);
            pendingOut.clear();
        }
        await reply(STATUS_TEXT());
        return;
    }

    if (isPing) {
        const t = Date.now();
        const sent = await sock.sendMessage(jid, { text: '🏓 Pinging...' }, { quoted: m });
        const ms = Date.now() - t;
        const result = `🏓 *Pong!*\n⚡ Speed: *${ms} ms*\n\n${texts.footer}`;
        try {
            await sock.sendMessage(jid, { text: result, edit: sent.key });
        } catch {
            await sock.sendMessage(jid, { text: result });
        }
    }
}

// ================= WEB SERVER (health check only) =================
function startServer() {
    const app = express();
    app.get('/', (req, res) => res.send(`${config.botName} is running ✅`));
    app.listen(config.port, () => console.log(`🌐 Server running on port ${config.port}`));
}

// ================= START =================
let pairRequested = false;
let pairAttempts = 0;
let reconnectTimer = null;
let starting = false;
const MAX_PAIR_CODES = 6;

async function start() {
    if (starting) return;
    starting = true;
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
    const { version } = await fetchLatestBaileysVersion();
    const logger = pino({ level: 'silent' });

    const sock = makeWASocket({
        version,
        logger,
        printQRInTerminal: false,
        browser: ['Ubuntu', 'Chrome', '20.0.04'],
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
    });

    ACTIVE_SOCKET = sock;
    sock.public = BOT_MODE === 'public';

    // Session නැත්නම් config.js එකේ number එකට pair code එක logs වල පෙන්වනවා
    if (!sock.authState.creds.registered && !pairRequested) {
        pairRequested = true;
        if (process.env.GITHUB_ACTIONS) {
            console.log('🔐 GitHub Actions: pairing code output is disabled. Add SESSION_ID as a repository secret or provide auth_baileys/creds.json in a private runtime.');
        } else {
            pairAttempts++;
            await sleep(3000);
            try {
                const code = await sock.requestPairingCode(NUMBER);
                const pretty = code?.match(/.{1,4}/g)?.join('-') || code;
                console.log('\n🔑 PAIRING CODE: ' + pretty);
                console.log('→ WhatsApp → Linked Devices → Link with phone number instead\n');
            } catch (e) {
                pairRequested = false;
                console.log('Pairing code error:', e.message);
            }
        }
    }

    sock.ev.on('creds.update', async () => {
        try { await saveCreds(); } catch (e) { console.log('Credentials write error:', e.message); }
        debouncedSave();
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        for (const m of messages || []) {
            if (!m?.message || m.key?.remoteJid === 'status@broadcast') continue;
            try {
                await handleCommand(sock, m);
            } catch (e) {
                console.log('cmd error:', e.message);
            }
        }
    });

    let voipReady = false;
    sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
        if (connection === 'open') {
            starting = false;
            if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
            pairRequested = false;
            pairAttempts = 0;
            console.log('✅ Connected: ' + sock.user?.id);
            await saveSession();
            // Send a branded connection card to the configured owner after each successful connection.
            try {
                const ownerNumber = String(config.owners?.[0] || config.number || '').replace(/[^0-9]/g, '');
                if (ownerNumber) {
                    await sock.sendMessage(ownerNumber + '@s.whatsapp.net', {
                        image: { url: CONNECT_IMAGE_URL },
                        caption: `╭━━━〔 ✦ 𝑮𝑶𝑫 𝑽𝑶𝑰𝑷 𝑴𝑫 ✦ 〕━━━╮
┃
┃  ✅ *SYSTEM CONNECTED*
┃  ━━━━━━━━━━━━━━━━━━━
┃  🤖 *Bot:* ${config.botName}
┃  📡 *Status:* 🟢 ONLINE
┃  🔐 *Mode:* ${BOT_MODE.toUpperCase()}
┃  📞 *Auto Answer:* ${CALL_ON ? '🟢 ENABLED' : '🔴 DISABLED'}
┃  🗄️ *Database:* ${dbOn() ? '🟢 MONGODB' : '🟡 LOCAL STORAGE'}
┃  📦 *Baileys:* @dnuzi/baileys v0.1.3
┃  🎧 *VOIP:* ${voipReady ? 'INITIALIZING' : 'STARTING'}
┃  ━━━━━━━━━━━━━━━━━━━
┃  ✨ *Ready for commands*
╰━━━━━━━━━━━━━━━━━━━━━━╯

> ✦ Secure • Stable • One-to-one VoIP`,
                    });
                }
            } catch (e) { console.log('Connect image message failed:', e.message); }
            if (!voipReady) {
                voipReady = true;
                voipInitPromise = setupVoip(sock).catch((e) => {
                    VOIP = null;
                    voipReady = false;
                    console.log('Voip setup error:', e.message);
                    throw e;
                });
                try { await voipInitPromise; }
                catch {}
            }
        }

        if (connection === 'close') {
            VOIP = null;
            voipInitPromise = null;
            voipReady = false;
            const code = lastDisconnect?.error?.output?.statusCode;
            if (code === DisconnectReason.loggedOut) {
                console.log('❌ Logged out. Session delete කළා - bot එක restart කළාම අලුත් pair code එකක් එයි.');
                await wipeSession();
                process.exit(1);
            }
            // pair කරන්න කලින් code එක expire වුණොත් අලුත් එකක් (උපරිම ${MAX_PAIR_CODES} වතාවක්)
            if (!sock.authState.creds.registered) {
                pairRequested = false;
                if (pairAttempts >= MAX_PAIR_CODES) {
                    console.log('❌ Pair code ' + MAX_PAIR_CODES + ' වතාවක් expire වුණා. Bot එක restart කරලා නැවත try කරන්න.');
                    process.exit(1);
                }
            }
            starting = false;
            if (!reconnectTimer) reconnectTimer = setTimeout(() => {
                reconnectTimer = null;
                start().catch(e => { starting = false; console.log('Restart error:', e.message); });
            }, 5000);
        }
    });
}

process.on('uncaughtException', (e) => console.log('Uncaught exception:', e?.message ?? e));
process.on('unhandledRejection', (e) => console.log('Unhandled rejection:', e?.message ?? e));

console.log(`🚀 ${config.botName} v${config.version}`);

if (!MONGODB_URI) {
    console.log(config.sessionId
        ? 'ℹ️ MONGODB_URI නෑ - config sessionId එකෙන් පමණක් login වෙනවා.'
        : '⚠️ MONGODB_URI නෑ - session save වෙන්නේ නෑ (restart වුණාම නැවත pair කරන්න වෙයි). config.js එකේ mongodbUri දාන්න.');
} else {
    try {
        await mongoose.connect(MONGODB_URI);
        console.log('✅ MongoDB connected');
    } catch (e) {
        console.log('❌ MongoDB connect error:', e.message);
        process.exit(1);
    }
}

if (NUMBER.length < 8) {
    console.log('❌ config.js එකේ number එක දාන්න (country code එක්ක, "+" නැතුව).');
    process.exit(1);
}

// Login order:
//  1) config.js sessionId (අලුත් එකක් නම්) → කෙලින්ම ඒකෙන් connect
//  2) MongoDB එකේ save කරපු session
//  3) pair code (logs වල)
const wantedSrc = sessionHash(config.sessionId);
const saved = await getSavedSession();
let haveSession = false;

if (config.sessionId && (!saved || saved.src !== wantedSrc)) {
    try {
        await loadSession(config.sessionId);
        CURRENT_SRC = wantedSrc;
        haveSession = true;
    } catch (e) {
        console.log('⚠️ config sessionId පාවිච්චි කරන්න බැරි වුණා:', e.message);
    }
}
if (!haveSession && saved) {
    haveSession = await restoreSession(saved);
    if (haveSession) CURRENT_SRC = saved.src || '';
}
if (!haveSession) console.log('ℹ️ Session නෑ → pair code එකක් හදනවා...');

await loadSettings();
await loadPlugins();
startServer();
start();
