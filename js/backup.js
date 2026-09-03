import * as db from './db.js';

const MIME = 'application/json';

function backupFilename() {
  return `trip-planner-backup-${new Date().toISOString().slice(0, 10)}.json`;
}

export async function buildBackup() {
  const dump = await db.exportAll();
  return { json: JSON.stringify(dump, null, 1), filename: backupFilename() };
}

/**
 * גיבוי ידני ביד המשתמש: מנסה iOS Share Sheet קודם (navigator.share עם קובץ),
 * ונופל להורדת קובץ אם אין תמיכה או שהשיתוף נכשל מסיבה שאינה ביטול משתמש.
 */
export async function toFile() {
  const { json, filename } = await buildBackup();
  const file = new File([json], filename, { type: MIME });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'גיבוי תכנון טיול ותקציב' });
      return { method: 'share' };
    } catch (err) {
      if (err?.name === 'AbortError') return { method: 'cancelled' };
      // כישלון אחר בשיתוף — ממשיכים להורדה כרשת ביטחון
    }
  }

  const blob = new Blob([json], { type: MIME });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return { method: 'download' };
}

/** קורא ומאמת קובץ גיבוי. אינו נוגע בנתונים — מחזיר תצוגה מקדימה בלבד. */
export async function parseBackup(file) {
  let text;
  try {
    text = await file.text();
  } catch {
    return { ok: false, error: 'לא ניתן לקרוא את הקובץ' };
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    return { ok: false, error: 'הקובץ אינו JSON תקין' };
  }

  if (!payload || typeof payload !== 'object' || !payload.stores || typeof payload.stores !== 'object' || Array.isArray(payload.stores)) {
    return { ok: false, error: 'מבנה הקובץ אינו קובץ גיבוי תקין — חסר המקטע "stores"' };
  }

  const known = Object.keys(db.STORES);
  const unknown = Object.keys(payload.stores).filter(k => !known.includes(k));
  if (unknown.length) {
    return { ok: false, error: `הקובץ מכיל טבלאות שאינן מוכרות: ${unknown.join(', ')}` };
  }

  const preview = {};
  for (const k of known) preview[k] = Array.isArray(payload.stores[k]) ? payload.stores[k].length : 0;
  return { ok: true, preview, payload };
}

/** משחזר גיבוי שאושר — מחליף את כל הנתונים במכשיר (כל הטיולים). */
export async function restore(payload) {
  return db.importAll(payload, 'replace');
}
