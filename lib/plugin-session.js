// Stable conversation key shared by interactive plugins.
// Private chats use the chat JID only: remoteJidAlt can be present on one
// message and absent on the next, which used to orphan numeric reply sessions.
// Groups additionally scope sessions to the participant.
export function getPluginSessionKey(ctx) {
  const key = ctx?.m?.key || {};
  const chat = String(ctx?.jid || key.remoteJid || '');
  if (!chat.endsWith('@g.us')) return chat;
  const sender = String(key.participantPn || key.participantAlt || key.participant || ctx?.m?.participantPn || ctx?.m?.participant || 'unknown')
    .toLowerCase().replace(/:\\d+(?=@)/, '');
  return chat + '|' + sender;
}
