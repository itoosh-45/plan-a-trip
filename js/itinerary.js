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

export const PAY_STATUS = { planned: 'מתוכנן', prepaid: 'שולם מראש', paid: 'שולם בפועל' };
export const PAY_METHOD = { cash: 'מזומן', credit: 'אשראי', transfer: 'העברה' };

const toMs = iso => Date.parse(`${iso}T00:00:00Z`);
const toIso = ms => new Date(ms).toISOString().slice(0, 10);
const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v || '');

export function segmentDays(seg) {
  return datesBetween(seg.startDate, seg.endDate || seg.startDate);
}

export function overlappingSegments(segs) {
  const hit = new Set();
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const a = segs[i], b = segs[j];
      const aEnd = a.endDate || a.startDate, bEnd = b.endDate || b.startDate;
      if (toMs(a.startDate) <= toMs(bEnd) && toMs(b.startDate) <= toMs(aEnd)) {
        hit.add(a.id); hit.add(b.id);
      }
    }
  }
  return hit;
}

export function segmentForDate(segs, isoDate) {
  const t = toMs(isoDate);
  return segs.find(s => t >= toMs(s.startDate) && t <= toMs(s.endDate || s.startDate)) || null;
}

export async function listSegments(tripId) {
  const rows = await db.all(db.STORES.segments, tripId);
  return rows.sort((a, b) => a.startDate.localeCompare(b.startDate));
}

export async function saveSegment(tripId, seg) {
  const city = (seg.city || '').trim();
  if (!city) throw new Error('למקטע חייבת להיות עיר');
  if (!isDate(seg.startDate)) throw new Error('חסר תאריך התחלה תקין למקטע');
  const endDate = isDate(seg.endDate) ? seg.endDate : seg.startDate;
  if (toMs(endDate) < toMs(seg.startDate)) {
    throw new Error('תאריך הסיום של המקטע מוקדם מתאריך ההתחלה');
  }
  return db.put(db.STORES.segments, {
    ...seg,
    id: seg.id,
    tripId,
    city,
    country: (seg.country || '').trim(),
    endDate,
    currency: (seg.currency || 'ILS').toUpperCase(),
  });
}

export async function removeSegment(tripId, segmentId) {
  const items = (await listItems(tripId)).filter(i => i.segmentId === segmentId);
  for (const i of items) await db.put(db.STORES.items, { ...i, segmentId: null });
  await db.remove(db.STORES.segments, segmentId);
}

export async function moveSegment(tripId, segmentId, newStartDate) {
  if (!isDate(newStartDate)) throw new Error('תאריך היעד אינו תקין');
  const seg = await db.get(db.STORES.segments, segmentId);
  if (!seg) throw new Error('המקטע לא נמצא');

  const delta = toMs(newStartDate) - toMs(seg.startDate);
  if (delta === 0) return seg;

  const items = (await listItems(tripId)).filter(i => i.segmentId === segmentId);
  const moved = items.map(i => ({
    ...i,
    date: toIso(toMs(i.date) + delta),
    endDate: isDate(i.endDate) ? toIso(toMs(i.endDate) + delta) : i.endDate,
  }));
  if (moved.length) await db.bulkPut(db.STORES.items, moved);

  return db.put(db.STORES.segments, {
    ...seg,
    startDate: newStartDate,
    endDate: toIso(toMs(seg.endDate || seg.startDate) + delta),
  });
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
  if (item.endDate && toMs(item.endDate) < toMs(item.date)) {
    throw new Error('תאריך הסיום של הפריט מוקדם מתאריך ההתחלה');
  }
  if (item.payStatus && !PAY_STATUS[item.payStatus]) throw new Error('סטטוס תשלום לא מוכר');
  if (item.method && !PAY_METHOD[item.method]) throw new Error('אמצעי תשלום לא מוכר');

  return db.put(db.STORES.items, {
    ...item,
    id: item.id,
    tripId,
    title,
    segmentId: item.segmentId ?? null,
    payStatus: item.payStatus || 'planned',
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

/** "בפועל דורס מתוכנן". הביטוי היחיד של הכלל הזה בקוד. */
export function effectiveAmount(rec) {
  return rec?.actualAmount ?? rec?.plannedAmount ?? 0;
}
