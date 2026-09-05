import * as db from './db.js';
import { datesBetween } from './ui.js';

export const ITEM_TYPES = [
  { key: 'flight',     label: 'טיסה',     icon: 'flight' },
  { key: 'lodging',    label: 'לינה',     icon: 'lodging' },
  { key: 'attraction', label: 'אטרקציה',  icon: 'attraction' },
  { key: 'restaurant', label: 'מסעדה',    icon: 'restaurant' },
  { key: 'transfer',   label: 'מעבר',     icon: 'transfer' },
  { key: 'ride',       label: 'נסיעה',    icon: 'ride' },
  { key: 'meeting',    label: 'מפגש',     icon: 'meeting' },
  { key: 'other',      label: 'אחר',      icon: 'other' },
];


const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v || '');

export function segmentDays(seg) {
  return datesBetween(seg.startDate, seg.endDate || seg.startDate);
}

/** תאריכי ISO ניתנים להשוואה כמחרוזות — אין צורך להמיר לזמן. */
export function segmentForDate(segs, isoDate) {
  return segs.find(s =>
    s.kind !== 'general' && s.startDate <= isoDate && isoDate <= (s.endDate || s.startDate)) || null;
}

/** יעדים לפי תאריך, ו"כללי" תמיד אחרון. */
export async function listSegments(tripId) {
  const rows = await db.all(db.STORES.segments, tripId);
  return rows.sort((a, b) =>
    (a.kind === 'general') - (b.kind === 'general') ||
    String(a.startDate).localeCompare(String(b.startDate)));
}

export async function generalSegment(tripId) {
  return (await db.all(db.STORES.segments, tripId)).find(s => s.kind === 'general') || null;
}

/** המקטע שהיום נופל בתוכו, ואם אין — "כללי". */
export async function defaultSegmentId(tripId, today = new Date().toISOString().slice(0, 10)) {
  const segs = await listSegments(tripId);
  const hit = segmentForDate(segs, today);
  return (hit || segs.find(s => s.kind === 'general'))?.id || null;
}

/**
 * התאריכים שיעד חדש נפתח איתם: מהיום שאחרי סוף היעד האחרון ועד סוף הטיול.
 * זה כמעט תמיד מה שרוצים, וזה גם הטווח היחיד שבטוח אינו חופף ליעד קיים.
 * טיול בלי תאריכים מחזיר שדות ריקים — אין ממה לגזור.
 */
export function defaultRange(trip, segs) {
  if (!trip?.startDate) return { startDate: '', endDate: '' };
  const ends = segs.filter(s => s.kind !== 'general' && s.startDate)
    .map(s => s.endDate || s.startDate).sort();
  const last = ends.at(-1);
  const start = last ? nextDay(last) : trip.startDate;
  const endDate = trip.endDate || '';
  // היעד האחרון כבר נגמר בסוף הטיול — אין יום פנוי להציע
  if (endDate && start > endDate) return { startDate: '', endDate: '' };
  return { startDate: start, endDate };
}

const nextDay = iso =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);

/**
 * הטווח שהטיול צריך לגדול אליו כדי להכיל את היעד, או null אם הוא כבר מכיל
 * אותו. טיול בלי תאריכים אינו מגביל דבר ולכן לעולם אינו זקוק להארכה.
 */
export function rangeOverflow(trip, startDate, endDate) {
  if (!trip?.startDate || !trip?.endDate) return null;
  const end = endDate || startDate;
  const before = startDate && startDate < trip.startDate ? startDate : null;
  const after = end > trip.endDate ? end : null;
  return before || after ? { startDate: before, endDate: after } : null;
}

export async function saveSegment(tripId, seg) {
  const city = (seg.city || '').trim();
  if (!city) throw new Error('ליעד חייב להיות שם');
  if (!isDate(seg.startDate)) throw new Error('חסר תאריך התחלה תקין ליעד');
  const endDate = isDate(seg.endDate) ? seg.endDate : seg.startDate;
  if (endDate < seg.startDate) throw new Error('תאריך הסיום של היעד מוקדם מתאריך ההתחלה');

  const trip = await db.get(db.STORES.trips, tripId);
  if (trip?.startDate && trip?.endDate && (seg.startDate < trip.startDate || endDate > trip.endDate)) {
    throw new Error(`תאריכי היעד חייבים ליפול בתוך טווח הטיול (${trip.startDate} עד ${trip.endDate})`);
  }

  const others = (await db.all(db.STORES.segments, tripId))
    .filter(s => s.kind !== 'general' && s.id !== seg.id);
  const clash = others.find(o => seg.startDate <= (o.endDate || o.startDate) && o.startDate <= endDate);
  if (clash) {
    throw new Error(`התאריכים חופפים ליעד "${clash.city}" (${clash.startDate} עד ${clash.endDate})`);
  }

  return db.put(db.STORES.segments, {
    ...seg,
    id: seg.id,
    tripId,
    kind: 'place',
    city,
    country: (seg.country || '').trim(),
    endDate,
    currency: (seg.currency || trip?.currency || 'ILS').toUpperCase(),
    allocation: Number(seg.allocation) || 0,
  });
}

/** מחיקת יעד מעבירה את מה שהיה משויך אליו ל"כללי", ולעולם לא מוחקת רשומות. */
export async function removeSegment(tripId, segmentId) {
  const seg = await db.get(db.STORES.segments, segmentId);
  if (!seg) throw new Error('היעד לא נמצא');
  if (seg.kind === 'general') throw new Error('לא ניתן למחוק את המקטע "כללי"');

  const general = await generalSegment(tripId);
  for (const store of [db.STORES.items, db.STORES.expenses, db.STORES.prepTasks]) {
    const rows = (await db.all(store, tripId)).filter(r => r.segmentId === segmentId);
    if (rows.length) await db.bulkPut(store, rows.map(r => ({ ...r, segmentId: general?.id ?? null })));
  }
  await db.remove(db.STORES.segments, segmentId);
}

export async function listItems(tripId) {
  const rows = await db.all(db.STORES.items, tripId);
  return rows.sort((a, b) =>
    a.date.localeCompare(b.date) || (a.time || '99:99').localeCompare(b.time || '99:99'));
}

export async function saveItem(tripId, item) {
  const title = (item.title || '').trim();
  if (!title) throw new Error('לפריט חייבת להיות כותרת');
  if (!isDate(item.date)) throw new Error('לפריט חייב להיות תאריך');
  if (!ITEM_TYPES.some(t => t.key === item.type)) throw new Error(`סוג פריט לא מוכר: ${item.type}`);
  if (item.endDate && !isDate(item.endDate)) throw new Error('תאריך הסיום של הפריט אינו תקין');
  if (item.endDate && item.endDate < item.date) {
    throw new Error('תאריך הסיום של הפריט מוקדם מתאריך ההתחלה');
  }

  // כסף שיצא בפועל נרשם כהוצאה בלבד. לפריט מסלול יש רק סכום מתוכנן.
  const { actualAmount, payStatus, ...rest } = item;
  return db.put(db.STORES.items, {
    ...rest,
    id: item.id,
    tripId,
    title,
    segmentId: item.segmentId ?? null,
    plannedAmount: item.plannedAmount === '' ? undefined : item.plannedAmount,
  });
}

export async function removeItem(tripId, itemId) {
  await db.remove(db.STORES.items, itemId);
}

export function itemsByDate(items) {
  const map = new Map();
  for (const i of items) {
    if (!map.has(i.date)) map.set(i.date, []);
    map.get(i.date).push(i);
  }
  for (const list of map.values()) {
    list.sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'));
  }
  return map;
}
