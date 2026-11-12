import mongoose from 'mongoose';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { Readable } from 'stream';

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
function gridBucket() {
  if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) throw new Error('MongoDB is not connected');
  return new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'media_files' });
}
export async function saveMediaToGridFS(buffer, filename, contentType) {
  const id = new mongoose.mongo.ObjectId();
  await new Promise((resolve, reject) => {
    const stream = gridBucket().openUploadStreamWithId(id, filename, { metadata: { contentType } });
    stream.once('error', reject); stream.once('finish', resolve); Readable.from(buffer).pipe(stream);
  });
  return { url: 'gridfs://' + id.toString(), key: id.toString() };
}
export async function restoreMediaFromGridFS(id, destination) {
  const objectId = new mongoose.mongo.ObjectId(String(id).replace(/^gridfs:\/\//, ''));
  await new Promise((resolve, reject) => {
    const chunks = []; const stream = gridBucket().openDownloadStream(objectId);
    stream.on('data', chunk => chunks.push(chunk));
    stream.once('error', reject);
    stream.once('end', () => { try { fs.writeFileSync(destination, Buffer.concat(chunks)); resolve(); } catch (e) { reject(e); } });
  });
}

function cleanName(value) {
  return String(value || 'media').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 90) || 'media';
}

// DNUZ public direct-media uploader using /api/presign -> PUT -> /api/complete.
export async function uploadToUrl(buffer, name, type = 'application/octet-stream', expires = 0) {
  const base = (process.env.TOURL_BASE_URL || 'https://db.dnuz.top').replace(/\/$/, '');
  const key = process.env.TOURL_API_KEY;
  if (!key) throw new Error('TOURL_API_KEY secret එක set කරලා නැහැ.');

  const headers = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + key
  };
  const filename = cleanName(name);
  const timeout = () => AbortSignal.timeout(30000);

  const presignRes = await fetch(base + '/api/presign', {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: filename, size: buffer.length, type }),
    signal: timeout()
  });
  if (!presignRes.ok) throw new Error('Presign failed: HTTP ' + presignRes.status);
  const presign = await presignRes.json();
  if (!presign.uploadUrl || !presign.url || !presign.key) {
    throw new Error(presign.error || 'Presign response incomplete');
  }

  const putRes = await fetch(presign.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': presign.contentType || type },
    body: buffer,
    signal: timeout()
  });
  if (!putRes.ok) throw new Error('Upload failed: HTTP ' + putRes.status);

  // /complete is optional library registration; preserve the public URL if it fails.
  fetch(base + '/api/complete', {
    method: 'POST',
    headers,
    body: JSON.stringify({ key: presign.key, name: filename, expires }),
    signal: timeout()
  }).catch(error => console.warn('[TOURL] Optional complete request failed:', error.message));

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