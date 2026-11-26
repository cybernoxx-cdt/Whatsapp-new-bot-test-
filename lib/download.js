// Shared streaming downloader (Q4, P2): streams straight to disk instead
// of buffering whole files in RAM. Never sends synthetic Origin/Referer
// headers (some object-storage/CDN hosts reject them with 403).
import fs from 'node:fs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export async function downloadToFile(url, file, { maxBytes = 250 * 1024 * 1024, timeoutMs = 60000, headers = {} } = {}) {
    const response = await fetch(url, {
        redirect: 'follow',
        headers: { 'User-Agent': UA, Accept: '*/*', ...headers },
        signal: AbortSignal.timeout(timeoutMs),
    });
    if ([404, 410].includes(response.status)) {
        throw Object.assign(new Error(`HTTP ${response.status} - media link was not found or has expired`), { permanent: true });
    }
    // 401/403 can be caused by host-side hotlink or user-agent filtering.
    // Keep them retryable so media-convert.js can try its alternate request
    // headers (browser, mobile, Range, and curl-style) before giving up.
    if ([401, 403].includes(response.status)) {
        throw new Error(`HTTP ${response.status} - media host denied this request`);
    }
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('text/html')) {
        throw Object.assign(new Error('host returned an HTML page instead of a media file'), { permanent: true });
    }
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > maxBytes) throw Object.assign(new Error('file larger than the size limit'), { permanent: true });
    if (!response.body) throw new Error('empty response body');
    const tempFile = file + '.part';
    const out = fs.createWriteStream(tempFile);
    let total = 0;
    try {
        const reader = response.body.getReader();
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.length;
            if (total > maxBytes) throw Object.assign(new Error('file larger than the size limit'), { permanent: true });
            if (!out.write(Buffer.from(value))) await new Promise(r => out.once('drain', r));
        }
        await new Promise((res, rej) => { out.end(res); out.on('error', rej); });
        if (!total) throw new Error('empty response');
        fs.renameSync(tempFile, file);
    } catch (e) {
        try { fs.rmSync(tempFile, { force: true }); } catch {}
        throw e;
    }
}
