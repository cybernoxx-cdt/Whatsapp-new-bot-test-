// Shared menu media helpers. URLs are selected randomly for each menu/alive call.
export const MENU_IMAGES = [
    "https://file.dnuz.top/z2k991.jpeg",
    "https://file.dnuz.top/guaiz4.jpeg",
    "https://file.dnuz.top/yc2r9m.jpeg",
    "https://file.dnuz.top/zux9od.jpeg",
    "https://file.dnuz.top/7ynqki.jpeg",
    "https://file.dnuz.top/xo66lf.jpeg",
    "https://file.dnuz.top/easvkc.jpeg"
];
export const MENU_GIF_URL = "https://file.dnuz.top/jz91ua.mp4";

export function randomMenuImage() {
    return MENU_IMAGES[Math.floor(Math.random() * MENU_IMAGES.length)];
}

export async function sendMenuMedia(sock, jid, m, caption, { gif = true } = {}) {
    if (gif) {
        try {
            await sock.sendMessage(jid, {
                video: { url: MENU_GIF_URL },
                gifPlayback: true,
                mimetype: 'video/mp4',
                caption: '✨ GOD VOIP MD',
            }, { quoted: m });
        } catch (error) {
            console.log('[MENU GIF] Send failed:', error?.message || error);
        }
    }
    try {
        await sock.sendMessage(jid, { image: { url: randomMenuImage() }, caption }, { quoted: m });
    } catch (error) {
        console.log('[MENU IMAGE] Send failed:', error?.message || error);
        await sock.sendMessage(jid, { text: caption }, { quoted: m });
    }
}
