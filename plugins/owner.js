// .owner — send the owner's contact card

export default {
    name: 'owner',
    aliases: ['creator'],
    desc: 'Send owner contact',
    ownerOnly: false,

    async run({ sock, jid, m, config }) {
        const number = String(config.number).replace(/[^0-9]/g, '');
        const vcard =
`BEGIN:VCARD
VERSION:3.0
FN:${config.ownerName}
ORG:${config.botName};
TEL;type=CELL;type=VOICE;waid=${number}:+${number}
END:VCARD`;
        await sock.sendMessage(
            jid,
            { contacts: { displayName: config.ownerName, contacts: [{ vcard }] } },
            { quoted: m },
        );
    },
};
