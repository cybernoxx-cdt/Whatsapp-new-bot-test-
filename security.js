import fs from 'node:fs';
import { spawn } from 'node:child_process';

/**
 * Defensive media validation only. This does not craft or send network packets
 * and does not attempt to exploit WhatsApp or client devices.
 */
export async function validateMediaFile(file, options = {}) {
  const maxBytes = options.maxBytes ?? 150 * 1024 * 1024;
  const maxDurationSeconds = options.maxDurationSeconds ?? 900;
  const ffprobe = options.ffprobe || 'ffprobe';

  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size <= 0) throw new Error('Media file is empty or not a regular file.');
  if (stat.size > maxBytes) throw new Error(`Media file exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB security limit.`);

  const result = await new Promise((resolve, reject) => {
    const child = spawn(ffprobe, [
      '-v', 'error',
      '-show_entries', 'format=format_name,duration:stream=codec_type,codec_name,width,height',
      '-of', 'json',
      file
    ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
    child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > 1024 * 1024) child.kill('SIGKILL'); });
    child.stderr.on('data', chunk => { stderr += chunk; if (stderr.length > 8192) stderr = stderr.slice(-8192); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error('Media container validation failed: ' + (stderr.trim().slice(0, 240) || 'invalid or unsupported media')));
      try { resolve(JSON.parse(stdout)); }
      catch { reject(new Error('Media metadata is malformed.')); }
    });
  });

  const streams = Array.isArray(result.streams) ? result.streams : [];
  const hasAudio = streams.some(stream => stream.codec_type === 'audio');
  const hasVideo = streams.some(stream => stream.codec_type === 'video');
  if (!hasAudio && !hasVideo) throw new Error('Media contains no audio or video stream.');

  const duration = Number(result.format?.duration || 0);
  if (Number.isFinite(duration) && duration > maxDurationSeconds) {
    throw new Error(`Media duration exceeds the ${Math.round(maxDurationSeconds / 60)} minute security limit.`);
  }

  for (const stream of streams.filter(item => item.codec_type === 'video')) {
    if ((stream.width || 0) > 3840 || (stream.height || 0) > 2160) {
      throw new Error('Video resolution exceeds the 4K security limit.');
    }
  }

  return { hasAudio, hasVideo, duration: Number.isFinite(duration) ? duration : 0, format: result.format?.format_name || 'unknown' };
}
