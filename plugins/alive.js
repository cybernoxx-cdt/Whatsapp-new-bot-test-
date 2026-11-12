// .alive — show that the bot is online

import { formatUptime } from './_utils.js';

export default {
    name: 'alive',
    aliases: ['online', 'bot'],
    desc: 'Check if the bot is online',
    ownerOnly: false,

    async run({ reply, config, prefix, state }) {
        const text =
`📞 *${config.botName}* is alive! ✅

🟢 *Status:* Online
📞 *Auto Call:* ${state.callOn ? '🟢 ON' : '🔴 OFF'}
⏱️ *Uptime:* ${formatUptime(process.uptime())}
🏷️ *Version:* ${config.version}
👤 *Owner:* ${config.ownerName}

Type \`${prefix}menu\` to see all commands.

${config.texts.footer}`;
        await reply(text);
    },
};
