// .runtime — how long the bot has been running

import { formatUptime } from './_utils.js';

export default {
    name: 'runtime',
    aliases: ['uptime'],
    desc: 'Show how long the bot has been running',
    ownerOnly: false,

    async run({ reply, config }) {
        await reply(`⏱️ *Runtime:* ${formatUptime(process.uptime())}\n\n${config.texts.footer}`);
    },
};
