// Direct DNUZ upload only. No media bytes or URL records are stored by this bot.
function cleanName(value) {
  const base = String(value || 'media.bin').split(/[\\/]/).pop();
  return base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'media.bin';
}

export async function uploadToUrl(buffer, name, type = 'application/octet-stream', expires = 0) {
  const configuredBase = process.env.TOURL_BASE_URL || 'https://db.dnuz.top';
  const base = configuredBase.endsWith('/') ? configuredBase.slice(0, -1) : configuredBase;
  const apiKey = process.env.TOURL_API_KEY;
  if (!apiKey || apiKey === 'YOUR_API_KEY') throw new Error('TOURL_API_KEY GitHub Secret එක set කරලා නැහැ.');
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('Upload buffer is empty.');
  if (buffer.length > 64 * 1024 * 1024) throw new Error('Media exceeds the 64 MB upload limit.');

  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey };
  const filename = cleanName(name);
  const timeout = () => AbortSignal.timeout(60000);

  // Follow the DNUZ API contract exactly: presign -> signed PUT -> complete -> p.url.
  const presignResponse = await fetch(base + '/api/presign', {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: filename, size: buffer.length, type }),
    signal: timeout()
  });
  const presignText = await presignResponse.text();
  let p;
  try { p = JSON.parse(presignText); }
  catch { throw new Error('DNUZ /api/presign returned invalid JSON.'); }
  if (!presignResponse.ok) throw new Error(p?.error || 'DNUZ presign failed: HTTP ' + presignResponse.status);
  if (!p?.uploadUrl || !p?.url) throw new Error(p?.error || 'DNUZ presign response must include uploadUrl and url.');
  const isHttpsUrl = (value) => { try { return new URL(value).protocol === 'https:'; } catch { return false; } };
  if (!isHttpsUrl(p.uploadUrl) || !isHttpsUrl(p.url)) {
    throw new Error('DNUZ returned an invalid HTTPS upload or public URL.');
  }

  const putResponse = await fetch(p.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': p.contentType || type },
    body: buffer,
    signal: timeout()
  });
  if (!putResponse.ok) throw new Error('DNUZ media PUT failed: HTTP ' + putResponse.status);

  // /api/complete is an optional library/lifetime operation in the supplied
  // DNUZ example. Await it so the link is not handed out before it finishes,
  // but do not discard p.url if this optional operation is unavailable.
  try {
    const completeResponse = await fetch(base + '/api/complete', {
      method: 'POST',
      headers,
      body: JSON.stringify({ key: p.key, name: filename, expires }),
      signal: timeout()
    });
    if (!completeResponse.ok) {
      const detail = (await completeResponse.text()).slice(0, 300);
      console.warn('[TOURL] Optional /api/complete returned HTTP', completeResponse.status, detail);
    }
  } catch (error) {
    console.warn('[TOURL] Optional /api/complete unavailable:', error.message);
  }

  // Check the exact p.url that the documented DNUZ helper returns, using
  // the same public-download headers as the call downloader.
  let lastStatus = 'no response';
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const check = await fetch(p.url, {
        method: 'GET',
        redirect: 'follow',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
          'Accept': '*/*'
        },
        signal: timeout()
      });
      lastStatus = 'HTTP ' + check.status;
      const contentType = (check.headers.get('content-type') || '').toLowerCase();
      const valid = check.ok && !contentType.includes('text/html') &&
        !contentType.includes('application/json');
      try { await check.body?.cancel(); } catch {}
      if (valid) return { url: p.url, key: p.key || null };
    } catch (error) {
      lastStatus = error.message;
    }
    if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 1200 * attempt));
  }

  throw new Error('DNUZ upload completed, but the exact p.url is not publicly downloadable (' + lastStatus + '). The DNUZ host must allow anonymous GET access to this file; .tourl will not return a broken link.');
}
