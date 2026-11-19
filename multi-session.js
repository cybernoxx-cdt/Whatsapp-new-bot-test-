// GOD VOIP MD - isolated multi-session process manager
// Supports SESSION_ID (legacy), SESSION_ID_1 ... SESSION_ID_10.
// Each account runs in its own Node process to isolate Baileys + VoIP globals.

import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const MAX_SESSIONS = Math.max(1, Math.min(10, Number(process.env.MAX_SESSIONS || 10)));
const baseNumber = process.env.BOT_NUMBER || process.env.OWNER_NUMBER || '94707085822';
const baseKey = process.env.SESSION_KEY || 'god-voip-md';
const sessions = [];

for (let i = 1; i <= MAX_SESSIONS; i++) {
    const raw = process.env[`SESSION_ID_${i}`] || (i === 1 ? process.env.SESSION_ID : '');
    if (!String(raw || '').trim()) continue;
    const number = process.env[`BOT_NUMBER_${i}`] || baseNumber;
    sessions.push({ index: i, raw: String(raw).trim(), number });
}

if (!sessions.length) {
    console.error('❌ No session configured. Add SESSION_ID or SESSION_ID_1 GitHub Secret.');
    process.exit(1);
}

console.log(`╭─「 GOD VOIP MD MULTI-SESSION 」─
│ Configured sessions: ${sessions.length}
│ Session slots: ${sessions.map(s => s.index).join(', ')}
╰───────────────────────────────`);

const children = new Map();
let shuttingDown = false;

function launch(session) {
    if (shuttingDown) return;
    const dir = path.resolve('sessions', `session-${session.index}`);
    fs.mkdirSync(dir, { recursive: true });
    const env = {
        ...process.env,
        SESSION_ID: session.raw,
        SESSION_KEY: `${baseKey}-${session.index}`,
        SESSION_DIR: dir,
        BOT_NUMBER: session.number,
        SESSION_INDEX: String(session.index),
        DISABLE_SERVER: session.index === sessions[0].index ? 'false' : 'true',
    };
    console.log(`🔄 [Session ${session.index}] Starting process...`);
    const child = spawn(process.execPath, ['index.js'], { env, stdio: 'inherit' });
    children.set(session.index, child);
    child.on('error', error => {
        console.error(`❌ [Session ${session.index}] Process error: ${error.message}`);
    });
    child.on('exit', (code, signal) => {
        children.delete(session.index);
        if (shuttingDown) return;
        const delay = 5000;
        console.warn(`⚠️ [Session ${session.index}] Process stopped (code=${code}, signal=${signal || 'none'}). Restarting in ${delay / 1000}s...`);
        setTimeout(() => launch(session), delay).unref?.();
    });
}

function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`🛑 Multi-session manager received ${signal}; stopping child processes...`);
    for (const child of children.values()) child.kill(signal);
    setTimeout(() => process.exit(0), 8000).unref?.();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

for (const session of sessions) launch(session);
