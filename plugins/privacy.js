// .privacy — WhatsApp privacy controls and user-initiated spam reporting.
const choices = {
    lastseen: ['all', 'contacts', 'contact_blacklist', 'none'],
    online: ['all', 'match_last_seen'],
    profile: ['all', 'contacts', 'contact_blacklist', 'none'],
    status: ['all', 'contacts', 'contact_blacklist', 'none'],
    readreceipts: ['all', 'none'],
    groups: ['all', 'contacts', 'contact_blacklist'],
};

const methods = {
    lastseen: 'updateLastSeenPrivacy',
    online: 'updateOnlinePrivacy',
    profile: 'updateProfilePicturePrivacy',
    status: 'updateStatusPrivacy',
    readreceipts: 'updateReadReceiptsPrivacy',
    groups: 'updateGroupsAddPrivacy',
};

const cleanNumber = value => String(value || '').replace(/[^0-9]/g, '');

export default {
    name: 'privacy',
    aliases: ['priv'],
    desc: 'Manage WhatsApp privacy settings / report spam',
    ownerOnly: true,

    async run({ args, reply, prefix, sock, config }) {
        const action = String(args[0] || 'help').toLowerCase();
        if (action === 'help') {
            return reply(
                '🔒 *PRIVACY & SPAM CONTROLS*\n\n' +
                '*Privacy settings*\n' +
                '`' + prefix + 'privacy lastseen all|contacts|contact_blacklist|none`\n' +
                '`' + prefix + 'privacy online all|match_last_seen`\n' +
                '`' + prefix + 'privacy profile all|contacts|contact_blacklist|none`\n' +
                '`' + prefix + 'privacy status all|contacts|contact_blacklist|none`\n' +
                '`' + prefix + 'privacy readreceipts all|none`\n' +
                '`' + prefix + 'privacy groups all|contacts|contact_blacklist`\n\n' +
                '*Spam reporting*\n' +
                '`' + prefix + 'privacy report 94771234567 spam|inappropriate|offensive`\n\n' +
                'Spam report command එක භාවිතා කරන්නේ ඔබ තෝරාගත් number එකට පමණි. ' +
                'Block කිරීම හෝ chat delete කිරීම මෙහිදී ස්වයංක්‍රීයව සිදු නොවේ.\n\n' +
                config.texts.footer
            );
        }

        if (action === 'report') {
            const number = cleanNumber(args[1]);
            const reason = String(args[2] || 'spam').toLowerCase();
            if (number.length < 8 || number.length > 15 || !['spam', 'inappropriate', 'offensive'].includes(reason)) {
                return reply('❌ *Usage:* `' + prefix + 'privacy report 94771234567 spam|inappropriate|offensive`');
            }
            try {
                await sock.reportSpam(number + '@s.whatsapp.net', {
                    reason,
                    block: false,
                    deleteChat: false,
                });
                return reply('✅ *Spam report submitted*\n📱 Number: +' + number + '\n📝 Reason: ' + reason + '\n🔒 No automatic block or chat deletion was requested.');
            } catch (error) {
                return reply('⚠️ Spam report failed: ' + (error?.message || 'Unknown error'));
            }
        }

        const method = methods[action];
        const allowed = choices[action];
        const value = String(args[1] || '').toLowerCase();
        if (!method || !allowed || !allowed.includes(value)) {
            return reply('❌ Invalid privacy option. Use `' + prefix + 'privacy` to view supported settings.');
        }
        if (typeof sock[method] !== 'function') {
            return reply('⚠️ This privacy method is not available in the installed Baileys build.');
        }
        try {
            await sock[method](value);
            return reply('✅ *Privacy setting updated*\n🔐 Setting: ' + action + '\n⚙️ Value: ' + value);
        } catch (error) {
            return reply('⚠️ Privacy update failed: ' + (error?.message || 'Unknown error'));
        }
    },
};
