// Shared WhatsApp message unwrapper (Q4) — one copy instead of five.
// Follows ephemeral / document-with-caption / view-once wrappers.
export function unwrapMessage(message) {
    let current = message || {};
    for (let i = 0; i < 8; i++) {
        const next = current.ephemeralMessage?.message ||
            current.documentWithCaptionMessage?.message ||
            current.viewOnceMessage?.message ||
            current.viewOnceMessageV2?.message;
        if (!next) break;
        current = next;
    }
    return current;
}

export function containsViewOnce(message, depth = 0) {
    if (!message || typeof message !== 'object' || depth > 8) return false;
    if (message.viewOnceMessage || message.viewOnceMessageV2 || message.viewOnceMessageV2Extension) return true;
    return Object.values(message).some(v => v && typeof v === 'object' && containsViewOnce(v, depth + 1));
}
