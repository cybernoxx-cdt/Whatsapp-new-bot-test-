// .info — detailed bot / server information

import os from 'os';
import { formatUptime, formatBytes } from './_utils.js';

export default {
    name: 'info',
    aliases: ['botinfo', 'status'],
    desc: 'Show bot & server information',
    ownerOnly: false, // public, but the server section is owner-only (see below) // public, but the server section is owner-only (see below) // public, but the server section is owner-only (see below)

    async run({ reply, config, prefix, state, isOwner }) {
        const mem = process.memoryUsage();
        const cpu = os.cpus()?.[0]?.model?.trim() || 'unknown';

        // Server details are owner-only: strangers get the bot section only (S11).
        const serverSection = isOwner
            ? `\n*🖥️ Server*\n▫️ Uptime: ${formatUptime(process.uptime())}\n▫️ Platform: ${os.platform()} (${os.arch()})\n▫️ Node.js: ${process.version}\n▫️ CPU: ${cpu}\n▫️ RAM (bot): ${formatBytes(mem.rss)}\n▫️ RAM (system): ${formatBytes(os.totalmem() - os.freemem())} / ${formatBytes(os.totalmem())}\n`
            : '';
        const text =
`ℹ️ *${config.botName} — Info*

*🤖 Bot*
▫️ Name: ${config.botName}
▫️ Version: ${config.version}
▫️ Owner: ${config.ownerName}
▫️ Prefix: \`${prefix}\`
▫️ Plugins: ${state.pluginCount}
▫️ Login mode: ${String(config.connectMode || 'pair').toUpperCase()}

*📞 Call system*
▫️ Auto Call: ${state.callOn ? '🟢 ON' : '🔴 OFF'}
▫️ Max concurrent calls: ${config.voip.maxConcurrentCalls}
▫️ Database: ${state.dbConnected ? '🟢 Connected' : '🔴 Disconnected'}
${serverSection}
🔗 ${config.repoUrl || ''}

${config.texts.footer}`;
        await reply(text);
    },
};
