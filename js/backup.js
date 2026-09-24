import * as db from './db.js';

const MIME = 'application/json';

const today = () => new Date().toISOString().slice(0, 10);
const safe = name => (name || '').replace(/[\\/:*?"<>|]/g, '-').trim() || 'trip';

function backupFilename(tripName) {
  return tripName
    ? `trip-planner-${safe(tripName)}-${today()}.json`
    : `trip-planner-backup-${today()}.json`;
}

/**
 * חותך מהגיבוי את מה ששייך לטיול אחד. שערי המרה והגדרות אינם נכנסים:
 * הם שייכים למכשיר ולא לטיול, וכל רשומת כסף כבר נושאת את השער שנצרב עליה.
 */
function sliceTrip(stores, tripId) {
  const out = { trips: (stores.trips || []).filter(t => t.id === tripId) };
  for (const name of db.TRIP_SCOPED) {
    out[name] = (stores[name] || []).filter(r => r.tripId === tripId);
  }
  return out;
}

/** גיבוי של הכול, או של טיול אחד כשמועבר tripId. */
export async function buildBackup(tripId) {
  const dump = await db.exportAll();
  if (!tripId) return { json: JSON.stringify(dump, null, 1), filename: backupFilename() };

  const trip = (dump.stores.trips || []).find(t => t.id === tripId);
  if (!trip) throw new Error('הטיול לא נמצא');
  const payload = { ...dump, stores: sliceTrip(dump.stores, tripId) };
  return { json: JSON.stringify(payload, null, 1), filename: backupFilename(trip.name) };
}

/**
 * גיבוי ידני ביד המשתמש: מנסה iOS Share Sheet קודם (navigator.share עם קובץ),
 * ונופל להורדת קובץ אם אין תמיכה או שהשיתוף נכשל מסיבה שאינה ביטול משתמש.
 */
export async function toFile(tripId) {
  const { json, filename } = await buildBackup(tripId);
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

/** הטיולים שיושבים בקובץ, עם מונים, כדי שאפשר יהיה לבחור מה לשחזר. */
export function tripsIn(payload) {
  const stores = payload?.stores || {};
  return (stores.trips || []).map(trip => ({
    id: trip.id,
    name: trip.name,
    startDate: trip.startDate,
    endDate: trip.endDate,
    counts: {
      segments: (stores.segments || []).filter(r => r.tripId === trip.id).length,
      items: (stores.items || []).filter(r => r.tripId === trip.id).length,
      expenses: (stores.expenses || []).filter(r => r.tripId === trip.id).length,
      prepTasks: (stores.prepTasks || []).filter(r => r.tripId === trip.id).length,
    },
  }));
}

// כל ההפניות בין רשומות בסכימה. מזהה חדש חייב להחליף גם אותן, אחרת עותק
// של טיול יצביע על היעדים והקטגוריות של המקור.
const REFS = ['tripId', 'segmentId', 'categoryId', 'walletId'];

function remapIds(stores, rename) {
  const map = new Map();
  const swap = id => {
    if (!id) return id;
    if (!map.has(id)) map.set(id, crypto.randomUUID());
    return map.get(id);
  };
  const out = {};
  for (const [name, rows] of Object.entries(stores)) {
    out[name] = rows.map(row => {
      const copy = { ...row, id: swap(row.id) };
      for (const ref of REFS) if (copy[ref]) copy[ref] = swap(copy[ref]);
      return copy;
    });
  }
  if (rename && out.trips?.length) out.trips[0] = { ...out.trips[0], name: rename };
  return out;
}

/**
 * משחזר טיול אחד מתוך קובץ בלי לגעת בשאר הטיולים במכשיר.
 *   'replace' — מוחק את הטיול הקיים באותו מזהה וכותב את זה שבקובץ.
 *   'copy'    — כותב אותו כטיול נוסף, עם מזהים חדשים לכל רשומה.
 */
export async function restoreTrip(payload, tripId, mode = 'replace') {
  const stores = sliceTrip(payload?.stores || {}, tripId);
  if (!stores.trips.length) throw new Error('הטיול אינו נמצא בקובץ');

  if (mode === 'copy') {
    const name = `${stores.trips[0].name} (עותק)`;
    return db.importAll({ stores: remapIds(stores, name) }, 'merge');
  }

  await db.deleteTrip(tripId);
  return db.importAll({ stores }, 'merge');
}
