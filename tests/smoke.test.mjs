// Smoke tests (Q2) — run with: npm test
// These check pure helpers without connecting to WhatsApp.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unwrapMessage, containsViewOnce } from '../lib/unwrap.js';
import { isPrivateOrReservedHostPublic as isPrivateOrReservedHost } from '../plugins/cinesubz.js';

test('unwrapMessage follows ephemeral + view-once wrappers', () => {
    const inner = { conversation: 'hi' };
    const wrapped = { ephemeralMessage: { message: { viewOnceMessage: { message: inner } } } };
    assert.equal(unwrapMessage(wrapped), inner);
});

test('containsViewOnce detects nested view-once messages', () => {
    assert.equal(containsViewOnce({ viewOnceMessageV2: { message: {} } }), true);
    assert.equal(containsViewOnce({ conversation: 'hello' }), false);
});

test('isPrivateOrReservedHost rejects private and loopback hosts', () => {
    for (const host of ['localhost', '127.0.0.1', '10.0.0.5', '192.168.1.1', '172.16.0.9', '169.254.1.2', '::1']) {
        assert.equal(isPrivateOrReservedHost(host), true, host);
    }
    assert.equal(isPrivateOrReservedHost('example.com'), false);
    assert.equal(isPrivateOrReservedHost('8.8.8.8'), false);
});
