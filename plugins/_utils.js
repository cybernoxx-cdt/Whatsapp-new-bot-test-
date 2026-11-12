// Helpers shared by plugins (files starting with "_" are NOT loaded as plugins)

export function formatUptime(seconds) {
    seconds = Math.floor(seconds);
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return [d && `${d}d`, (d || h) && `${h}h`, (d || h || m) && `${m}m`, `${s}s`]
        .filter(Boolean)
        .join(' ');
}

export function formatBytes(bytes) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    while (bytes >= 1024 && i < units.length - 1) {
        bytes /= 1024;
        i++;
    }
    return `${bytes.toFixed(bytes >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}
