// ============================================================
//  GOD VOIP MD - session loader
//  config.js / SESSION_ID එකෙන් WhatsApp session එක ./session folder එකට restore කරනවා.
//  Supported: Base64 (creds JSON) | raw creds.json content | MEGA link (url හෝ ID#KEY)
// ============================================================

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const SESSION_DIR = fs.existsSync('./auth_baileys/creds.json') ? './auth_baileys' : './session';
const SRC_FILE = path.join(SESSION_DIR, '.session.src');

// 𝙰𝚂𝙸𝚃𝙷𝙰 වගේ fancy letters → සාමාන්‍ය letters
const normalize = (s) => String(s || '').normalize('NFKC').trim();

function stripPrefix(raw) {
    const s = normalize(raw);
    // "ASITHA-MD=xxxx" වගේ prefix එක අයින් කරනවා (base64 padding "=" එක නෙවෙයි)
    const i = s.indexOf('=');
    if (i > 0 && i <= 40) {
        const head = s.slice(0, i);
        const rest = s.slice(i + 1);
        if (/^[A-Za-z0-9 _.:-]+$/.test(head) && rest && !/^=+$/.test(rest)) return rest.trim();
    }
    return s;
}

function tryJson(text) {
    try { return JSON.parse(text); } catch { return null; }
}

function tryBase64Json(text) {
    try {
        const dec = Buffer.from(text, 'base64').toString('utf-8');
        return tryJson(dec);
    } catch { return null; }
}

function writeSessionFiles(obj) {
    fs.rmSync(SESSION_DIR, { recursive: true, force: true });
    fs.mkdirSync(SESSION_DIR, { recursive: true });
    if (obj && obj.noiseKey && obj.signedIdentityKey) {
        if (obj.registered === false) throw new Error('මේ session එක WhatsApp එකට link වෙලා නෑ (registered=false).');
        // creds.json content එක විතරයි
        fs.writeFileSync(path.join(SESSION_DIR, 'creds.json'), JSON.stringify(obj));
        return 1;
    }
    // { "creds.json": "...", "app-state-sync-key-xx.json": "..." } වගේ folder map එකක්
    let n = 0;
    for (const [file, content] of Object.entries(obj || {})) {
        if (!file.endsWith('.json')) continue;
        const data = typeof content === 'string' ? content : JSON.stringify(content);
        fs.writeFileSync(path.join(SESSION_DIR, path.basename(file)), data);
        n++;
    }
    return n;
}

async function fromMega(link) {
    let File;
    try { ({ File } = await import('megajs')); }
    catch { throw new Error('megajs package එක නෑ. `npm install` run කරන්න.'); }
    let url = /^https?:/i.test(link) ? link : `https://mega.nz/file/${link}`;
    const old = url.match(/mega\.nz\/#!([\w-]+)!([\w-]+)/);   // පරණ link format: #!ID!KEY
    if (old) url = `https://mega.nz/file/${old[1]}#${old[2]}`;
    const file = File.fromURL(url);
    await file.loadAttributes();
    const buf = await file.downloadBuffer();
    return buf.toString('utf-8');
}

// දෙන ලද session string එකෙන් JSON object එකක් හදාගන්නවා
async function resolve(raw) {
    const s = stripPrefix(raw);

    let obj = tryJson(s) || tryBase64Json(s);
    if (obj) return obj;

    if (/mega\.nz|^[A-Za-z0-9_-]{8}#[A-Za-z0-9_-]{20,}$/.test(s)) {
        const text = await fromMega(s);
        obj = tryJson(text) || tryBase64Json(text.trim());
        if (obj) return obj;
        throw new Error('MEGA file එකේ session data (creds) හරි නෑ.');
    }

    throw new Error(
        'Session ID එක හඳුනාගන්න බෑ (' + s.slice(0, 12) + '…). Base64 / creds.json content / MEGA link එකක් දාන්න. ' +
        'කෙටි id (xxxx=abc123) support නෑ.'
    );
}

export const sessionHash = (raw) => raw ? crypto.createHash('sha1').update(normalize(raw)).digest('hex') : '';

export async function loadSession(raw) {
    if (!raw) throw new Error('SESSION ID එක config.js එකේ (sessionId) දාලා නෑ.');

    const hash = sessionHash(raw);
    const same = fs.existsSync(SRC_FILE) && fs.readFileSync(SRC_FILE, 'utf-8') === hash;

    // කලින් restore කරපු session එකම නම් ./session folder එක (අලුත් keys එක්ක) ඒ විදිහටම පාවිච්චි කරනවා
    if (same && fs.existsSync(path.join(SESSION_DIR, 'creds.json'))) {
        console.log('✅ Session found (saved)');
        return;
    }

    const obj = await resolve(raw);
    const n = writeSessionFiles(obj);
    if (!n || !fs.existsSync(path.join(SESSION_DIR, 'creds.json'))) {
        throw new Error('Session එකේ creds.json නෑ - session එක වැරදියි.');
    }
    fs.writeFileSync(SRC_FILE, hash);
    console.log('✅ Session restored from config');
}
