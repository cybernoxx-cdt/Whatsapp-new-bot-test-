// GOD VOIP MD - isolated multi-session process supervisor
// Supports legacy SESSION_ID and numbered SESSION_ID_1 ... SESSION_ID_10.

import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

const MAX_SESSIONS = Math.max(1, Math.min(10, Number(process.env.MAX_SESSIONS || 10)));
const baseNumber = process.env.BOT_NUMBER || process.env.OWNER_NUMBER || '94707085822';
const baseKey = process.env.SESSION_KEY || 'god-voip-md';
const sessions = [];
const seenSessionFingerprints = new Map();

for (let i = 1; i <= MAX_SESSIONS; i++) {
    const raw = process.env[`SESSION_ID_${i}`] || (i === 1 ? process.env.SESSION_ID : '');
    if (!String(raw || '').trim()) continue;
    const normalized = String(raw).normalize('NFKC').trim();
    const fingerprint = crypto.createHash('sha256').update(normalized).digest('hex');
    if (seenSessionFingerprints.has(fingerprint)) {
        console.error(`❌ [Session ${i}] Duplicate session export detected (same as SESSION_ID_${seenSessionFingerprints.get(fingerprint)}). Each slot must contain a different WhatsApp account's own session export; duplicate credentials can cause decrypt/connection conflicts.`);
        continue;
    }
    seenSessionFingerprints.set(fingerprint, i);
    sessions.push({
        index: i,
        raw: normalized,
        number: process.env[`BOT_NUMBER_${i}`] || baseNumber,
    });
}

if (!sessions.length) {
    console.error('❌ No session configured. Add SESSION_ID or SESSION_ID_1 GitHub Secret.');
    process.exit(1);
}

console.log(`╭─「 GOD VOIP MD MULTI-SESSION 」─
│ Configured sessions: ${sessions.length}/${MAX_SESSIONS}
│ Session slots: ${sessions.map(s => s.index).join(', ')}
│ Process isolation: enabled
╰───────────────────────────────`);

const children = new Map();
const status = new Map(sessions.map(s => [s.index, 'starting']));
const restartCounts = new Map(sessions.map(s => [s.index, 0]));
let shuttingDown = false;

function logSession(index, message) {
    console.log(`[Session ${index}] ${message}`);
}

function launch(session) {
    if (shuttingDown) return;
    const dir = path.resolve('sessions', `session-${session.index}`);
    const tmpDir = path.resolve('runtime', `session-${session.index}`, 'tmp');
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(tmpDir, { recursive: true });

    const env = {
        ...process.env,
        SESSION_ID: session.raw,
        SESSION_KEY: `${baseKey}-${session.index}`,
        SESSION_DIR: dir,
        TMP_DIR: tmpDir,
        BOT_NUMBER: session.number,
        SESSION_INDEX: String(session.index),
        DISABLE_SERVER: session.index === sessions[0].index ? 'false' : 'true',
    };

    logSession(session.index, 'Starting worker...');
    const child = spawn(process.execPath, ['index.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    children.set(session.index, child);
    status.set(session.index, 'starting');

    let stdoutBuffer = '';
    let stderrBuffer = '';
    const consume = (chunk, isError = false) => {
        const key = isError ? 'stderr' : 'stdout';
        let buffer = key === 'stderr' ? stderrBuffer + chunk.toString() : stdoutBuffer + chunk.toString();
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';
        if (key === 'stderr') stderrBuffer = buffer;
        else stdoutBuffer = buffer;
        for (const line of lines) {
            if (!line.trim()) continue;
            if (/\bConnected:/i.test(line)) status.set(session.index, 'connected');
            if (/VoIP listening/i.test(line)) status.set(session.index, 'online');
            if (/connection.*close|logged out|invalid.*session|No usable auth/i.test(line)) {
                if (status.get(session.index) !== 'online') status.set(session.index, 'reconnecting');
            }
            (isError ? console.error : console.log)(`[Session ${session.index}] ${line}`);
        }
    };

    child.stdout.on('data', chunk => consume(chunk, false));
    child.stderr.on('data', chunk => consume(chunk, true));
    child.on('error', error => logSession(session.index, `Worker process error: ${error.message}`));
    child.on('exit', (code, signal) => {
        children.delete(session.index);
        status.set(session.index, 'stopped');
        if (shuttingDown) return;
        const count = (restartCounts.get(session.index) || 0) + 1;
        restartCounts.set(session.index, count);
        const delay = Math.min(60000, 5000 * (2 ** Math.min(count - 1, 4)));
        logSession(session.index, `Worker exited (code=${code}, signal=${signal || 'none'}); restart #${count} in ${Math.ceil(delay / 1000)}s`);
        setTimeout(() => launch(session), delay);
    });
}

function reportStatus() {
    const counts = { starting: 0, connected: 0, online: 0, reconnecting: 0, stopped: 0 };
    for (const value of status.values()) counts[value] = (counts[value] || 0) + 1;
    console.log(`📊 Sessions: ${sessions.length} configured | ${counts.online} VoIP-ready | ${counts.connected} WhatsApp-connected | ${counts.reconnecting} reconnecting | ${counts.starting} starting | ${counts.stopped} stopped`);
}
const statusTimer = setInterval(reportStatus, 60000);
statusTimer.unref();

function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(statusTimer);
    console.log(`🛑 Multi-session manager received ${signal}; stopping all workers...`);
    for (const child of children.values()) child.kill(signal);
    setTimeout(() => process.exit(0), 8000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

for (const session of sessions) launch(session);
reportStatus();
