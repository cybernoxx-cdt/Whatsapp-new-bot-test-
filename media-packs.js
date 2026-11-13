// Backward-compatible exports for the local .tourl call-media cache.
// Calls no longer depend on a DNUZ public URL or anonymous HTTP GET.
export { saveLatestCallMedia, getLatestCallMedia } from './media-store.js';
