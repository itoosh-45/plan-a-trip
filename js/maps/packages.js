// Temporary compatibility shim for clients that still have the pre-removal shell cached.
// No map functionality remains. The current app does not import this file.
export const activeDownloads = new Set();
export function formatBytes(bytes) {
  return new Intl.NumberFormat('he', { maximumFractionDigits: 1 }).format(bytes / 1048576) + ' MB';
}
