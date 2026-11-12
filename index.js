// ============================================================
//  GOD VOIP MD
//  Pair code (logs) → session MongoDB එකේ save • Auto call + .vcall / .acall
// ============================================================

import * as B from '@dnuzi/baileys';
import Voip from '@dnuzi/baileys/voip';
import pino from 'pino';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import express from 'express';
import { spawn } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';
import config from './config.js';
import { loadSession, sessionHash } from './session.js';

// ---- GitHub Actions: logs වල phone numbers hide කරනවා ----
if (process.env.GITHUB_ACTIONS) {
    const orig = console.log;
    console.log = (...a) => orig(...a.map(x => typeof x === 'string'
        ? x.replace(/\d{9,15}(?=[:@\s|)])/g, n => n.slice(0, 3) + 'xxxxxx' + n.slice(-2))
        : x));
}

// ================= SETTINGS =================
const { prefix, texts } = config;
const clean = (n) => String(n).replace(/[^0-9]/g, '');
const NUMBER = clean(config.number);
const OWNERS = [NUMBER, ...config.owners.map(clean)];
const MONGODB_URI = config.mongodbUri;
const SESSION_KEY = config.sessionKey;
const AUDIO_URL = config.audioUrl;
const VIDEO_URL = config.videoUrl;

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
▫️ \`${prefix}vcall 94771234567 https://site.com/video.mp4\` — video call
▫️ \`${prefix}acall 94771234567 https://site.com/audio.mp3\` — audio call
▫️ URL එක දාන්නේ නැත්නම් config.js එකේ default media එක යනවා

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
    ? 'එන calls, group calls සහ answer කරපු outgoing calls වලට media එක auto play වෙනවා.'
    : 'ඔයා ON කරනකම් bot එක calls ignore කරනවා.'}

සියලු commands සඳහා \`${prefix}call-menu\` use කරන්න.

${texts.footer}`;

// ================= SETTINGS (ON/OFF) =================
// MongoDB තියෙනවා නම් එහි save වෙනවා, නැත්නම් ./data/settings.json
const Setting = mongoose.model('Setting', new mongoose.Schema({
    key: { type: String, unique: true },
    value: mongoose.Schema.Types.Mixed,
}));
const SETTINGS_FILE = './data/settings.json';
const dbOn = () => mongoose.connection.readyState === 1;
let CALL_ON = config.autoCallDefault;

async function loadSettings() {
    try {
        if (dbOn()) {
            const st = await Setting.findOne({ key: 'autoCall' });
            if (st) CALL_ON = !!st.value;
        } else if (fs.existsSync(SETTINGS_FILE)) {
            const j = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
            if (typeof j.autoCall === 'boolean') CALL_ON = j.autoCall;
        }
    } catch {}
    console.log('📞 Auto call:', CALL_ON ? 'ON' : 'OFF');
}

async function setCallOn(v) {
    CALL_ON = v;
    try {
        if (dbOn()) {
            await Setting.findOneAndUpdate({ key: 'autoCall' }, { value: v }, { upsert: true });
        } else {
            fs.mkdirSync('./data', { recursive: true });
            fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ autoCall: v }));
        }
    } catch (e) { console.log('Settings save error:', e.message); }
}

// ================= MEDIA =================
const pcmCache = new Map();
const fileCache = new Map();
const endedCalls = new Set();
const waiters = new Map();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function downloadFile(url, file) {
    // also try the direct raw.githubusercontent.com link (skips one redirect)
    const direct = url.startsWith('https://github.com/')
        ? url.replace('https://github.com/', 'https://raw.githubusercontent.com/').replace('/raw/refs/heads/', '/refs/heads/')
        : url;

    let lastErr;
    for (const u of new Set([url, direct])) {
        for (let i = 1; i <= 3; i++) {
            try {
                const res = await fetch(u, { redirect: 'follow', headers: { 'User-Agent': UA, Accept: '*/*' } });
                if (!res.ok) throw new Error('HTTP ' + res.status);
                fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
                return;
            } catch (e) {
                lastErr = e;
                console.log(`⚠️ download try ${i} failed (${u.slice(0, 60)}...): ${e.message}`);
                await sleep(1500 * i);
            }
        }
    }
    throw new Error('download failed: ' + lastErr.message);
}

async function getPcm(url) {
    if (pcmCache.has(url)) return pcmCache.get(url);
    fs.mkdirSync('./tmp', { recursive: true });

    let file;
    if (/^https?:\/\//i.test(url)) {
        file = './tmp/media_' + Buffer.from(url).toString('hex').slice(-16) + (path.extname(new URL(url).pathname) || '.bin');
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
const SESSION_DIR = './session';
const SESSION_SRC = './session.src';
const Session = mongoose.model('Session', new mongoose.Schema({
    sessionId: { type: String, unique: true },
    data: { type: Object, default: {} },
    src: { type: String, default: '' },   // config sessionId එකේ hash (වෙනස් වුණාද බලන්න)
}, { minimize: false }));
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
    if (!dbOn()) return;
    try {
        if (!fs.existsSync(SESSION_DIR)) return;
        const data = {};
        for (const f of fs.readdirSync(SESSION_DIR)) {
            data[f] = fs.readFileSync(path.join(SESSION_DIR, f), 'utf-8');
        }
        await Session.findOneAndUpdate({ sessionId: SESSION_KEY }, { data, src: CURRENT_SRC }, { upsert: true });
        console.log('💾 Session saved to MongoDB');
    } catch (e) {
        console.log('Session save error:', e.message);
    }
}

let saveTimer;
const debouncedSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveSession, 5000);
};

async function wipeSession() {
    fs.rmSync(SESSION_DIR, { recursive: true, force: true });
    fs.rmSync(SESSION_SRC, { force: true });
    if (dbOn()) await Session.deleteOne({ sessionId: SESSION_KEY }).catch(() => {});
}

// ================= VOIP =================
const handled = new Set();      // calls already played / playing (prevents duplicates)
const pendingOut = new Map();   // outgoing calls waiting for the other side to answer
let VOIP = null;                // current Voip instance (set after connect)
let manualDialing = 0;          // .vcall / .acall වලින් යවන calls auto-handler එකෙන් ignore කරන්න

async function runPlayback(voip, sock, callId, isVideo, replyJid) {
    if (handled.has(callId)) return;
    handled.add(callId);
    try {
        let played = false;
        if (isVideo) {
            played = await playVideoOnCall(voip, callId, VIDEO_URL).catch(e => {
                console.log('video play error:', e.message);
                return false;
            });
        }
        if (isVideo && !played) console.log('⚠️ video failed → falling back to audio');
        if (!played) {
            played = await playAudioOnCall(voip, callId, AUDIO_URL).catch(e => {
                console.log('play error:', e.message);
                return false;
            });
        }
        if (!played) {
            // fallback: use the sound of the video file if the audio file failed
            played = await playAudioOnCall(voip, callId, VIDEO_URL).catch(() => false);
        }
        if (!played) {
            try { await sock.sendMessage(replyJid, { text: `${texts.fail}\n\n${texts.footer}` }); } catch {}
        }
        await sleep(1500);
        await voip.hangup(callId).catch(() => {});
    } finally {
        setTimeout(() => handled.delete(callId), 60000);
    }
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

    try { await getPcm(AUDIO_URL); } catch (e) { console.log('❌ preload audio error:', e.message); }
    try { await getPcm(VIDEO_URL); await makeCallVideo(fileCache.get(VIDEO_URL)); }
    catch (e) { console.log('❌ preload video error:', e.message); }

    await voip.listen();
    VOIP = voip;
    console.log('📡 Voip listening');

    // call_incoming covers:
    // 1) a normal audio/video call
    // 2) the bot being added to a group call
    // 3) your own outgoing call (waits until the other side answers)
    voip.on('call_incoming', async (call) => {
        const callId = call.callId;
        const from = call.peerJid;
        const groupJid = call.groupJid || (String(from).endsWith('@g.us') ? from : null);
        const replyJid = groupJid || from;
        const isVideo = call.video === true || call.isVideo === true ||
            /video/i.test(String(call.mediaType ?? call.media ?? call.type ?? ''));
        const outgoing = String(call.direction || '').toLowerCase().includes('out');
        if (outgoing && manualDialing > 0) return; // .vcall / .acall call එකක්

        if (!CALL_ON) {
            console.log('⏸️ auto call OFF → ignore:', from);
            return;
        }

        console.log(`📞 ${outgoing ? 'OUTGOING' : 'INCOMING'} ${groupJid ? 'GROUP ' : ''}${isVideo ? 'video' : 'audio'} call | ${from}`);
        console.log('mediaType:', call.mediaType, '| keys:', Object.keys(call).join(','));

        if (outgoing) {
            pendingOut.set(callId, { isVideo, replyJid });
            return;
        }

        try {
            await voip.acceptCall(callId);
            console.log('✅ Call accepted:', callId);
            await runPlayback(voip, sock, callId, isVideo, replyJid);
        } catch (e) {
            console.log('❌ Accept error:', e.message);
            try { await voip.rejectCall(callId); } catch {}
            try { await sock.sendMessage(replyJid, { text: `${texts.fail}\n\n${texts.footer}` }); } catch {}
        }
    });

    const onAnswered = (c, raw) => {
        const id = c?.callId ?? c?.call?.callId;
        const info = pendingOut.get(id);
        if (!CALL_ON || !info) return;
        console.log('📲 Answered by peer:', id, raw ? '(' + raw.slice(0, 80) + ')' : '');
        pendingOut.delete(id);
        runPlayback(voip, sock, id, info.isVideo, info.replyJid);
    };

    voip.on('call_state', (c) => {
        const s = JSON.stringify(c?.state ?? c?.stateData ?? c) || '';
        if (ANSWERED_RE.test(s)) onAnswered(c, s);
    });
    voip.on('call_answered', (c) => onAnswered(c, 'call_answered'));
    voip.on('call_connected', (c) => onAnswered(c, 'call_connected'));
    voip.on('call_accepted', (c) => onAnswered(c, 'call_accepted'));

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
    if (!VOIP) throw new Error('Voip තාම ready නෑ. තත්පර කිහිපයකින් නැවත try කරන්න.');
    const media = url || (kind === 'video' ? VIDEO_URL : AUDIO_URL);
    manualDialing++;
    let call;
    try {
        // video call → video file එක | audio call → audio file එක. ඉවර වුණාම auto hangup
        call = await VOIP.call(
            number,
            media,
            kind === 'video' ? (config.voip.callResolution || '480p') : undefined,
            { autoEndCall: true, loop: false },
        );
    } finally {
        setTimeout(() => { manualDialing = Math.max(0, manualDialing - 1); }, 15000);
    }
    call.on('error', (e) => console.log(`Manual ${kind} call error:`, e?.message ?? e));
    call.on('ended', (r) => console.log(`📴 Manual ${kind} call ended:`, r ?? ''));
    return call;
}

async function handleDial(sock, m, kind, rawArgs, reply) {
    const label = kind === 'video' ? 'Video' : 'Audio';
    const cmd = kind === 'video' ? 'vcall' : 'acall';
    const number = clean(rawArgs[0] || '');
    const url = rawArgs[1];

    if (number.length < 8 || number.length > 15) {
        await reply(`❌ Number එක වැරදියි.\n\n*Use:* \`${prefix}${cmd} 94771234567 ${kind === 'video' ? 'https://site.com/video.mp4' : 'https://site.com/audio.mp3'}\`\n(country code එක්ක, "+" නැතුව)\n\n${texts.footer}`);
        return;
    }
    if (url && !isHttpUrl(url)) {
        await reply(`❌ URL එක වැරදියි. \`http://\` හෝ \`https://\` වලින් පටන් ගන්න direct link එකක් දෙන්න.\n\n${texts.footer}`);
        return;
    }

    await reply(`📞 ${label} call එකක් *${number}* ට යවනවා...\n🔗 ${url || '(default media)'}`);
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
async function handleCommand(sock, m) {
    const body =
        m.message.conversation ||
        m.message.extendedTextMessage?.text ||
        m.message.imageMessage?.caption || '';
    const trimmed = body.trim();
    if (!trimmed.toLowerCase().startsWith(prefix)) return;

    // URL case-sensitive නිසා name විතරක් lowercase කරනවා
    const parts = trimmed.slice(prefix.length).split(/\s+/);
    const name = (parts[0] || '').toLowerCase();
    const rawArgs = parts.slice(1);
    const arg = rawArgs[0]?.toLowerCase();
    const extra = rawArgs[1];
    const jid = m.key.remoteJid;

    const isCall = name === 'call' && !extra && (arg === undefined || arg === 'on' || arg === 'off');
    const isMenu = name === 'call-menu' && arg === undefined;
    const isPing = name === 'c-ping' && arg === undefined;
    const isVcall = name === 'vcall';
    const isAcall = name === 'acall';
    const plugin = PLUGIN_MAP.get(name);
    if (!plugin && !isCall && !isMenu && !isPing && !isVcall && !isAcall) return;

    const sender = (m.key.participant || jid).split('@')[0].split(':')[0];
    const isOwner = m.key.fromMe || OWNERS.includes(sender);

    // plugins public කරන්න පුළුවන් (plugin.ownerOnly = false AND config.publicCommands = true)
    const allowed = isOwner || (plugin && !plugin.ownerOnly && config.publicCommands);
    if (!allowed) {
        await sock.sendMessage(jid, { text: `${texts.ownerOnly}\n\n${texts.footer}` }, { quoted: m });
        return;
    }

    const reply = (t) => sock.sendMessage(jid, { text: t }, { quoted: m });

    if (isVcall || isAcall) {
        await handleDial(sock, m, isVcall ? 'video' : 'audio', rawArgs, reply);
        return;
    }

    if (plugin) {
        const ctx = {
            sock, m, jid, config, prefix, isOwner,
            args: rawArgs,
            text: rawArgs.join(' '),
            reply,
            state: { callOn: CALL_ON, pluginCount: PLUGIN_LIST.length, plugins: PLUGIN_LIST },
        };
        try {
            await plugin.run(ctx);
        } catch (e) {
            console.log(`plugin error (${plugin.name}):`, e.message);
            try { await ctx.reply(`⚠️ *${prefix}${plugin.name}* එකේ error එකක්: ${e.message}`); } catch {}
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
const MAX_PAIR_CODES = 6;

async function start() {
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

    // Session නැත්නම් config.js එකේ number එකට pair code එක logs වල පෙන්වනවා
    if (!sock.authState.creds.registered && !pairRequested) {
        pairRequested = true;
        pairAttempts++;
        await sleep(3000);
        try {
            const code = await sock.requestPairingCode(NUMBER);
            const pretty = code?.match(/.{1,4}/g)?.join('-') || code;
            console.log('\n🔑 PAIRING CODE: ' + pretty);
            console.log('→ WhatsApp → Linked Devices → Link a device → Link with phone number instead\n');
        } catch (e) {
            pairRequested = false;
            console.log('Pairing code error:', e.message);
        }
    }

    sock.ev.on('creds.update', async () => {
        await saveCreds();
        debouncedSave();
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m?.message || m.key.remoteJid === 'status@broadcast') return;
        try {
            await handleCommand(sock, m);
        } catch (e) {
            console.log('cmd error:', e.message);
        }
    });

    let voipReady = false;
    sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
        if (connection === 'open') {
            pairRequested = false;
            pairAttempts = 0;
            console.log('✅ Connected: ' + sock.user?.id);
            await saveSession();
            if (!voipReady) {
                voipReady = true;
                try { await setupVoip(sock); }
                catch (e) { console.log('Voip setup error:', e.message); }
            }
        }

        if (connection === 'close') {
            VOIP = null;
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
            console.log('🔄 Reconnecting...');
            setTimeout(start, 3000);
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
