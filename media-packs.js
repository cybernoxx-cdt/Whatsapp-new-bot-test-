// Direct DNUZ upload only. No media bytes are written to MongoDB or GridFS.
export async function uploadToUrl(buffer, name, type = 'application/octet-stream', expires = 0) {
  const base = (process.env.TOURL_BASE_URL || 'https://db.dnuz.top').replace(/\/$/, '');
  const apiKey = process.env.TOURL_API_KEY;
  if (!apiKey || apiKey === 'YOUR_API_KEY') throw new Error('TOURL_API_KEY GitHub Secret එක set කරලා නැහැ.');
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('Upload buffer is empty.');
  if (buffer.length > 64 * 1024 * 1024) throw new Error('Media exceeds the 64 MB upload limit.');

  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey };
  const filename = cleanName(name);
  const timeout = () => AbortSignal.timeout(30000);
  const presignResponse = await fetch(base + '/api/presign', {
    method: 'POST', headers,
    body: JSON.stringify({ name: filename, size: buffer.length, type }),
    signal: timeout()
  });
  const presignText = await presignResponse.text();
  let presignBody;
  try { presignBody = JSON.parse(presignText); } catch { throw new Error('Upload host returned invalid presign JSON.'); }
  const unwrap = (value) => {
    let current = value;
    for (let i = 0; i < 4 && current && typeof current === 'object'; i++) {
      const nested = current.data || current.result || current.file;
      if (!nested || typeof nested !== 'object') break;
      current = nested;
    }
    return current || {};
  };
  const presign = unwrap(presignBody);
  if (!presignResponse.ok) throw new Error(presignBody.error || presign.error || 'Presign failed: HTTP ' + presignResponse.status);

  // Accept documented camelCase and common snake_case response fields.
  const uploadUrl = presign.uploadUrl || presign.upload_url || presign.signedUrl || presign.signed_url;
  const presignUrl = presign.url || presign.publicUrl || presign.public_url || presign.downloadUrl || presign.download_url;
  const objectKey = presign.key || presign.storageKey || presign.storage_key;
  const uploadContentType = presign.contentType || presign.content_type || type;
  if (!uploadUrl || !objectKey || !/^https:\/\//i.test(uploadUrl)) {
    throw new Error(presignBody.error || 'Upload host did not return a valid HTTPS upload URL and object key.');
  }

  const putResponse = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': uploadContentType },
    body: buffer,
    signal: timeout()
  });
  if (!putResponse.ok) throw new Error('Media upload failed: HTTP ' + putResponse.status);

  // Finalize the object before publishing its URL. Some hosts return a URL
  // at presign time, but keep it private/unavailable until /complete succeeds.
  const completeResponse = await fetch(base + '/api/complete', {
    method: 'POST',
    headers,
    body: JSON.stringify({ key: objectKey, name: filename, expires }),
    signal: timeout()
  });
  const completeText = await completeResponse.text();
  let completedBody = {};
  try { completedBody = completeText ? JSON.parse(completeText) : {}; } catch {
    if (completeResponse.ok) throw new Error('Upload host returned invalid completion JSON.');
  }
  if (!completeResponse.ok) {
    throw new Error(completedBody.error || `Upload completion failed: HTTP ${completeResponse.status}`);
  }

  // Prefer a canonical public URL returned by completion; otherwise use the
  // exact public URL from presign. Never rewrite or reconstruct host-issued URLs.
  const completeData = unwrap(completedBody);
  const publicUrl = completeData.url || completeData.publicUrl || completeData.public_url ||
    completeData.downloadUrl || completeData.download_url || completeData.fileUrl ||
    completeData.file_url || completeData.directUrl || completeData.direct_url ||
    presignUrl;
  if (!/^https:\/\//i.test(String(publicUrl || ''))) {
    throw new Error('Upload host did not return a valid public HTTPS media URL.');
  }

  // Verify anonymous GET access before saving the URL in MongoDB. A successful
  // PUT only proves storage upload; it does not prove the object is publicly
  // readable by the call runner.
  let lastStatus = 'no response';
  let isPublic = false;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const check = await fetch(publicUrl, {
        method: 'GET',
        redirect: 'follow',
        headers: { Accept: '*/*' },
        signal: timeout()
      });
      lastStatus = `HTTP ${check.status}`;
      const contentType = (check.headers.get('content-type') || '').toLowerCase();
      isPublic = check.ok && !contentType.includes('text/html') &&
        !contentType.includes('application/json');
      try { await check.body?.cancel(); } catch {}
      if (isPublic) break;
    } catch (error) {
      lastStatus = error.message;
    }
    if (attempt < 5) await new Promise(resolve => setTimeout(resolve, 1500 * attempt));
  }

  if (!isPublic) {
    throw new Error(`DNUZ upload finished but its URL is not publicly readable (${lastStatus}). The host may still be denying anonymous downloads; check the DNUZ public-file permission and host settings. No broken URL was saved.`);
  }

  return { url: publicUrl, key: objectKey };
}

