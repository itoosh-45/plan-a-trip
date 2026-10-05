export const APP_VERSION = '2026.10.04-preview.1';
let requestedReload = false;
export async function checkForUpdate() {
  if (!navigator.onLine) return 'offline';
  if (!navigator.serviceWorker) throw new Error('עדכון אופליין אינו נתמך בדפדפן הזה');
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) throw new Error('פתחו את האפליקציה מחדש כדי להפעיל את העדכונים');
  await registration.update();
  if (registration.installing) {
    const worker = registration.installing;
    await new Promise((resolve, reject) => {
      const inspect = () => {
        if (worker.state === 'installed' || worker.state === 'activated') { worker.removeEventListener('statechange', inspect); resolve(); }
        else if (worker.state === 'redundant') { worker.removeEventListener('statechange', inspect); reject(new Error('העדכון לא הושלם. הגרסה הנוכחית נשמרה')); }
      };
      worker.addEventListener('statechange', inspect); inspect();
    });
  }
  return registration.waiting ? 'available' : 'current';
}
export async function applyUpdate() {
  if (document.querySelector('.sheet-backdrop')) {
    throw new Error('סיימו את העריכה לפני העדכון');
  }
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration?.waiting) throw new Error('אין עדכון שממתין להתקנה');
  if (requestedReload) return;
  requestedReload = true;
  navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
  registration.waiting.postMessage({ type: 'APPLY_UPDATE' });
}
export async function getStorageStatus() {
  const [persisted, estimate] = await Promise.all([
    navigator.storage?.persisted?.().catch(() => null),
    navigator.storage?.estimate?.().catch(() => null),
  ]);
  return { persisted: persisted ?? null, usage: estimate?.usage ?? null, quota: estimate?.quota ?? null };
}
