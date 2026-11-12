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

export async function uploadToUrl(buffer, name, type = 'application/octet-stream', expires = 0) {
  const base = (process.env.TOURL_BASE_URL || 'https://db.dnuz.top').replace(/\/$/, '');
  const key = process.env.TOURL_API_KEY;
  if (!key) throw new Error('TOURL_API_KEY secret එක set කරලා නැහැ.');
  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key };
  const presignRes = await fetch(base + '/api/presign', {
    method: 'POST', headers,
    body: JSON.stringify({ name: cleanName(name), size: buffer.length, type })
  });
  if (!presignRes.ok) throw new Error('Presign failed: HTTP ' + presignRes.status);
  const presign = await presignRes.json();
  if (!presign.uploadUrl || !presign.url || !presign.key) throw new Error(presign.error || 'Presign response incomplete');
  const putRes = await fetch(presign.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': presign.contentType || type },
    body: buffer
  });
  if (!putRes.ok) throw new Error('Media upload failed: HTTP ' + putRes.status);
  const completeRes = await fetch(base + '/api/complete', {
    method: 'POST', headers,
    body: JSON.stringify({ key: presign.key, name: cleanName(name), expires })
  });
  if (!completeRes.ok) throw new Error('Upload complete failed: HTTP ' + completeRes.status);
  return { url: presign.url, key: presign.key };
}

export async function saveMediaAsset({ owner, pack, kind, name, mime, size, url, storageKey }) {
  if (mongoose.connection.readyState !== 1) throw new Error('MongoDB connected නැහැ. MONGODB_URI පරීක්ෂා කරන්න.');
  return MediaAsset.create({ owner, pack, kind, name, mime, size, url, storageKey });
}

export async function getPackMedia(pack, kind) {
  if (mongoose.connection.readyState !== 1) throw new Error('MongoDB connected නැහැ.');
  return MediaAsset.findOne({ pack: String(pack).trim().toLowerCase(), kind }).sort({ createdAt: -1 }).lean();
}

export async function listPacks() {
  if (mongoose.connection.readyState !== 1) throw new Error('MongoDB connected නැහැ.');
  return MediaAsset.aggregate([
    { $group: { _id: '$pack', videos: { $sum: { $cond: [{ $eq: ['$kind', 'video'] }, 1, 0] } }, audios: { $sum: { $cond: [{ $eq: ['$kind', 'audio'] }, 1, 0] } }, total: { $sum: 1 } } },
    { $sort: { _id: 1 } }
  ]);
}

export async function listPackItems(pack) {
  if (mongoose.connection.readyState !== 1) throw new Error('MongoDB connected නැහැ.');
  return MediaAsset.find({ pack: String(pack).trim().toLowerCase() }).sort({ createdAt: -1 }).limit(20).lean();
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
