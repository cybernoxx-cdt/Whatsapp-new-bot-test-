import mongoose from 'mongoose';
import crypto from 'crypto';
import path from 'path';

const schema = new mongoose.Schema({
  owner: { type: String, index: true },
  pack: { type: String, index: true },
  kind: { type: String, enum: ['video', 'audio', 'image', 'document'], required: true },
  name: { type: String, required: true },
  mime: { type: String, required: true },
  size: { type: Number, default: 0 },
  url: { type: String, required: true },
  storageKey: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now, index: true }
}, { collection: 'media_assets', autoIndex: false });

const MediaAsset = mongoose.models.MediaAsset || mongoose.model('MediaAsset', schema);

function cleanName(value) {
  return String(value || 'media').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 90) || 'media';
}

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
  let presign;
  try { presign = JSON.parse(presignText); } catch { throw new Error('Upload host returned invalid presign JSON.'); }
  if (!presignResponse.ok) throw new Error(presign.error || 'Presign failed: HTTP ' + presignResponse.status);
  if (!presign.uploadUrl || !presign.url || !presign.key) throw new Error(presign.error || 'Upload host did not return uploadUrl, url and key.');

  const putResponse = await fetch(presign.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': presign.contentType || type },
    body: buffer,
    signal: timeout()
  });
  if (!putResponse.ok) throw new Error('Media upload failed: HTTP ' + putResponse.status);

  // Finalize the object before publishing its URL. Some hosts return a URL
  // at presign time, but keep it private/unavailable until /complete succeeds.
  let completed = null;
  let completionError = null;
  try {
    const completeResponse = await fetch(base + '/api/complete', {
      method: 'POST',
      headers,
      body: JSON.stringify({ key: presign.key, name: filename, expires }),
      signal: timeout()
    });
    const completeText = await completeResponse.text();
    try { completed = completeText ? JSON.parse(completeText) : {}; } catch { completed = {}; }
    if (!completeResponse.ok) {
      completionError = completed?.error || `HTTP ${completeResponse.status}`;
    }
  } catch (error) {
    completionError = error.message;
  }

  // Prefer a canonical public URL returned by completion; otherwise use the
  // exact URL from presign. Never rewrite or reconstruct a host-issued URL.
  const publicUrl = completed?.url || completed?.publicUrl || completed?.public_url || presign.url;
  if (!String(publicUrl || '').toLowerCase().startsWith('https://')) {
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
        headers: { 'User-Agent': 'GOD-VOIP-MD/1.0', Range: 'bytes=0-0' },
        signal: timeout()
      });
      lastStatus = `HTTP ${check.status}`;
      const contentType = (check.headers.get('content-type') || '').toLowerCase();
      isPublic = check.ok && !contentType.includes('text/html');
      try { await check.body?.cancel(); } catch {}
      if (isPublic) break;
    } catch (error) {
      lastStatus = error.message;
    }
    if (attempt < 5) await new Promise(resolve => setTimeout(resolve, 1500 * attempt));
  }

  if (!isPublic) {
    const detail = completionError ? `; completion: ${completionError}` : '';
    throw new Error(`DNUZ upload finished but its URL is not publicly readable (${lastStatus})${detail}. Check the DNUZ API key, public-file permission and host status; no broken URL was saved.`);
  }

  return { url: publicUrl, key: presign.key };
}

export async function saveMediaAsset({ owner, pack, kind, name, mime, size, url, storageKey }) {
  if (mongoose.connection.readyState !== 1) throw new Error('MongoDB connection is required for URL metadata and media packs.');
  if (!/^https:\/\//i.test(String(url))) throw new Error('Only the HTTPS URL returned by the upload host can be saved.');
  return MediaAsset.create({ owner, pack, kind, name, mime, size, url, storageKey });
}

export async function getPackMedia(pack, kind) {
  if (mongoose.connection.readyState !== 1) throw new Error('MongoDB connection is required for URL metadata and media packs.');
  // Never return legacy gridfs:// or local-storage references to the call engine.
  return MediaAsset.findOne({
    pack: String(pack).trim().toLowerCase(),
    kind,
    url: { $regex: '^https://', $options: 'i' }
  }).sort({ createdAt: -1 }).lean();
}

export async function listPacks() {
  if (mongoose.connection.readyState !== 1) throw new Error('MongoDB connection is required for URL metadata and media packs.');
  return MediaAsset.aggregate([
    { $match: { url: { $regex: '^https://', $options: 'i' } } },
    { $group: { _id: '$pack', videos: { $sum: { $cond: [{ $eq: ['$kind', 'video'] }, 1, 0] } }, audios: { $sum: { $cond: [{ $eq: ['$kind', 'audio'] }, 1, 0] } }, total: { $sum: 1 } } },
    { $sort: { _id: 1 } }
  ]);
}

export async function listPackItems(pack) {
  if (mongoose.connection.readyState !== 1) throw new Error('MongoDB connection is required for URL metadata and media packs.');
  return MediaAsset.find({
    pack: String(pack).trim().toLowerCase(),
    url: { $regex: '^https://', $options: 'i' }
  }).sort({ createdAt: -1 }).limit(20).lean();
}

export function mediaKindFromMime(mime) {
  if (/^video\//i.test(mime)) return 'video';
  if (/^audio\//i.test(mime)) return 'audio';
  if (/^image\//i.test(mime)) return 'image';
  return 'document';
}

export function randomUploadName(original, mime) {
  const ext = path.extname(original || '') || (mime.includes('/') ? '.' + mime.split('/')[1].split(';')[0] : '.bin');
  return crypto.randomBytes(5).toString('hex') + ext.slice(0, 12);
}
