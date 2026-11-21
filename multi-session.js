// GOD VOIP MD - isolated multi-session process supervisor
// Supports legacy SESSION_ID and numbered SESSION_ID_1 ... SESSION_ID_10.

import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

const MAX_SESSIONS = Math.max(1, Math.min(10, Number(process.env.MAX_SESSIONS || 10)));
const baseNumber = process.env.BOT_NUMBER || process.env.OWNER_NUMBER || '94707085822';
if (!baseNumber) { console.error('❌ BOT_NUMBER (or OWNER_NUMBER) is not set. Set it as a GitHub Secret if you want to override the default.'); process.exit(1); }
const baseKey = process.env.SESSION_KEY || 'god-voip-md';
const sessions = [];
const seenSessionFingerprints = new Map();

// Explicit slot mapping (C4): slot i uses SESSION_ID_i and BOT_NUMBER_i,
// except slot 1 which also accepts the legacy SESSION_ID / BOT_NUMBER.
// Previously the loop read SESSION_ID_{i-1} for slot i, so SESSION_ID_10
// was never read and slot 2 paired SESSION_ID_1 with BOT_NUMBER_2.
const SLOT_DEFS = Array.from({ length: 10 }, (_, k) => {
    const i = k + 1;
    return {
        index: i,
        sessionEnv: i === 1 ? 'SESSION_ID_1' : `SESSION_ID_${i}`,
        legacySessionEnv: i === 1 ? 'SESSION_ID' : null,
        numberEnv: i === 1 ? 'BOT_NUMBER_1' : `BOT_NUMBER_${i}`,
        legacyNumberEnv: i === 1 ? 'BOT_NUMBER' : null,
    };
});
for (const slot of SLOT_DEFS.slice(0, MAX_SESSIONS)) {
    const i = slot.index;
    const raw = (process.env[slot.sessionEnv] || (slot.legacySessionEnv ? process.env[slot.legacySessionEnv] : '') || '');
    if (!String(raw || '').trim()) continue;
    const normalized = String(raw).normalize('NFKC').trim();
    const fingerprint = crypto.createHash('sha256').update(normalized).digest('hex');
    if (seenSessionFingerprints.has(fingerprint)) {
        const dupSlot = seenSessionFingerprints.get(fingerprint);
        console.error(`❌ [Session ${i}] Duplicate session export detected (same as ${dupSlot === 1 ? 'SESSION_ID_1 / SESSION_ID' : 'SESSION_ID_' + dupSlot}). Each slot must contain a different WhatsApp account's own session export; duplicate credentials can cause decrypt/connection conflicts.`);
        continue;
    }
    seenSessionFingerprints.set(fingerprint, i);
    sessions.push({
        index: i,
        raw: normalized,
        number: process.env[slot.numberEnv] || (slot.legacyNumberEnv ? process.env[slot.legacyNumberEnv] : '') || baseNumber,
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
const terminalReason = new Map();
const startedAt = new Map();
let shuttingDown = false;

function logSession(index, message) {
    console.log(`[Session ${index}] ${message}`);
}

function launch(session) {
    if (shuttingDown || children.has(session.index) || terminalReason.has(session.index)) return;
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
    startedAt.set(session.index, Date.now());
    status.set(session.index, 'starting');

    let stdoutBuffer = '';
    let stderrBuffer = '';
    let authBlocked = false;
    let authReason = '';
    const consume = (chunk, isError = false) => {
        const key = isError ? 'stderr' : 'stdout';
        let buffer = key === 'stderr' ? stderrBuffer + chunk.toString() : stdoutBuffer + chunk.toString();
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';
        if (key === 'stderr') stderrBuffer = buffer;
        else stdoutBuffer = buffer;
        for (const line of lines) {
            if (!line.trim()) continue;
            if (/Logged out|loggedOut|statusCode.?401|configured session is invalid|No usable auth session found|registered=false/i.test(line)) {
                authBlocked = true;
                authReason = /Logged out|loggedOut|statusCode.?401/i.test(line) ? 'WhatsApp logged this device out' : 'Session credentials are invalid or unavailable';
                status.set(session.index, 'logged_out');
            }
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
        if (authBlocked) {
            status.set(session.index, 'logged_out');
            terminalReason.set(session.index, authReason);
            logSession(session.index, '⛔ Restart disabled: ' + authReason + '. Replace ' + (session.index === 1 ? 'SESSION_ID_1 / SESSION_ID' : 'SESSION_ID_' + session.index) + ' with a freshly linked session export.');
            return;
        }
        const uptime = Date.now() - (startedAt.get(session.index) || Date.now());
        const previous = restartCounts.get(session.index) || 0;
        const count = uptime >= 300000 ? 1 : previous + 1;
        restartCounts.set(session.index, count);
        const delay = Math.min(60000, 5000 * (2 ** Math.min(count - 1, 4)));
        logSession(session.index, `Worker exited (code=${code}, signal=${signal || 'none'}); restart #${count} in ${Math.ceil(delay / 1000)}s`);
        setTimeout(() => launch(session), delay);
    });
}

function reportStatus() {
    const counts = { starting: 0, connected: 0, online: 0, reconnecting: 0, stopped: 0, logged_out: 0 };
    for (const value of status.values()) counts[value] = (counts[value] || 0) + 1;
    console.log(`📊 Sessions: ${sessions.length} configured | ${counts.online} VoIP-ready | ${counts.connected} WhatsApp-connected | ${counts.reconnecting} reconnecting | ${counts.starting} starting | ${counts.logged_out} logged-out/invalid | ${counts.stopped} stopped`);
    for (const [index, reason] of terminalReason) logSession(index, 'Action required: ' + reason);
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
