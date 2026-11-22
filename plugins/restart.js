// GOD VOIP MD — owner-only full bot restart
// In GitHub Actions, signal the multi-session supervisor so it gracefully
// stops every WhatsApp worker. The workflow's supervisor loop starts them all again.
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
    name: 'restart',
    aliases: ['reboot', 'rebootbot'],
    desc: 'Gracefully restart all bot sessions',
    category: 'owner',
    ownerOnly: true,
    react: '🔄',

    async run({ sock, jid, m, isOwner }) {
        if (!isOwner) {
            await sock.sendMessage(jid, { text: '⛔ Owner only command.' }, { quoted: m });
            return;
        }

        await sock.sendMessage(jid, {
            text: '╭━━〔 🔄 GOD VOIP MD RESTART 〕━━╮\n\n⏳ Graceful restart requested.\n🧹 Stopping all WhatsApp sessions...\n🚀 The supervisor will start them again automatically.\n\n✦ GOD VOIP MD'
        }, { quoted: m });

        // Allow WhatsApp to flush the acknowledgement before signaling parent.
        await wait(1800);

        if (process.env.GITHUB_ACTIONS === 'true' && process.env.SESSION_INDEX) {
            // index.js is a child of multi-session.js. Its SIGTERM handler
            // shuts down every session worker and exits; run-bot.yml restarts
            // the supervisor process in its outer loop.
            try {
                process.kill(process.ppid, 'SIGTERM');
                return;
            } catch (error) {
                console.error('[RESTART] Supervisor signal failed:', error?.message || error);
            }
        }

        // Local/single-process fallback: terminate this worker. A process
        // manager (PM2, Docker, or the workflow supervisor) should restart it.
        process.exit(0);
    },
};
