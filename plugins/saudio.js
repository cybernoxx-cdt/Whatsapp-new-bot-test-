// GOD VOIP MD — Audio Sticker plugin (.saudio)
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import * as B from '@dnuzi/baileys';

const exec = promisify(execFile);
const get = n => B[n] ?? B.default?.[n] ?? B.default?.default?.[n];
const proto = get('proto');
const prepareWAMessageMedia = get('prepareWAMessageMedia');
const downloadContentFromMessage = get('downloadContentFromMessage');
const MAX_SEC = 25, SESSION_SEC = 60, MAX_BYTES = 80 * 1024 * 1024;
const DEFAULT_PACK = 'SHAVIYA XMD';
const STICKER_AUTHOR = '𝑺𝒉𝒂𝒗𝒊𝒚𝒂 𝑿𝑴𝑫 🥷';
const sessions = globalThis.__godVoipAudioStickerSessions ||= new Map();
const SCALE = 'scale=512:512:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000,setsar=1';

function sessionKey(ctx) {
    const m = ctx.m || {};
    return String(ctx.jid) + ':' + String(m.key?.participant || m.key?.participantAlt || m.key?.remoteJid || ctx.jid);
}
function clearSession(key) {
    const old = sessions.get(key);
    if (old?.timer) clearTimeout(old.timer);
    sessions.delete(key);
}
function unwrap(message) {
    let m = message || {};
    for (let i = 0; i < 8; i++) {
        const next = m.ephemeralMessage?.message || m.documentWithCaptionMessage?.message ||
            m.viewOnceMessage?.message || m.viewOnceMessageV2?.message;
        if (!next) break;
        m = next;
    }
    return m;
}
function findMedia(message) {
    const m = unwrap(message);
    const types = [['stickerMessage','sticker'],['imageMessage','image'],['videoMessage','video'],['audioMessage','audio']];
    for (const [key, kind] of types) {
        const body = m?.[key];
        if (body) return { kind, content: body, seconds: Number(body.seconds || 0), animated: Boolean(body.isAnimated || body.isLottie) };
    }
    return null;
}
function getMedia(ctx) {
    const own = findMedia(ctx.m?.message);
    if (own) return { ...own, own: true };
    const m = unwrap(ctx.m?.message);
    const info = m.extendedTextMessage?.contextInfo || m.imageMessage?.contextInfo ||
        m.videoMessage?.contextInfo || m.audioMessage?.contextInfo || m.stickerMessage?.contextInfo || null;
    if (!info?.quotedMessage) return null;
    const quoted = findMedia(info.quotedMessage);
    return quoted ? { ...quoted, own: false, stanzaId: info.stanzaId } : null;
}
async function readMedia(content, kind) {
    if (typeof downloadContentFromMessage !== 'function') throw new Error('@dnuzi/baileys downloadContentFromMessage export is missing.');
    const stream = await downloadContentFromMessage(content, kind);
    const chunks = []; let total = 0;
    for await (const chunk of stream) {
        total += chunk.length;
        if (total > MAX_BYTES) throw new Error('Media exceeds 80 MB.');
        chunks.push(Buffer.from(chunk));
    }
    const data = Buffer.concat(chunks);
    if (!data.length) throw new Error('Downloaded media is empty.');
    return data;
}
async function download(ctx, media) {
    if (media.own) return readMedia(media.content, media.kind);
    const cached = ctx.getCachedMessage?.(media.stanzaId);
    const original = cached?.message ? findMedia(cached.message) : null;
    try { return await readMedia(original?.content || media.content, original?.kind || media.kind); }
    catch (e) { throw new Error('Quoted media download failed: ' + e.message + '. Resend the media while bot is online and retry.'); }
}
async function ffmpeg(buffer, inExt, outExt, args) {
    const id = randomBytes(8).toString('hex');
    const input = path.join(os.tmpdir(), 'godvoip_saudio_' + id + '.' + inExt);
    const output = path.join(os.tmpdir(), 'godvoip_saudio_' + id + '.' + outExt);
    try {
        await fs.writeFile(input, buffer);
        await exec('ffmpeg', ['-hide_banner','-loglevel','error','-y','-i',input,...args,output], { maxBuffer: 32 * 1024 * 1024, timeout: 120000 });
        const data = await fs.readFile(output);
        if (!data.length) throw new Error('FFmpeg output is empty.');
        return data;
    } catch (e) {
        if (e.code === 'ENOENT') throw new Error('FFmpeg is not installed or not available in PATH.');
        throw new Error('FFmpeg: ' + e.message);
    } finally {
        await fs.unlink(input).catch(() => {});
        await fs.unlink(output).catch(() => {});
    }
}
async function videoWebp(buffer) {
    let data;
    for (const [fps,q] of [[10,50],[8,36],[6,24],[5,16]]) {
        data = await ffmpeg(buffer,'mp4','webp',['-t',String(MAX_SEC),'-vf','fps='+fps+','+SCALE,
            '-c:v','libwebp','-lossless','0','-compression_level','6','-q:v',String(q),'-loop','0','-preset','picture','-an','-vsync','0']);
        if (data.length <= 880 * 1024) break;
    }
    if (data.length > 1024 * 1024) throw new Error('Sticker is larger than WhatsApp upload limit.');
    return data;
}
async function imageWebp(buffer) {
    return ffmpeg(buffer,'img','webp',['-vf',SCALE,'-frames:v','1','-c:v','libwebp','-lossless','0','-q:v','80','-an']);
}
function exifData(pack, author) {
    const json = Buffer.from(JSON.stringify({
        'sticker-pack-id':'com.godvoipmd.audiosticker',
        'sticker-pack-name':String(pack || 'GOD VOIP MD').slice(0,128),
        'sticker-pack-publisher':String(author || 'GOD VOIP MD').slice(0,128),
        emojis:['🔊'],
    }));
    const head = Buffer.from([0x49,0x49,0x2a,0,8,0,0,0,1,0,0x41,0x57,7,0,0,0,0,0,0x16,0,0,0]);
    const exif = Buffer.concat([head,json]);
    exif.writeUInt32LE(json.length,14);
    return exif;
}
function addExif(webp, exif) {
    if (webp.toString('ascii',0,4) !== 'RIFF' || webp.toString('ascii',8,12) !== 'WEBP') throw new Error('Invalid WebP image.');
    const chunks = []; let pos = 12;
    while (pos + 8 <= webp.length) {
        const size = webp.readUInt32LE(pos+4), end = pos+8+size+(size&1);
        if (end > webp.length) throw new Error('Corrupt WebP chunk.');
        if (webp.toString('ascii',pos,pos+4) !== 'EXIF') chunks.push(webp.subarray(pos,end));
        pos = end;
    }
    if (pos !== webp.length) throw new Error('Malformed WebP data.');
    const chunk = Buffer.alloc(8+exif.length+(exif.length&1));
    chunk.write('EXIF',0,4,'ascii'); chunk.writeUInt32LE(exif.length,4); exif.copy(chunk,8);
    const body = Buffer.concat([webp.subarray(8,12),...chunks,chunk]);
    const head = Buffer.alloc(8); head.write('RIFF',0,4,'ascii'); head.writeUInt32LE(body.length,4);
    return Buffer.concat([head,body]);
}
async function makeSticker(buffer, kind, pack, author) {
    let data = buffer;
    if (kind === 'video') data = await videoWebp(buffer);
    else if (kind === 'image') data = await imageWebp(buffer);
    return addExif(data,exifData(pack,author));
}
async function makeAudio(sock, buffer, ext, seconds) {
    const data = await ffmpeg(buffer,ext,'ogg',['-vn','-map','0:a:0','-t',String(MAX_SEC),
        '-af','aresample=48000:async=1:first_pts=0','-c:a','libopus','-b:a','48k','-vbr','on',
        '-compression_level','10','-ac','1','-ar','48000','-application','voip','-avoid_negative_ts','make_zero','-f','ogg']);
    if (data.length < 200) throw new Error('Audio is empty or too short.');
    if (typeof prepareWAMessageMedia !== 'function') throw new Error('@dnuzi/baileys prepareWAMessageMedia export is missing.');
    const prepared = await prepareWAMessageMedia({audio:data,mimetype:'audio/ogg; codecs=opus',ptt:true},{upload:sock.waUploadToServer});
    const audio = prepared?.audioMessage;
    if (!audio) throw new Error('Baileys could not prepare audio upload.');
    audio.seconds = Math.max(1,Math.min(MAX_SEC,Math.round(seconds || 5)));
    audio.ptt = true; audio.mimetype = 'audio/ogg; codecs=opus';
    if (!audio.waveform?.length) audio.waveform = Buffer.from(Array.from({length:64},(_,i)=>18+data[(i*19+7)%data.length]%76));
    return audio;
}
function patchProto() {
    const M = proto?.Message;
    if (!M) throw new Error('Baileys protobuf Message schema is missing.');
    if (M.__godVoipAudioStickerPatched) return;
    if (!M.StickerMessage?.encode || !M.AudioMessage?.encode || !M.encode || !M.FutureProofMessage?.encode) throw new Error('This Baileys version does not expose the audio-sticker protobuf encoders.');
    const stickerEncode = M.StickerMessage.encode;
    M.StickerMessage.encode = function(message,writer) {
        const audio = message?.audioMessage;
        if (audio) delete message.audioMessage;
        const result = stickerEncode.call(this,message,writer);
        if (audio) { message.audioMessage=audio; M.AudioMessage.encode(audio,result.uint32(210).fork()).ldelim(); }
        return result;
    };
    if (typeof M.StickerMessage.fromObject === 'function') {
        const from = M.StickerMessage.fromObject;
        M.StickerMessage.fromObject = function(object) {
            const result = from.call(this,object);
            if (object?.audioMessage) result.audioMessage = M.AudioMessage?.fromObject ? M.AudioMessage.fromObject(object.audioMessage) : object.audioMessage;
            return result;
        };
    }
    const encode = M.encode;
    M.encode = function(message,writer) {
        const audioSticker = message?.audioStickerMessage;
        if (audioSticker) { delete message.stickerMessage; delete message.audioStickerMessage; }
        const result = encode.call(this,message,writer);
        if (audioSticker) { message.audioStickerMessage=audioSticker; M.FutureProofMessage.encode(audioSticker,result.uint32(1074).fork()).ldelim(); }
        return result;
    };
    if (typeof M.fromObject === 'function') {
        const from = M.fromObject;
        M.fromObject = function(object) {
            const result = from.call(this,object);
            if (object?.audioStickerMessage) {
                const inner = object.audioStickerMessage.message || object.audioStickerMessage;
                if (inner?.stickerMessage && object.audioStickerMessage.message?.stickerMessage?.audioMessage) inner.stickerMessage.audioMessage = object.audioStickerMessage.message.stickerMessage.audioMessage;
                result.audioStickerMessage = {message:inner}; delete result.stickerMessage;
                if (inner) Object.setPrototypeOf(result,inner);
            }
            return result;
        };
    }
    M.__godVoipAudioStickerPatched = true;
}
async function sendAudioSticker(sock,jid,sticker,animated,audio) {
    patchProto();
    const prepared = await prepareWAMessageMedia({sticker,isAnimated:Boolean(animated)},{upload:sock.waUploadToServer});
    if (!prepared?.stickerMessage) throw new Error('Baileys could not prepare sticker upload.');
    prepared.stickerMessage.isAnimated = Boolean(animated);
    prepared.stickerMessage.audioMessage = audio;
    await sock.relayMessage(jid,{__proto__:prepared,audioStickerMessage:{message:prepared},messageContextInfo:{messageSecret:randomBytes(32)}},{});
}
async function react(ctx,emoji) {
    try { await ctx.sock.sendMessage(ctx.jid,{react:{text:emoji,key:ctx.m.key}}); } catch {}
}

export default {
    name:'saudio',
    aliases:['audiosticker','soundsticker'],
    category:'fun',
    desc:'Create audio stickers from videos, photos and stickers',
    usage:'.saudio (video) | reply photo/sticker then reply audio/video | .saudio Pack Name | .saudio batal',
    async run(ctx) {
        const sock=ctx.sock, jid=ctx.jid, m=ctx.m, reply=ctx.reply;
        const arg=String(ctx.text || '').trim(), key=sessionKey(ctx), session=sessions.get(key);
        const command=(ctx.prefix || '.')+'saudio';
        if (/^(batal|cancel)$/i.test(arg)) {
            if (!session) return reply('ℹ️ No active Audio Sticker session.');
            clearSession(key); return reply('✅ Audio Sticker session cancelled.');
        }
        const media=getMedia(ctx);
        if (!media) return reply(
            '╭━━〔 🔊 AUDIO STICKER 〕━━╮\n\n' +
            '🎬 Video: send/reply with '+command+' to create a sticker with its audio.\n\n' +
            '🖼️ Photo/sticker: send/reply with '+command+', then reply to that media with audio/voice/video and '+command+'.\n\n' +
            '⏱️ Session: '+SESSION_SEC+' seconds\n🎵 Audio limit: '+MAX_SEC+' seconds\n' +
            '✏️ Custom pack: '+command+' Pack Name\n👑 Author: '+STICKER_AUTHOR+' (automatic)\n✖️ Cancel: '+command+' batal\n\n✦ GOD VOIP MD'
        );
        if (session && (media.kind==='audio' || media.kind==='video')) {
            await react(ctx,'⏳');
            try {
                const buffer=await download(ctx,media);
                const audio=await makeAudio(sock,buffer,media.kind==='video'?'mp4':'ogg',media.seconds);
                await sendAudioSticker(sock,jid,session.sticker,session.animated,audio);
                clearSession(key); await react(ctx,'✅'); return;
            } catch (e) { await react(ctx,'❌'); return reply('⚠️ Audio Sticker failed: '+e.message); }
        }
        if (media.kind==='audio') return reply('🖼️ Send/reply to a photo or sticker first with '+command+', then reply to the audio with '+command+'.');
        await react(ctx,'⏳');
        try {
            const pack=(arg.split('|')[0] || ctx.config?.stickerPack || DEFAULT_PACK).trim() || DEFAULT_PACK;
            // Keep the requested creator credit on every generated audio sticker.
            const author=STICKER_AUTHOR;
            const buffer=await download(ctx,media);
            const sticker=await makeSticker(buffer,media.kind,pack,author);
            const animated=media.kind==='video' || (media.kind==='sticker' && media.animated);
            if (media.kind==='video') {
                try {
                    const audio=await makeAudio(sock,buffer,'mp4',media.seconds);
                    await sendAudioSticker(sock,jid,sticker,true,audio);
                    await react(ctx,'✅'); return;
                } catch (e) {
                    if (!/does not contain any stream|matches no streams|Stream map.*matches no streams|Output file is empty/i.test(e.message)) throw e;
                }
            }
            clearSession(key);
            const expiresAt=Date.now()+SESSION_SEC*1000;
            const timer=setTimeout(async()=>{
                if (sessions.get(key)?.expiresAt!==expiresAt) return;
                sessions.delete(key);
                try { await sock.sendMessage(jid,{text:'⌛ Audio Sticker session expired. Send the photo/sticker again.'},{quoted:m}); } catch {}
            },SESSION_SEC*1000);
            timer.unref?.();
            sessions.set(key,{sticker,animated,timer,expiresAt});
            await react(ctx,'✅');
            return reply('╭━━〔 🔊 AUDIO STICKER SESSION 〕━━╮\n\n✅ Photo/sticker prepared.\n⏱️ Active for '+SESSION_SEC+' seconds.\n\nNow reply to the same photo/sticker with a Voice Note / audio / video and send '+command+'.\n✖️ Cancel: '+command+' batal\n\n✦ GOD VOIP MD');
        } catch (e) { await react(ctx,'❌'); return reply('⚠️ Audio Sticker failed: '+e.message); }
    },
};
