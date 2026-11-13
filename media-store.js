import fs from 'node:fs';
import path from 'node:path';

const DIR = path.resolve('./tmp');
const META = path.join(DIR, 'latest-call-media.json');

const EXTENSIONS = {
  'audio/ogg': '.ogg',
  'audio/opus': '.opus',
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/wav': '.wav',
  'audio/mp4': '.m4a',
  'video/mp4': '.mp4',
  'video/3gpp': '.3gp',
  'image/jpeg': '.jpg',
  'image/png': '.png',
};

export function saveLatestCallMedia(buffer, mime = 'application/octet-stream', name = 'whatsapp-media') {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error('Media buffer is empty.');
  if (buffer.length > 150 * 1024 * 1024) throw new Error('Media exceeds the 150 MB local limit.');
  fs.mkdirSync(DIR, { recursive: true });

  const cleanMime = String(mime).split(';')[0].trim().toLowerCase();
  const suppliedExt = path.extname(String(name)).toLowerCase();
  const safeExt = /^\.[a-z0-9]{1,8}$/.test(suppliedExt) ? suppliedExt : '.bin';
  const ext = EXTENSIONS[cleanMime] || safeExt;
  const file = path.join(DIR, 'latest-call-media' + ext);
  const temp = file + '.part';
  fs.writeFileSync(temp, buffer);
  fs.renameSync(temp, file);

  // Remove the previous latest media file, keeping only one active call source.
  for (const entry of fs.readdirSync(DIR)) {
    if (entry.startsWith('latest-call-media') && entry !== path.basename(file) && entry !== 'latest-call-media.json') {
      try { fs.rmSync(path.join(DIR, entry), { force: true }); } catch {}
    }
    if (entry.startsWith('latest-call-media') && entry.endsWith('.part')) {
      try { fs.rmSync(path.join(DIR, entry), { force: true }); } catch {}
    }
  }

  const metadata = {
    file,
    mime: cleanMime,
    name: String(name).slice(0, 160),
    size: buffer.length,
    savedAt: new Date().toISOString(),
  };
  const metaTemp = META + '.part';
  fs.writeFileSync(metaTemp, JSON.stringify(metadata, null, 2));
  fs.renameSync(metaTemp, META);
  return metadata;
}

export function getLatestCallMedia() {
  try {
    const metadata = JSON.parse(fs.readFileSync(META, 'utf8'));
    if (!metadata.file) return null;
    const resolved = path.resolve(metadata.file);
    if (!resolved.startsWith(DIR + path.sep)) return null;
    if (!fs.existsSync(resolved)) return null;
    const stat = fs.statSync(resolved);
    if (!stat.isFile() || stat.size <= 0) return null;
    return { ...metadata, file: resolved, size: stat.size };
  } catch {
    return null;
  }
}
