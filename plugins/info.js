// .info — detailed bot / server information
import os from 'os';
import { formatUptime, formatBytes } from './_utils.js';

export default {
    name: 'info',
    aliases: ['botinfo', 'status'],
    desc: 'View bot and server information',
    ownerOnly: false,

    async run({ reply, config, prefix, state, isOwner }) {
        const mem = process.memoryUsage();
        const cpu = os.cpus()?.[0]?.model?.trim() || 'unknown';
        const serverSection = isOwner
            ? `\n*🖥️ Server*\n▫️ Uptime: ${formatUptime(process.uptime())}\n▫️ Platform: ${os.platform()} (${os.arch()})\n▫️ Node.js: ${process.version}\n▫️ CPU: ${cpu}\n▫️ RAM (bot): ${formatBytes(mem.rss)}\n▫️ RAM (system): ${formatBytes(os.totalmem() - os.freemem())} / ${formatBytes(os.totalmem())}\n`
            : '';
        const text =
`╭━━〔 ℹ️ ${config.botName} INFO 〕━━╮
│
│  *BOT DETAILS*
│  Name: ${config.botName}
│  Version: ${config.version}
│  Owner: ${config.ownerName}
│  Prefix: \`${prefix}\`
│  Plugins: ${state.pluginCount}
│  Login: ${String(config.connectMode || 'pair').toUpperCase()}
│
│  *CALL SYSTEM*
│  Auto Call: ${state.callOn ? '🟢 ON' : '🔴 OFF'}
│  Max Calls: ${config.voip.maxConcurrentCalls}
│  Database: ${state.dbConnected ? '🟢 Connected' : '🔴 Disconnected'}
╰━━━━━━━━━━━━━━━━━━━━╯${serverSection}
🔗 ${config.repoUrl || ''}

${config.texts.footer}`;
        await reply(text);
    },
};
