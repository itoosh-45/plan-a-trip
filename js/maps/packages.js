import * as store from './store.js';

export const activeDownloads = new Set();
const cancellation = new Map();
export function cancelDownload(id) { cancellation.get(id)?.abort(); }
export function formatBytes(bytes) {
  return new Intl.NumberFormat('he', { maximumFractionDigits: 1 }).format(bytes / 1048576) + ' MB';
}
export async function catalog() {
  const response = await fetch('./data/map-packages.json');
  if (!response.ok) throw new Error('רשימת המפות אינה זמינה');
  return (await response.json()).packages;
}
export async function downloadPackage(meta, { signal, onProgress = () => {} } = {}) {
  if (activeDownloads.has(meta.id)) throw new Error('המפה כבר בהורדה');
  const controller = new AbortController();
  const externalSignal = signal;
  const cancel = () => controller.abort();
  externalSignal?.addEventListener('abort', cancel, { once: true });
  if (externalSignal?.aborted) controller.abort();
  signal = controller.signal;
  cancellation.set(meta.id, controller);
  activeDownloads.add(meta.id);
  let row = { ...meta, state: 'downloading' };
  try {
    let previous = await store.getPackage(meta.id);
    if (previous && previous.version !== meta.version) { await store.deletePackage(meta.id); previous = null; }
    row = { ...meta, ...previous, state: 'downloading' };
    const estimate = await navigator.storage?.estimate?.();
    const needed = meta.bytes - (row.received || 0);
    if (estimate?.quota && estimate.quota - estimate.usage < needed * 1.1) throw new Error('אין מספיק מקום בטלפון להורדה');
    await store.putPackage(row);
    let received = 0;
    for (const part of meta.chunks) {
      signal?.throwIfAborted();
      let blob = await store.getChunk(meta.id, part.index);
      if (!blob || blob.size !== part.bytes) {
        // The archive is published as bounded chunks, avoiding whole-country responses in RAM.
        const response = await fetch(part.url, { signal, cache: 'no-store' });
        if (!response.ok) throw new Error('הורדת המפה נכשלה — אפשר לנסות שוב');
        const data = await response.arrayBuffer();
        if (data.byteLength !== part.bytes) throw new Error('קובץ המפה אינו שלם');
        const digest = await crypto.subtle.digest('SHA-256', data);
        const hash = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
        if (hash !== part.sha256) throw new Error('בדיקת תקינות המפה נכשלה');
        blob = new Blob([data]);
        await store.putChunk(meta.id, part.index, blob);
      }
      received += part.bytes;
      row.received = received;
      await store.putPackage(row);
      onProgress(received / meta.bytes);
    }
    if (received !== meta.bytes) throw new Error('המפה אינה שלמה');
    row.state = 'ready';
    await store.putPackage(row);
    return row;
  } catch (error) {
    row.state = 'partial';
    await store.putPackage(row).catch(() => {});
    if (error.name === 'QuotaExceededError') throw new Error('אין מספיק מקום בטלפון. מחקו מפה ונסו שוב');
    throw error;
  } finally { activeDownloads.delete(meta.id); cancellation.delete(meta.id); externalSignal?.removeEventListener('abort', cancel); }
}
export function getLocalSource(meta) {
  return {
    getKey: () => `local-${meta.id}-${meta.version}`,
    async getBytes(offset, length, signal) {
      if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > meta.bytes) {
        throw new Error('טווח המפה אינו תקין');
      }
      const output = new Uint8Array(length);
      let copied = 0, start = 0;
      for (const part of meta.chunks) {
        const end = start + part.bytes;
        if (end > offset && start < offset + length) {
          signal?.throwIfAborted();
          const blob = await store.getChunk(meta.id, part.index);
          if (!blob || blob.size !== part.bytes) throw new Error('המפה חסרה. הורידו אותה מחדש');
          const from = Math.max(offset, start), to = Math.min(offset + length, end);
          output.set(new Uint8Array(await blob.slice(from-start, to-start).arrayBuffer()), from-offset);
          copied += to-from;
        }
        start = end;
      }
      if (copied !== length) throw new Error('המפה אינה שלמה');
      return { data: output.buffer };
    },
  };
}

// Browsing online does not imply that an area has been downloaded for offline use.
export function getRemoteSource(meta) {
  const chunks = new Map();
  return {
    getKey: () => `online-${meta.id}-${meta.version}`,
    async getBytes(offset, length, signal) {
      if (offset < 0 || length < 0 || offset + length > meta.bytes) throw new Error('טווח מפה לא תקין');
      const output = new Uint8Array(length);
      let start = 0;
      for (const part of meta.chunks) {
        const end = start + part.bytes;
        if (end > offset && start < offset + length) {
          signal?.throwIfAborted();
          if (!chunks.has(part.index)) {
            const pending = fetch(part.url, { cache: 'no-store' }).then(async response => {
              if (!response.ok) throw new Error('המפה אינה זמינה ברשת');
              const data = await response.arrayBuffer();
              if (data.byteLength !== part.bytes) throw new Error('מקטע המפה אינו שלם');
              return data;
            }).catch(error => { chunks.delete(part.index); throw error; });
            chunks.set(part.index, pending);
          }
          const data = await chunks.get(part.index);
          const from = Math.max(offset, start), to = Math.min(offset + length, end);
          output.set(new Uint8Array(data, from-start, to-from), from-offset);
          // Bound browsing memory; completed offline packages always use IndexedDB instead.
          while (chunks.size > 8) chunks.delete(chunks.keys().next().value);
        }
        start = end;
      }
      return { data: output.buffer };
    },
  };
}
