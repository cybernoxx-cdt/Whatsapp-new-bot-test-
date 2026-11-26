// ============================================================
//  GOD VOIP MD
//  Pair code (logs) → session MongoDB එකේ save • Auto call + .vcall / .acall (multi-call, auto convert)
// ============================================================

import * as B from '@dnuzi/baileys';
import Voip from '@dnuzi/baileys/voip';
import fs from 'fs';
import crypto from 'crypto';
import sharp from 'sharp';
import path from 'path';
import mongoose from 'mongoose';
import express from 'express';
import { spawn } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';
import config from './config.js';
import { loadSession, sessionHash, validateSessionDir, encryptSessionData, decryptSessionData } from './session.js';
import { unwrapMessage } from './lib/unwrap.js';
import { downloadToFile } from './lib/download.js';
import { MAX_PCM_CACHE_ENTRIES, MAX_FILE_CACHE_ENTRIES, MSG_CACHE_MAX, PRE_DECODE_DEADLINE_MS, VOIP_SLOT_TIMEOUT_MS } from './lib/constants.js';
import { validateMediaFile } from './security.js';
import { getLatestCallMedia } from './media-store.js';
import { sendMenuMedia } from './lib/menu-media.js';
import { prepare as prepareConverted, setBinaries, cleanCache } from './media-convert.js';

// ---- Safe, concise logging: never print Signal ratchet/session objects ----
const _rawLog = console.log.bind(console);
const _rawWarn = console.warn.bind(console);
const _rawError = console.error.bind(console);
const _logSeen = new Map();

function safeLog(level, args) {
    const first = args.find(v => typeof v === 'string') || '';
    const joined = args.map(v => typeof v === 'string' ? v : '').join(' ');
    // Baileys may print full Signal SessionEntry objects while pruning old sessions.
    // These objects contain ratchet keys and must never reach Actions logs.
    const ratchetDump = /(?:Closing|Removing)(?: old closed)? session:\s*SessionEntry|Closing open session in favor of incoming prekey bundle/i.test(joined)
        || (/(?:Closing|Removing)(?: old closed)? session:/i.test(first) && args.some(v => v && typeof v === 'object'));
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
            // Redact secrets unconditionally (S10), not only in GitHub Actions.
            let out = value.replace(/(mongodb(?:\+srv)?:\/\/)[^\s'"]+/gi, '$1[REDACTED]');
            out = out.replace(/\b(SESSION_ID\w*|MONGODB_URI|[A-Z_]*API_KEY)\s*=\s*[^\s'"]+/g, '$1=[REDACTED]');
            out = out.replace(/\b\d{8,15}\b/g, n => n.slice(0, 3) + 'xxxxxx' + n.slice(-2));
            return out;
        }
        return value;
    });
    (level === 'error' ? _rawError : level === 'warn' ? _rawWarn : _rawLog)(...safeArgs);
}
console.log = (...args) => safeLog('log', args);
console.info = (...args) => safeLog('log', args);
console.debug = (...args) => safeLog('log', args);
console.warn = (...args) => safeLog('warn', args);
console.error = (...args) => safeLog('error', args);

// ================= SETTINGS =================
const { prefix, texts } = config;
// Concurrent call limit: CALL_LIMIT env > config.voip.maxConcurrentCalls (default 10, hard cap 50)
const configuredCallLimit = Number(process.env.CALL_LIMIT || config.voip?.maxConcurrentCalls || 10);
const MAX_CONCURRENT_CALLS = Math.min(50, Math.max(1, Math.floor(configuredCallLimit) || 1));
const clean = (n) => String(n).replace(/[^0-9]/g, '');
const NUMBER = clean(config.number);
const OWNERS = [...new Set([NUMBER, ...config.owners.map(clean), clean(process.env.OWNER_NUMBER || '')].filter(Boolean))];
const MONGODB_URI = config.mongodbUri;
const SESSION_KEY = config.sessionKey;
const AUDIO_URL = String(config.audioUrl || '').trim();
const VIDEO_URL = String(config.videoUrl || '').trim();
const SESSION_LABEL = process.env.SESSION_INDEX ? `[Session ${process.env.SESSION_INDEX}]` : '[Session 1]';
console.log(`${SESSION_LABEL} 🧩 GOD VOIP MD starting`);

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

setBinaries({ ffmpeg: FFMPEG, ffprobe: FFPROBE });
cleanCache();

// ================= GLOBAL ANIMATED STICKER REACTIONS =================
// 32 original animated WebP reactions from Fah Swe Tools.
// Free collection licence permits use in chats/social posts; source credit is appreciated.
// Stickers are resized onto a 512x512 transparent canvas so the visible artwork is smaller.
const REACTION_STICKERS = {
    'mishu-thank-you': 'https://fahswetools.com/emoji3d/originals/mishu-thank-you.webp?v=de8ebb5129',
    'mishu-sorry': 'https://fahswetools.com/emoji3d/originals/mishu-sorry.webp?v=2d685f7b12',
    'mishu-angry': 'https://fahswetools.com/emoji3d/originals/mishu-angry.webp?v=caaa918063',
    'mishu-shocked': 'https://fahswetools.com/emoji3d/originals/mishu-shocked.webp?v=4325e8ea4d',
    'mishu-thinking': 'https://fahswetools.com/emoji3d/originals/mishu-thinking.webp?v=4403d3edb8',
    'mishu-dance': 'https://fahswetools.com/emoji3d/originals/mishu-dance.webp?v=4acc7d49a5',
    'mishu-cool': 'https://fahswetools.com/emoji3d/originals/mishu-cool.webp?v=10153f9ccd',
    'mishu-shy': 'https://fahswetools.com/emoji3d/originals/mishu-shy.webp?v=6d5dc89e08',
    'mishu-tea-time': 'https://fahswetools.com/emoji3d/originals/mishu-tea-time.webp?v=bf1404325a',
    'mishu-yes-ok': 'https://fahswetools.com/emoji3d/originals/mishu-yes-ok.webp?v=8a611a4d06',
    'mishu-low-battery': 'https://fahswetools.com/emoji3d/originals/mishu-low-battery.webp?v=76f84992b7',
    'mishu-running-late': 'https://fahswetools.com/emoji3d/originals/mishu-running-late.webp?v=5cb11644c1',
    'mishu-trophy': 'https://fahswetools.com/emoji3d/originals/mishu-trophy.webp?v=e2ae97e3c5',
    'pakhi-hello': 'https://fahswetools.com/emoji3d/originals/pakhi-hello.webp?v=96b70e8ed0',
    'pakhi-love-letter': 'https://fahswetools.com/emoji3d/originals/pakhi-love-letter.webp?v=99552a5a17',
    'pakhi-bye': 'https://fahswetools.com/emoji3d/originals/pakhi-bye.webp?v=d5614ab858',
    'pakhi-get-well': 'https://fahswetools.com/emoji3d/originals/pakhi-get-well.webp?v=7ae5f4ca90',
    'pakhi-rainy-day': 'https://fahswetools.com/emoji3d/originals/pakhi-rainy-day.webp?v=340e282225',
    'pakhi-cheer': 'https://fahswetools.com/emoji3d/originals/pakhi-cheer.webp?v=38a0694963',
    'pakhi-singing': 'https://fahswetools.com/emoji3d/originals/pakhi-singing.webp?v=f779621a3a',
    'pakhi-flying': 'https://fahswetools.com/emoji3d/originals/pakhi-flying.webp?v=f211f4706b',
    'rumi-love-you': 'https://fahswetools.com/emoji3d/originals/rumi-love-you.webp?v=9b9791591a',
    'rumi-shy-kiss': 'https://fahswetools.com/emoji3d/originals/rumi-shy-kiss.webp?v=53dc3046ef',
    'rumi-thank-you': 'https://fahswetools.com/emoji3d/originals/rumi-thank-you.webp?v=9efdea444c',
    'rumi-yay': 'https://fahswetools.com/emoji3d/originals/rumi-yay.webp?v=3ac71e85f9',
    'rumi-birthday-horn': 'https://fahswetools.com/emoji3d/originals/rumi-birthday-horn.webp?v=8d01164e1b',
    'pakhi-phone-call': 'https://fahswetools.com/emoji3d/originals/pakhi-phone-call.webp?v=c86d2d311e',
    'pakhi-dance': 'https://fahswetools.com/emoji3d/originals/pakhi-dance.webp?v=567f37c33b',
    'rumi-giggle': 'https://fahswetools.com/emoji3d/originals/rumi-giggle.webp?v=5e13a7262e',
    'rumi-hop-dance': 'https://fahswetools.com/emoji3d/originals/rumi-hop-dance.webp?v=e12a2bcf65',
    'pakhi-lol': 'https://fahswetools.com/emoji3d/originals/pakhi-lol.webp?v=8e5fd01c7b',
    'mishu-kisses': 'https://fahswetools.com/emoji3d/originals/mishu-kisses.webp?v=96d24cd8e3',
};

const REACTION_GROUPS = {
    search: ['mishu-thinking', 'mishu-shocked', 'mishu-tea-time'],
    call: ['pakhi-phone-call', 'mishu-running-late', 'pakhi-hello'],
    love: ['rumi-love-you', 'rumi-shy-kiss', 'mishu-kisses', 'pakhi-love-letter', 'mishu-shy'],
    laugh: ['pakhi-lol', 'rumi-giggle', 'mishu-dance', 'pakhi-dance', 'rumi-hop-dance'],
    success: ['mishu-yes-ok', 'mishu-trophy', 'pakhi-cheer', 'rumi-yay'],
    sorry: ['mishu-sorry', 'pakhi-get-well', 'pakhi-rainy-day'],
    thanks: ['mishu-thank-you', 'rumi-thank-you'],
    greeting: ['pakhi-hello', 'pakhi-bye', 'pakhi-singing', 'pakhi-flying'],
    general: Object.keys(REACTION_STICKERS),
};

const reactionStickerCache = new Map();
const reactionStickerInflight = new Map();
const reactionMessageCache = new Map(); // already-uploaded encrypted sticker payloads
const lastReactionStickerByChat = new Map();

function getReactionGroup(commandName = '') {
    const command = String(commandName || '').toLowerCase();
    if (/(search|find|movie|cinesubz|modapk|modgame|oldgame|pinterest|download|yt|apk|game)/.test(command)) return 'search';
    if (/(call|voip|dial|phone|vcall|acall)/.test(command)) return 'call';
    if (/(love|heart|kiss|couple)/.test(command)) return 'love';
    if (/(laugh|fun|joke|meme)/.test(command)) return 'laugh';
    if (/(alive|hello|menu|greet|bye)/.test(command)) return 'greeting';
    if (/(thanks|thank)/.test(command)) return 'thanks';
    if (/(sorry|error|fail|invalid|wrong)/.test(command)) return 'sorry';
    if (/(success|done|check|ping|info|status|owner|restart|privacy|mode)/.test(command)) return 'success';
    return 'general';
}

function chooseReactionSticker(jid, commandName) {
    const group = getReactionGroup(commandName);
    const pool = REACTION_GROUPS[group] || REACTION_GROUPS.general;
    const previous = lastReactionStickerByChat.get(jid);
    const available = pool.filter(id => id !== previous);
    const selected = available[crypto.randomInt(0, available.length)] || pool[0];
    lastReactionStickerByChat.set(jid, selected);
    if (lastReactionStickerByChat.size > 1000) {
        lastReactionStickerByChat.delete(lastReactionStickerByChat.keys().next().value);
    }
    return { id: selected, url: REACTION_STICKERS[selected] };
}

async function getReactionStickerBuffer(url) {
    if (reactionStickerCache.has(url)) return reactionStickerCache.get(url);
    if (reactionStickerInflight.has(url)) return reactionStickerInflight.get(url);

    const pending = (async () => {
        const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error(`Reaction sticker download failed: HTTP ${response.status}`);

        const contentType = (response.headers.get('content-type') || '').toLowerCase();
        if (contentType && !contentType.includes('image/webp')) {
            throw new Error('Reaction sticker source did not return WebP');
        }

        const source = Buffer.from(await response.arrayBuffer());
        if (source.length < 32 || source.length > 5 * 1024 * 1024 ||
            source.toString('ascii', 0, 4) !== 'RIFF' ||
            source.toString('ascii', 8, 12) !== 'WEBP' ||
            source.indexOf('ANIM') < 0 || source.indexOf('ANMF') < 0) {
            throw new Error('Reaction sticker is not a valid animated WebP');
        }

        const metadata = await sharp(source, { animated: true }).metadata();
        if (metadata.format !== 'webp') throw new Error('Unsupported reaction sticker format');

        // Expensive network + Sharp work happens during background warm-up,
        // not while a user is waiting for a command reaction.
        const options = { quality: 78, effort: 5, loop: metadata.loop ?? 0 };
        if (Array.isArray(metadata.delay)) options.delay = metadata.delay;

        let sticker = await sharp(source, { animated: true })
            .resize({ width: 360, height: 360, fit: 'inside', withoutEnlargement: true })
            .extend({
                top: 76, bottom: 76, left: 76, right: 76,
                background: { r: 0, g: 0, b: 0, alpha: 0 },
            })
            .webp(options)
            .toBuffer();

        if (sticker.length > 500 * 1024) {
            sticker = await sharp(source, { animated: true })
                .resize({ width: 320, height: 320, fit: 'inside', withoutEnlargement: true })
                .extend({
                    top: 96, bottom: 96, left: 96, right: 96,
                    background: { r: 0, g: 0, b: 0, alpha: 0 },
                })
                .webp({ quality: 65, effort: 6, loop: metadata.loop ?? 0 })
                .toBuffer();
        }
        if (sticker.length > 500 * 1024) throw new Error('Optimized reaction sticker exceeds WhatsApp 500 KB limit');

        reactionStickerCache.set(url, sticker);
        while (reactionStickerCache.size > 32) {
            reactionStickerCache.delete(reactionStickerCache.keys().next().value);
        }
        return sticker;
    })();

    reactionStickerInflight.set(url, pending);
    try {
        return await pending;
    } finally {
        reactionStickerInflight.delete(url);
    }
}

async function sendStickerReaction(sock, jid, messageKey, commandName = '') {
    try {
        if (!sock?.relayMessage || !jid || !messageKey) return false;
        if (typeof B.generateWAMessage !== 'function' ||
            typeof sock.waUploadToServer !== 'function') {
            throw new Error('This Baileys build does not expose the media upload/message generator required for sticker annotations');
        }

        const selected = chooseReactionSticker(jid, commandName);
        let outgoingMessage;
        let messageId;
        const cached = reactionMessageCache.get(selected.id);
        const cacheValid = cached && (Date.now() - cached.createdAt) < 6 * 60 * 60 * 1000;

        if (cacheValid) {
            // The encrypted WebP was already uploaded to WhatsApp once.
            // Reuse its mediaKey/directPath and only generate a fresh message ID.
            outgoingMessage = structuredClone(cached.message);
            messageId = crypto.randomBytes(11).toString('hex').toUpperCase();
        } else {
            const stickerBuffer = await getReactionStickerBuffer(selected.url);
            const generated = await B.generateWAMessage(
                jid,
                { sticker: stickerBuffer },
                {
                    userJid: sock.user?.id,
                    upload: sock.waUploadToServer,
                    logger: sock.logger,
                    mediaCache: sock.mediaCache,
                }
            );

            if (!generated?.message || !generated?.key?.id) {
                throw new Error('Baileys did not generate the sticker message');
            }

            outgoingMessage = generated.message;
            messageId = generated.key.id;
            reactionMessageCache.set(selected.id, {
                message: structuredClone(generated.message),
                createdAt: Date.now(),
            });
            while (reactionMessageCache.size > 32) {
                reactionMessageCache.delete(reactionMessageCache.keys().next().value);
            }
        }

        outgoingMessage.messageContextInfo = {
            ...(outgoingMessage.messageContextInfo || {}),
            messageAssociation: {
                associationType: 11,
                parentMessageKey: messageKey,
            },
        };

        try {
            await sock.relayMessage(jid, outgoingMessage, { messageId });
        } catch (relayError) {
            // A cached WhatsApp media path can expire. Refresh it once, then
            // cache the replacement for subsequent reactions.
            if (!cacheValid) throw relayError;
            reactionMessageCache.delete(selected.id);
            const stickerBuffer = await getReactionStickerBuffer(selected.url);
            const generated = await B.generateWAMessage(
                jid,
                { sticker: stickerBuffer },
                {
                    userJid: sock.user?.id,
                    upload: sock.waUploadToServer,
                    logger: sock.logger,
                    mediaCache: sock.mediaCache,
                }
            );
            if (!generated?.message || !generated?.key?.id) throw relayError;
            generated.message.messageContextInfo = {
                ...(generated.message.messageContextInfo || {}),
                messageAssociation: {
                    associationType: 11,
                    parentMessageKey: messageKey,
                },
            };
            reactionMessageCache.set(selected.id, {
                message: structuredClone(generated.message),
                createdAt: Date.now(),
            });
            await sock.relayMessage(jid, generated.message, { messageId: generated.key.id });
        }
        return true;
    } catch (error) {
        console.log('[ANIMATED STICKER REACTION]', error?.message || error);
        return false;
    }
}


// Warm every reaction asset in the background so the first command does not
// pay the remote-download + animated-WebP optimization cost.
async function preloadReactionStickers() {
    const urls = [...new Set(Object.values(REACTION_STICKERS))];
    let cursor = 0;
    const workers = Array.from({ length: 3 }, async () => {
        while (cursor < urls.length) {
            const url = urls[cursor++];
            try { await getReactionStickerBuffer(url); }
            catch (error) { console.log('[REACTION PRELOAD]', error?.message || error); }
        }
    });
    await Promise.all(workers);
    console.log(`🎞️ Animated reactions warmed: ${reactionStickerCache.size}/${urls.length}`);
}
void preloadReactionStickers().catch(error => console.log('[REACTION PRELOAD]', error?.message || error));

// ================= MESSAGE STYLES =================
const statusIcon = () => (CALL_ON ? '🟢 *ON*' : '🔴 *OFF*');

const MENU_TEXT = () => [
    `📞 *${config.botName} — Call Menu*`,
    '',
    '*📡 Auto call*',
    `▫️ \`${prefix}call on\` — Enable auto call`,
    `▫️ \`${prefix}call off\` — Disable auto call`,
    `▫️ \`${prefix}call\` — Check status (${CALL_ON ? '🟢 ON' : '🔴 OFF'})`,
    '',
    '*📲 Outgoing calls · Owner*',
    `▫️ \`${prefix}vcall 94771234567\` — Video call`,
    `▫️ \`${prefix}acall 94771234567\` — Audio call`,
    `▫️ \`${prefix}acall 9477...,9476...\` — Multiple calls`,
    '',
    '*⚙️ Settings*',
    `▫️ \`${prefix}mode self|inbox|group|both\``,
    `▫️ \`${prefix}tourl\` — Save replied media URL`,
    `▫️ \`${prefix}c-ping\` — Check call system speed`,
    '',
    `> ✦ ${config.botName}`,
].join('\n');

const STATUS_TEXT = () =>
`📞 *Auto Call:* ${statusIcon()}

${CALL_ON
    ? 'එන one-to-one calls සඳහා පමණක් configured media auto play වෙනවා.'
    : 'ඔයා ON කරනකම් bot එක calls ignore කරනවා.'}

සියලු commands සඳහා ${prefix}call-menu use කරන්න.

${texts.footer}`;

// ================= SETTINGS (ON/OFF) =================
// MongoDB තියෙනවා නම් එහි save වෙනවා, නැත්නම් ./data/settings.json
const Setting = mongoose.models.Setting || mongoose.model('Setting', new mongoose.Schema({
    key: { type: String, unique: true },
    value: mongoose.Schema.Types.Mixed,
}, { collection: 'settings', autoIndex: true }));
const SETTINGS_FILE = './data/settings.json';
const dbOn = () => mongoose.connection.readyState === 1;
let CALL_ON = config.autoCallDefault;
let BOT_MODE = 'self';
let ACTIVE_SOCKET = null;
const DEFAULT_CONNECT_IMAGE = 'https://file.dnuz.top/w2cqgb.jpeg';
const DEFAULT_MENU_IMAGE = 'https://file.dnuz.top/4bo96s.jpg';
let CONNECT_IMAGE_URL = DEFAULT_CONNECT_IMAGE;
let MENU_IMAGE_URL = DEFAULT_MENU_IMAGE;

async function loadSettings() {
    try {
        if (dbOn()) {
            const st = await Setting.findOne({ key: 'autoCall' });
            if (st) CALL_ON = !!st.value;
            const mode = await Setting.findOne({ key: 'botMode' });
            if (['self', 'inbox', 'group', 'both'].includes(mode?.value)) BOT_MODE = mode.value;
            const connectImage = await Setting.findOne({ key: 'connectImageUrl' });
            const menuImage = await Setting.findOne({ key: 'menuImageUrl' });
            CONNECT_IMAGE_URL = connectImage?.value || DEFAULT_CONNECT_IMAGE;
            MENU_IMAGE_URL = menuImage?.value || DEFAULT_MENU_IMAGE;
        } else if (fs.existsSync(SETTINGS_FILE)) {
            const j = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
            if (typeof j.autoCall === 'boolean') CALL_ON = j.autoCall;
            if (['self', 'inbox', 'group', 'both'].includes(j.botMode)) BOT_MODE = j.botMode;
            CONNECT_IMAGE_URL = j.connectImageUrl || DEFAULT_CONNECT_IMAGE;
            MENU_IMAGE_URL = j.menuImageUrl || DEFAULT_MENU_IMAGE;
        }
    } catch (e) {
        console.log('Settings load error (running on defaults):', e?.message || e);
    }
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
            const current = fs.existsSync(SETTINGS_FILE) ? JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) : {};
            fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ ...current, autoCall: v, botMode: BOT_MODE }, null, 2));
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
    BOT_MODE = ['self', 'inbox', 'group', 'both'].includes(mode) ? mode : 'self';
    try {
        if (dbOn()) await Setting.findOneAndUpdate({ key: 'botMode' }, { value: BOT_MODE }, { upsert: true });
        else {
            fs.mkdirSync('./data', { recursive: true });
            const current = fs.existsSync(SETTINGS_FILE) ? JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) : {};
            fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ ...current, botMode: BOT_MODE }, null, 2));
        }
    } catch (e) { console.log('Bot mode save error:', e.message); }
    if (ACTIVE_SOCKET) ACTIVE_SOCKET.public = BOT_MODE !== 'self';
    console.log('🔐 Bot mode:', BOT_MODE);
}

// ================= MEDIA =================
// Bounded LRU caches (P1): the old plain Maps grew forever — every decoded
// media file stayed in RAM until the process OOMed.
function lruSet(cache, key, value, maxEntries) {
    cache.delete(key);
    cache.set(key, value);
    while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
}
const pcmCache = new Map();
const fileCache = new Map();
const inflightPcm = new Map(); // url -> in-flight decode promise (dedupes concurrent decodes)
const endedCalls = new Set();
const waiters = new Map();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function downloadFile(url, file) {
    // A 403/401/404 is a permanent origin response, not a transient network
    // failure. Retrying it three times only spams logs and wastes call setup time.
    // Streams straight to disk (P2) via the shared downloader — whole files
    // are never buffered in RAM.
    const candidates = [url];
    if (url.startsWith('https://github.com/') && url.includes('/raw/')) {
        candidates.push(url.replace('https://github.com/', 'https://raw.githubusercontent.com/').replace('/raw/refs/heads/', '/refs/heads/'));
    }

    let lastErr;
    for (const candidate of [...new Set(candidates)]) {
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                await downloadToFile(candidate, file, { timeoutMs: 60000 });
                // Reject HTML pages masquerading as media (checked from disk).
                const head = fs.readFileSync(file).subarray(0, 100).toString('utf8').toLowerCase();
                if (head.includes('<!doctype html')) {
                    fs.rmSync(file, { force: true });
                    throw Object.assign(new Error('host returned an HTML page instead of a media file'), { permanent: true });
                }
                return;
            } catch (e) {
                lastErr = e;
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
    if (inflightPcm.has(url)) return inflightPcm.get(url);
    const promise = doGetPcm(url);
    inflightPcm.set(url, promise);
    try { return await promise; } finally { inflightPcm.delete(url); }
}

async function doGetPcm(url) {
    fs.mkdirSync(process.env.TMP_DIR || './tmp', { recursive: true });

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
        ff.on('close', (code) => {
            console.log('ffmpeg exit code:', code);
            if (code !== 0) return reject(new Error('ffmpeg exit ' + code));
            resolve(Buffer.concat(chunks));
        });
    });

    const pcm = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
    console.log('🎧 decoded samples:', pcm.length, `(~${(pcm.length / 16000).toFixed(1)}s)`);
    lruSet(fileCache, url, path.resolve(file), MAX_FILE_CACHE_ENTRIES);
    if (pcm.length > 0) lruSet(pcmCache, url, pcm, MAX_PCM_CACHE_ENTRIES);
    return pcm;
}

// unique, collision-free cache file name for a URL
function cacheName(url) {
    const ext = (path.extname(new URL(url).pathname) || '.bin').slice(0, 8);
    return path.join(process.env.TMP_DIR || './tmp', 'media_' + crypto.createHash('sha1').update(url).digest('hex').slice(0, 16) + ext);
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

// Download (if URL) + convert ANY audio/video to a call-friendly file.
// audio -> .ogg (Opus) | video -> .mp4 (H.264 baseline). Type is detected from real content, not the URL extension.
async function prepareMedia(url, wantVideo) {
    const r = await prepareConverted(url, { wantVideo, maxSeconds: 900 });
    // Validate the converted file on the real media path (Q1 — validateMediaFile
    // was imported but never called, so the security module was dead code).
    try { await validateMediaFile(r.file); } catch (e) { throw new Error('Media validation failed: ' + e.message); }
    console.log(`🎛️ [MEDIA] converted → ${r.kind}: ${path.basename(r.file)} (${r.duration.toFixed(1)}s)`);
    return { file: r.file, kind: r.kind, duration: r.duration };
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

// Logs the whole life of a call so we can see exactly where video stops (send these lines when reporting a problem)
function watchCall(call, label) {
    for (const ev of ['ringing', 'connected', 'item', 'peer_video', 'downgraded', 'playlist_ended', 'playlist_looped', 'audio_finished']) {
        call.on(ev, (info) => console.log(`🔎 [${label}] ${ev}`, info !== undefined ? JSON.stringify(info) : ''));
    }
}

// Make sure the call really ends when the media is over (library has no end-timer for video + loops audio).
// startNow=true for incoming calls (already connected); otherwise the timer starts when the other side answers.
async function armAutoHangup(call, file, label, startNow = false) {
    // A connected event may be emitted more than once. Lock before awaiting
    // ffprobe so duplicate events can never create competing hangup timers.
    let mediaTimer = null;
    let answerTimer = null;
    let mediaTimerStarting = false;
    let finished = false;

    const clearTimers = () => {
        if (mediaTimer) clearTimeout(mediaTimer);
        if (answerTimer) clearTimeout(answerTimer);
        mediaTimer = null;
        answerTimer = null;
    };

    const safeHangup = async (reason) => {
        if (finished) return;
        finished = true;
        clearTimers();
        console.log(`⏹️ ${label}: ${reason} → hangup`);
        try {
            await call.hangup();
        } catch (error) {
            console.log(`⚠️ ${label}: hangup failed:`, error?.message || error);
        }
    };

    const startMediaTimer = async () => {
        if (finished || mediaTimer || mediaTimerStarting) return;
        mediaTimerStarting = true;
        if (answerTimer) {
            clearTimeout(answerTimer);
            answerTimer = null;
        }

        try {
            const ms = await mediaDurationMs(file);
            if (finished || mediaTimer) return;

            // The media validator allows files up to 15 minutes. Do not cap
            // the watchdog at 10 minutes, otherwise longer audio is cut short.
            const fallbackMs = 15 * 60 * 1000;
            const playbackMs = ms > 0 ? ms : fallbackMs;
            mediaTimer = setTimeout(() => {
                void safeHangup(ms > 0 ? 'media duration elapsed' : 'maximum call duration reached');
            }, playbackMs + 15000);

            console.log(`⏱️ ${label}: playback watchdog armed for ${Math.ceil(playbackMs / 1000)}s`);
        } catch (error) {
            console.log(`⚠️ ${label}: duration check failed:`, error?.message || error);
            if (!finished && !mediaTimer) {
                mediaTimer = setTimeout(() => {
                    void safeHangup('maximum call duration reached');
                }, 15 * 60 * 1000);
            }
        } finally {
            mediaTimerStarting = false;
        }
    };

    call.on('connected', () => {
        void startMediaTimer();
    });

    call.on('ended', () => {
        finished = true;
        clearTimers();
    });

    // If the remote party never answers, release the call slot.
    if (!startNow) {
        answerTimer = setTimeout(() => {
            void safeHangup('answer timeout (90s)');
        }, 90 * 1000);
    } else {
        void startMediaTimer();
    }
}
async function playAudioOnCall(voip, callId, url) {
    const co = voip.coordinator;

    // Decode before accepting the call (answerIncoming prewarms this cache).
    // If the peer has already ended the call, never touch the released coordinator slot.
    if (endedCalls.has(callId)) return false;
    const all = await getPcm(url);
    if (!all.length || endedCalls.has(callId)) return false;

    const file = fileCache.get(url);
    const secs = all.length / 16000;
    let done;
    const finished = new Promise(r => { done = r; });
    waiters.set(callId, done);

    try {
        if (endedCalls.has(callId)) return false;
        await co.loadAudio(callId, file);
        console.log('▶️ loadAudio OK, playing ~' + secs.toFixed(0) + 's');
        await Promise.race([finished, sleep((secs + 3) * 1000)]);
        console.log('🎵 audio playback finished');
        return !endedCalls.has(callId);
    } catch (e) {
        console.log('loadAudio error:', e.message);
        // Do not attempt a fallback on a call whose coordinator slot is gone.
        if (endedCalls.has(callId)) return false;
    } finally {
        if (waiters.get(callId) === done) waiters.delete(callId);
    }

    try {
        if (endedCalls.has(callId)) return false;
        await co.setExternalAudioMode?.(callId, true);
        console.log('externalAudioMode ON');
    } catch (e) {
        console.log('setExternalAudioMode error:', e.message);
        if (endedCalls.has(callId)) return false;
    }

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
    console.log('🎵 audio feed finished', failed ? '(error)' : '');
    return logged;
}

// Convert the video to a small, call-friendly version (480px, baseline H.264, low bitrate)
async function makeCallVideo(src) {
    if (src.includes('media-cache')) return src; // already converted by media-convert.js
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
const SESSION_DIR = process.env.SESSION_DIR || (fs.existsSync('./auth_baileys/creds.json') ? './auth_baileys' : './session');
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
    validateSessionDir(SESSION_DIR);
    fs.rmSync(SESSION_DIR, { recursive: true, force: true });
    fs.mkdirSync(SESSION_DIR, { recursive: true });
    // Decrypt the session envelope if it was stored encrypted (S6).
    let data = st.data;
    try { data = decryptSessionData(st.data); } catch (e) { console.log('❌ Session decrypt error:', e.message); return false; }
    // Sanitise filenames from MongoDB: only basenames ending in .json are
    // written, so a poisoned record can never path-traverse out of SESSION_DIR.
    for (const f in data) {
        const name = path.basename(String(f));
        if (!name.endsWith('.json') || name !== String(f)) continue;
        fs.writeFileSync(path.join(SESSION_DIR, name), data[f]);
    }
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
        // Encrypt the session at rest in MongoDB (S6); plaintext only when
        // SESSION_ENCRYPTION_KEY is unset, with a warning logged by the helper.
        const stored = encryptSessionData(data);
        await Session.findOneAndUpdate(
            { sessionId: SESSION_KEY },
            { $set: { data: stored, src: CURRENT_SRC, updatedAt: new Date() } },
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
    validateSessionDir(SESSION_DIR);
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
let dialStartQueue = Promise.resolve(); // serialize call-slot checks so parallel targets cannot race

function getActiveVoipCalls(voip) {
    if (!Array.isArray(voip?.calls)) return 0;
    return voip.calls.filter(call => {
        const id = call?.callId ?? call?.id;
        return id && !endedCalls.has(id);
    }).length;
}

async function waitForVoipSlot(voip, timeoutMs = 120000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (VOIP !== voip) throw new Error('WhatsApp VoIP connection changed; retry the command.');
        const active = getActiveVoipCalls(voip);
        if (active < MAX_CONCURRENT_CALLS) return;
        await sleep(500);
    }
    const active = getActiveVoipCalls(voip);
    throw new Error(`Call slots are still full (${active}/${MAX_CONCURRENT_CALLS}). A call is still active or has not emitted its ended event; check the call logs and connection.`);
}

function queueVoipDial(voip, number, file, kind) {
    const task = dialStartQueue.then(async () => {
        await waitForVoipSlot(voip);
        if (VOIP !== voip) throw new Error('VoIP connection changed before dialing.');

        // Use the documented native media overload: MP4 + resolution starts
        // both the outgoing video and its audio track inside the VoIP engine.
        // Do not attach a second coordinator video feeder here.
        if (kind === 'video') {
            return voip.call(number, file, config.voip.callResolution || '480p');
        }
        return voip.call(number, file);
    });
    dialStartQueue = task.then(() => undefined, () => undefined);
    return task;
}

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
            try { await sock.sendMessage(replyJid, { text: `${texts.fail}\n\n${texts.footer}` }); } catch {}
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
    let accepted = false;
    try {
        // Answer immediately. A broken/blocked media URL must never prevent
        // the incoming one-to-one call from being accepted.
        if (endedCalls.has(callId)) return;
        await voip.acceptCall(callId);
        accepted = true;
        console.log('✅ Incoming call accepted immediately:', callId);

        if (endedCalls.has(callId)) {
            console.log('⏭️ Call ended immediately after acceptance:', callId);
            return;
        }

        // Prefer .tourl's local file. It avoids third-party HTTP 403 responses.
        // Fall back to the configured URL only when no saved local media works.
        const latest = getLatestCallMedia()?.file || '';
        const configured = isVideo ? VIDEO_URL : AUDIO_URL;
        const candidates = [...new Set([latest, configured].filter(Boolean))];
        let prepared = null;
        const errors = [];

        for (const candidate of candidates) {
            try {
                prepared = await prepareMedia(candidate, isVideo);
                console.log('📦 Incoming call media ready:', prepared.kind, path.basename(prepared.file));
                break;
            } catch (error) {
                errors.push(error?.message || String(error));
                console.log('⚠️ Incoming call media candidate failed:', error?.message || error);
            }
        }

        if (!prepared) {
            const mediaType = isVideo ? 'video' : 'audio';
            const hint = candidates.length
                ? 'Saved .tourl media and configured URL were both unavailable or invalid.'
                : 'Audio/video එකකට reply කරලා .tourl යවන්න, නැත්නම් DEFAULT_AUDIO_URL / DEFAULT_VIDEO_URL එකක් configure කරන්න.';
            const reason = `Incoming ${mediaType} call answered, but playback media is unavailable. ${hint} ${errors.join(' | ')}`;
            console.log('⚠️', reason);
            try { await sock.sendMessage(replyJid, { text: `${texts.fail}\n${reason}\n\n${texts.footer}` }); } catch {}
            await voip.hangup(callId).catch(() => {});
            return;
        }

        if (endedCalls.has(callId)) {
            console.log('⏭️ Call ended while preparing media:', callId);
            return;
        }

        // Decode and validate after accepting. This can no longer cause the
        // incoming call to ring until a remote URL finishes downloading.
        const pcm = await Promise.race([
            getPcm(prepared.file),
            sleep(PRE_DECODE_DEADLINE_MS).then(() => { throw new Error('Media decode exceeded the 10s deadline'); }),
        ]);
        if (!pcm.length) throw new Error('Media decoded to zero audio samples.');
        if (isVideo) {
            const localVideo = fileCache.get(prepared.file);
            if (localVideo) await makeCallVideo(localVideo);
        }

        if (endedCalls.has(callId)) return;
        await runPlayback(voip, sock, callId, isVideo, replyJid, prepared.file);
    } catch (e) {
        console.log('❌ Incoming call error:', e?.message || e);
        try {
            if (accepted) await voip.hangup(callId);
            else await voip.rejectCall(callId);
        } catch {}
        try {
            await sock.sendMessage(replyJid, {
                text: `${texts.fail}\n${e?.message || 'Unknown call error'}\n\n${texts.footer}`
            });
        } catch {}
        setTimeout(() => handled.delete(callId), 60000);
    } finally {
        accepting.delete(callId);
    }
}

const ANSWERED_RE = /connected|active|answered|in_call|incall|established|accepted/i;

async function setupVoip(sock) {
    fs.mkdirSync(process.env.TMP_DIR || './tmp', { recursive: true });
    const voip = new Voip(sock, {
        ffprobePath: FFPROBE,
        voipLogLevel: config.voip.logLevel,
        tmpDir: process.env.TMP_DIR || './tmp',
        maxConcurrentCalls: MAX_CONCURRENT_CALLS,
    });

    await voip.listen();
    VOIP = voip;
    console.log(`${SESSION_LABEL} 📡 VoIP listening`);

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
        const id = c?.callId;
        console.log('📴 Call ended', id, '| reason:', c?.endReason ?? c?.reason ?? '');
        if (id) {
            endedCalls.add(id);
            pendingOut.delete(id);
            waiters.get(id)?.();
            waiters.delete(id);
            // Bound this guard set so long-running sessions do not grow forever.
            if (endedCalls.size > 500) endedCalls.delete(endedCalls.values().next().value);
        }
    });
    voip.on('call_outbound_audio_finished', (c) => {
        waiters.get(c?.callId ?? c?.call?.callId)?.();
    });
    voip.on('call_state', (state) => {
        console.log('📶 VoIP call state:', JSON.stringify(state));
    });
    voip.on('call_error', (e) => console.log('Call error:', e?.message ?? e));

    return voip;
}

// ================= MANUAL CALLS (.vcall / .acall) =================
const isHttpUrl = (u) => /^https?:\/\/\S+$/i.test(u || '');

async function waitForVoip() {
    const readyDeadline = Date.now() + 30000;
    while (!VOIP && Date.now() < readyDeadline) {
        if (voipInitPromise) { try { await Promise.race([voipInitPromise, sleep(1000)]); } catch {} }
        else await sleep(500);
    }
    if (!VOIP) throw new Error('Voip initialize වුණේ නැහැ. Logs වල "Voip setup error" හෝ "Voip listening" පරීක්ෂා කරන්න.');
    return VOIP;
}

// Pick the media source (command link > config link > latest .tourl) and convert it ONCE.
// Audio always ends up as .ogg, video as .mp4 - whatever the original extension was.
async function resolveDialMedia(kind, url) {
    let source = url; let sourceLabel = 'command URL';
    if (!source) {
        const configured = kind === 'video' ? VIDEO_URL : AUDIO_URL;
        if (configured) { source = configured; sourceLabel = 'config.js media URL'; }
        else {
            const latest = getLatestCallMedia();
            if (!latest?.file) throw new Error(`config.js හි ${kind === 'video' ? 'videoUrl' : 'audioUrl'} එකක් හෝ .tourl media එකක් අවශ්‍යයි.`);
            source = latest.file; sourceLabel = 'latest .tourl local media';
        }
    }
    if (!isHttpUrl(source) && !fs.existsSync(source)) throw new Error('Media source එක හමු වුණේ නැහැ. නැවත .tourl යවන්න.');
    console.log('[MEDIA] Source:', sourceLabel);
    const prepared = await prepareMedia(source, kind === 'video');
    const size = fs.statSync(prepared.file).size;
    const limit = (kind === 'video' ? 50 : 20) * 1024 * 1024;
    if (size > limit) throw new Error(`Converted ${kind} media is ${(size / 1048576).toFixed(1)} MB (limit ${limit / 1048576} MB). Use a shorter file.`);
    return prepared;
}

async function dialPrepared(kind, number, prepared) {
    await waitForVoip();
    console.log(`📞 Starting outgoing ${kind} call to ${number}`);
    const voip = VOIP;
    if (kind === 'video' && prepared.kind !== 'video') {
        throw new Error('Video call requires an MP4 video file; media conversion did not produce video.');
    }
    const call = await queueVoipDial(voip, number, prepared.file, prepared.kind);
    const callId = call?.callId ?? call?.id;
    console.log('📡 VOIP.call returned:', callId || 'no callId', '| target:', call?.target || number);
    if (!callId) throw new Error('VOIP.call() did not return a callId; inspect VOIP call_error logs.');
    watchCall(call, `manual ${kind}`);
    call.on('ringing', () => console.log(`📳 ${kind} call is ringing:`, callId));
    call.on('connected', () => console.log(`✅ ${kind} call connected:`, callId));
    call.on('ended', reason => console.log(`📴 ${kind} call ended:`, reason || ''));
    call.on('error', error => console.error(`❌ ${kind} call error:`, error?.message || error));
    await armAutoHangup(call, prepared.file, `manual ${kind} ${callId}`);
    return call;
}

// kept for plugins / backwards compatibility
async function dialOut(kind, number, url) {
    await waitForVoip();
    return dialPrepared(kind, number, await resolveDialMedia(kind, url));
}

async function handleDial(sock, m, jid, kind, rawArgs, reply) {
    const label = kind === 'video' ? 'Video' : 'Audio';
    const cmd = kind === 'video' ? 'vcall' : 'acall';
    const input = rawArgs.join(' ').trim();
    // Strip the media URL FIRST, then parse numbers from the remainder (L9):
    // a URL's digits (ports, paths, query strings) must never be mistaken
    // for phone numbers.
    const urlMatch = input.match(/https?:\/\/\S+/i);
    const url = urlMatch?.[0];
    const numberPart = url ? input.replace(url, ' ').trim() : input;
    const numbers = [...new Set([...numberPart.matchAll(/\+?\d[\d\s-]{6,17}\d/g)].map(x => clean(x[0])))];
    const residue = numberPart.replace(/[()+\s,;\d-]/g, '');
    if (residue || numbers.length < 1 || numbers.length > MAX_CONCURRENT_CALLS || numbers.some(n => n.length < 8 || n.length > 15)) {
        await reply(`❌ Number format එක වැරදියි. 1 සිට ${MAX_CONCURRENT_CALLS} දක්වා numbers දෙන්න.

*Examples:*
${prefix}${cmd} 94771234567
${prefix}${cmd} 94771234567,94777654321
${prefix}${cmd} 94771234567 94777654321 https://site.com/any-audio-link

${texts.footer}`);
        return;
    }
    const latest = getLatestCallMedia();
    const configuredDefault = kind === 'video' ? VIDEO_URL : AUDIO_URL;
    if (!url && !configuredDefault && !latest?.file) return reply(`❌ config.js හි ${kind === 'video' ? 'videoUrl' : 'audioUrl'} එකක් සකසන්න, link එකක් දෙන්න, හෝ .tourl media එකක් save කරන්න.`);

    // Send ONE status message and edit it as the batch progresses.
    // This avoids flooding the chat with one WhatsApp message per target.
    let statusMessage;
    const statusText = (stage, lines = []) => [
        `╭━━〔 ✦ ${label.toUpperCase()} CALLS 〕━━╮`,
        '',
        `📡 *Status:* ${stage}`,
        `👥 *Targets:* ${numbers.length}`,
        `✅ *Processed:* ${lines.length}/${numbers.length}`,
        '',
        ...numbers.map((number, index) => {
            const result = lines[index];
            return result ? result : `⏳ +${number} — waiting`;
        }),
        '',
        texts.footer,
    ].join('\n');
    const updateStatus = async (stage, lines = []) => {
        const text = statusText(stage, lines);
        if (!statusMessage) {
            statusMessage = await reply(text);
            return;
        }
        try {
            await sock.sendMessage(jid, { text, edit: statusMessage.key });
        } catch (error) {
            // Keep the original status message as the single source of truth.
            console.log('[CALL STATUS EDIT] Could not edit status message:', error?.message || error);
        }
    };

    await updateStatus('Preparing media…');

    let prepared;
    try { prepared = await resolveDialMedia(kind, url); }
    catch (e) {
        await updateStatus(`Media preparation failed: ${e.message}`);
        return;
    }

    const lines = [];
    await updateStatus('Starting calls…', lines);
    for (const number of numbers) {
        try {
            await Promise.race([
                dialPrepared(kind, number, prepared),
                sleep(VOIP_SLOT_TIMEOUT_MS).then(() => { throw new Error('Call slot wait timed out after 30s'); }),
            ]);
            lines.push(`✅ +${number} — ringing`);
        } catch (e) {
            lines.push(`❌ +${number} — ${e?.message || 'Call failed'}`);
        }
        await updateStatus(`Calling · ${lines.length}/${numbers.length}`, lines);
    }
    await updateStatus('Completed', lines);
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
// unwrapMessage lives in lib/unwrap.js (single shared copy, Q4).

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

// Recent message cache: WhatsApp strips url/mediaKey/directPath from QUOTED media,
// so plugins (.vv / .link) need the ORIGINAL message the bot received earlier.
const MSG_CACHE = new Map();
function cacheMessage(m) {
    const id = m?.key?.id;
    if (!id || !m.message) return;
    const inner = unwrapMessage(m.message);
    if (!(inner.imageMessage || inner.videoMessage || inner.audioMessage || inner.documentMessage || inner.stickerMessage || m.message.viewOnceMessage || m.message.viewOnceMessageV2)) return;
    MSG_CACHE.delete(id);
    MSG_CACHE.set(id, m);
    if (MSG_CACHE.size > MSG_CACHE_MAX) MSG_CACHE.delete(MSG_CACHE.keys().next().value);
}
const getCachedMessage = (id) => (id ? MSG_CACHE.get(id) || null : null);

async function handleCommand(sock, m) {
    const body = extractCommandText(m.message);
    const trimmed = String(body || '').trim();
    const jid = m.key.remoteJid;
    if (!jid || jid === 'status@broadcast') return;

    // Keep URLs case-sensitive; normalize only the command name.
    const parts = trimmed.slice(prefix.length).trim().split(/\s+/);
    const name = (parts[0] || '').toLowerCase();
    const rawArgs = parts.slice(1);
    const arg = rawArgs[0]?.toLowerCase();
    const extra = rawArgs[1];

    const isCall = name === 'call' && !extra && (arg === undefined || arg === 'on' || arg === 'off');
    const isMenu = ['call-menu', 'callmenu'].includes(name) && arg === undefined;
    const isPing = name === 'c-ping' && arg === undefined;
    const isVcall = name === 'vcall';
    const isAcall = name === 'acall';
    const isMode = name === 'mode';
    const isSelf = name === 'self';
    const isPublic = name === 'public';
    const plugin = PLUGIN_MAP.get(name);

    // Group messages identify the sender via participant; newer Baileys builds
    // may expose the phone-number JID as participantAlt when the primary is an LID.
    const senders = senderNumbers(m);

    // WhatsApp self-chat can arrive with an LID/alternate JID and may not
    // consistently set fromMe on every linked-device event. Match the chat
    // against the connected account's own PN/LID identifiers as a fallback.
    const ownIdentityValues = [
        sock.user?.id,
        sock.user?.jid,
        sock.user?.phoneNumber,
        sock.user?.lid,
        sock.user?.lidJid,
    ].filter(Boolean).map(value => String(value).toLowerCase());
    const normalizeJid = value => String(value || '').toLowerCase().replace(/:\\d+(?=@)/, '');
    const ownJids = new Set(ownIdentityValues.map(normalizeJid));
    const ownNumbers = new Set(ownIdentityValues.map(value =>
        clean(value.split('@')[0].split(':')[0])
    ).filter(Boolean));
    const chatJid = normalizeJid(jid);
    const alternateChatJid = normalizeJid(m.key?.remoteJidAlt);
    const isBotSelfChat = ownJids.has(chatJid)
        || ownJids.has(alternateChatJid)
        || (!!chatJid && ownNumbers.has(clean(chatJid.split('@')[0])));

    const isOwner = !!m.key.fromMe || isBotSelfChat
        || senders.some(number => OWNERS.includes(number));

    const isGroupChat = jid.endsWith('@g.us');
    const inAllowedChat = BOT_MODE === 'both'
        || (BOT_MODE === 'inbox' && !isGroupChat)
        || (BOT_MODE === 'group' && isGroupChat)
        || BOT_MODE === 'self';

    // Numeric replies to a CineSubz selection must be routed BEFORE the
    // mode/owner gate (C3): in self mode a non-owner's plain "2" reply was
    // dropped here, so the selection session could never complete.
    if (trimmed && !trimmed.toLowerCase().startsWith(prefix)) {
        // Route plain-text selections to every plugin that owns an active
        // conversation (CineSubz, Mod APK, Mod Games, Old PC Games, etc.).
        const reply = (t) => sock.sendMessage(jid, { text: t }, { quoted: m });
        for (const activePlugin of PLUGIN_LIST) {
            if (typeof activePlugin.onMessage !== 'function') continue;
            try {
                const handled = await activePlugin.onMessage({
                    sock, m, jid, config, prefix, reply, text: trimmed,
                    args: [], isOwner: !!m.key.fromMe,
                    getCachedMessage,
                    state: { plugins: PLUGIN_LIST, pluginCount: PLUGIN_LIST.length }
                });
                if (handled) {
                    // Reactions are cosmetic: never hold up the next command
                    // while downloading/resizing/uploading an animated sticker.
                    void sendStickerReaction(sock, jid, m.key, activePlugin.name);
                    return;
                }
            } catch (error) {
                console.log(`[PLUGIN REPLY ROUTER: ${activePlugin.name}]`, error?.message || error);
            }
        }
        return;
    }

    // Ignore unknown commands only after interactive plain-text replies have
    // had a chance to reach active plugins. Numeric selections are not commands.
    if (!plugin && !isCall && !isMenu && !isPing && !isVcall && !isAcall && !isSelf && !isPublic && !isMode) return;

    // Self mode: silently ignore non-owner commands.
    if (!inAllowedChat || (BOT_MODE === 'self' && !isOwner)) return;

    const publicAllowed = BOT_MODE !== 'self'
        && ((plugin && !plugin.ownerOnly) || isMenu || isPing || (isCall && arg !== 'on' && arg !== 'off'));
    const allowed = isOwner || publicAllowed;
    if (!allowed) return;

    // Every recognized command uses the same sticker-reaction system.
    // Keep command replies responsive; sticker generation/upload runs in background.
    void sendStickerReaction(sock, jid, m.key, name);

    const reply = (t) => sock.sendMessage(jid, { text: t }, { quoted: m });

    if (isMode || isSelf || isPublic) {
        if (!isOwner) return;
        const requested = isMode ? rawArgs.join('').toLowerCase().replace(/\s+/g, '') : (isSelf ? 'self' : 'both');
        const aliases = { 'inbox&group': 'both', 'inbox+group': 'both', 'inboxandgroup': 'both', 'public': 'both' };
        const nextMode = aliases[requested] || requested;
        if (!['self', 'inbox', 'group', 'both'].includes(nextMode)) {
            return reply(`⚙️ *Bot Mode*\n\n• ${prefix}mode self\n• ${prefix}mode inbox\n• ${prefix}mode group\n• ${prefix}mode both`);
        }
        await setBotMode(nextMode);
        const labels = { self: 'OWNER ONLY', inbox: 'INBOX ONLY', group: 'GROUP ONLY', both: 'INBOX & GROUP' };
        return reply(`✅ *Mode updated:* ${labels[BOT_MODE]}\n✦ 𝗚𝖮𝖣 𝗩𝖮𝖨𝖯 𝗠𝖣`);
    }

    if (isVcall || isAcall) {
        if (!isOwner) return reply(`${texts.ownerOnly}\n\n${texts.footer}`);
        await handleDial(sock, m, jid, isVcall ? 'video' : 'audio', rawArgs, reply);
        return;
    }

    if (plugin) {
        const ctx = {
            sock, m, jid, config, prefix, isOwner, getCachedMessage,
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
        await sendMenuMedia(sock, jid, m, MENU_TEXT());
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
    if (process.env.DISABLE_SERVER === 'true') return;
    const app = express();
    app.get('/', (req, res) => res.send(`${config.botName} is running ✅`));
    app.listen(config.port, '127.0.0.1', () => console.log(`🌐 Server running on 127.0.0.1:${config.port}`));
}

// ================= START =================
let pairRequested = false;
let pairAttempts = 0;
let reconnectTimer = null;
let starting = false;
let socketGeneration = 0;
const MAX_PAIR_CODES = 6;

async function start() {
    if (starting) return;
    starting = true;
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
    const { version } = await fetchLatestBaileysVersion();
    // Never allow Baileys/libsignal to dump Signal SessionEntry ratchet objects.
    // A no-op logger is stricter than relying on the package's pino level handling.
    const logger = {
        level: 'silent',
        trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {},
        child() { return this; },
    };

    const generation = ++socketGeneration;
    const sock = makeWASocket({
        version,
        logger,
        printQRInTerminal: false,
        getMessage: async (key) => getCachedMessage(key?.id)?.message,
        browser: ['Ubuntu', 'Chrome', '20.0.04'],
        performanceMode: 'high',
        syncFullHistory: false,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
    });

    ACTIVE_SOCKET = sock;
    sock.public = BOT_MODE !== 'self';

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
            cacheMessage(m);
            try {
                await handleCommand(sock, m);
            } catch (e) {
                console.log('cmd error:', e.message);
            }
        }
    });

    let voipReady = false;
    let connectNoticeSent = false;
    sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
        // Ignore late events from a socket replaced during reconnect.
        if (ACTIVE_SOCKET !== sock || generation !== socketGeneration) return;
        if (connection === 'open') {
            starting = false;
            if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
            pairRequested = false;
            pairAttempts = 0;
            console.log(`${SESSION_LABEL} ✅ Connected: ${sock.user?.id || 'WhatsApp account'}`);
            await saveSession();
            // Send one compact connection card to this WhatsApp session's own inbox.
            if (!connectNoticeSent) {
                connectNoticeSent = true;
                const sessionInbox = sock.user?.id
                    ? sock.user.id.split(':')[0].replace(/\D/g, '') + '@s.whatsapp.net'
                    : '';
                if (sessionInbox) {
                    const connectCaption = `╭━━━〔 𝗚𝖮𝖣 𝗩𝖮𝖨𝖯 𝗠𝖣 〕━━━╮
┃
┃  ✨ *CONNECTED SUCCESSFULLY*
┃  🟢 Status  : *ONLINE*
┃  ⚙️ Mode    : *${BOT_MODE.toUpperCase()}*
┃  🔐 Session : *ACTIVE*
┃
╰━━━━━━━━━━━━━━━━━━━━━━╯

          _POWERED BY GOD VOIP MD_`;
                    try {
                        await sock.sendMessage(sessionInbox, {
                            image: { url: 'https://file.dnuz.top/w2cqgb.jpeg' },
                            caption: connectCaption,
                        });
                    } catch (e) {
                        console.log('Connect inbox message failed:', e.message);
                    }
                }
            }
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
            // Detach and shut down the old VoIP engine so its calls/slots/listeners
            // cannot leak into the next WhatsApp socket after reconnect.
            const staleVoip = VOIP;
            VOIP = null;
            voipInitPromise = null;
            voipReady = false;
            if (staleVoip) {
                try { await staleVoip.end(); }
                catch (error) { console.log('Old VoIP cleanup error:', error?.message || error); }
            }
            for (const [callId, resolve] of waiters) {
                try { resolve(); } catch {}
                waiters.delete(callId);
                endedCalls.add(callId);
            }
            handled.clear();
            accepting.clear();
            pendingOut.clear();
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

// A fatal error must kill the process (C2) so the supervisor restarts it
// visibly instead of the bot silently running dead.
process.on('uncaughtException', (e) => { console.log('Uncaught exception:', e?.message ?? e); process.exit(1); });
process.on('unhandledRejection', (e) => { console.log('Unhandled rejection:', e?.message ?? e); process.exit(1); });

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
        console.log(`${SESSION_LABEL} ❌ Configured session is invalid:`, e.message);
        // Do not silently fall back to a different MongoDB account/session.
        // The supervisor will restart this worker and keep the failure visible.
        process.exit(1);
    }
}
if (!haveSession && saved) {
    haveSession = await restoreSession(saved);
    if (haveSession) CURRENT_SRC = saved.src || '';
}
if (!haveSession) {
    console.log(`${SESSION_LABEL} ❌ No usable auth session found. Refusing to start an unlinked socket.`);
    process.exit(1);
}

await loadSettings();
await loadPlugins();
startServer();
start().catch((e) => { console.error('❌ Fatal startup error:', e?.message || e); process.exit(1); });
