// .info — detailed bot / server information

import os from 'os';
import { formatUptime, formatBytes } from './_utils.js';

export default {
    name: 'info',
    aliases: ['botinfo', 'status'],
    desc: 'Show bot & server information',
    ownerOnly: false,

    async run({ reply, config, prefix, state }) {
        const mem = process.memoryUsage();
        const cpu = os.cpus()?.[0]?.model?.trim() || 'unknown';

        const text =
`ℹ️ *${config.botName} — Info*

*🤖 Bot*
▫️ Name: ${config.botName}
▫️ Version: ${config.version}
▫️ Owner: ${config.ownerName}
▫️ Prefix: \`${prefix}\`
▫️ Plugins: ${state.pluginCount}
▫️ Login mode: ${config.connectMode.toUpperCase()}

*📞 Call system*
▫️ Auto Call: ${state.callOn ? '🟢 ON' : '🔴 OFF'}
▫️ Max concurrent calls: ${config.voip.maxConcurrentCalls}
▫️ Database: ${dbOk ? '🟢 Connected' : '🔴 Disconnected'}

*🖥️ Server*
▫️ Uptime: ${formatUptime(process.uptime())}
▫️ Platform: ${os.platform()} (${os.arch()})
▫️ Node.js: ${process.version}
▫️ CPU: ${cpu}
▫️ RAM (bot): ${formatBytes(mem.rss)}
▫️ RAM (system): ${formatBytes(os.totalmem() - os.freemem())} / ${formatBytes(os.totalmem())}

🔗 ${config.repoUrl}

${config.texts.footer}`;
        await reply(text);
    },
};
