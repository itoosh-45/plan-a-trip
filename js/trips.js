import * as db from './db.js';

export const GENERAL_CITY = 'כללי';

const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v || '');

export const DEFAULT_CATEGORIES = [
  { key: 'flights',     name: 'טיסות',     color: '#EE4266', icon: 'flight' },
  { key: 'lodging',     name: 'לינה',      color: '#06BCC1', icon: 'lodging' },
  { key: 'food',        name: 'אוכל',      color: '#D97706', icon: 'restaurant' },
  { key: 'attractions', name: 'אטרקציות',  color: '#0E9F6E', icon: 'attraction' },
  { key: 'transport',   name: 'תחבורה',    color: '#5A6672', icon: 'ride' },
  { key: 'shopping',    name: 'קניות',     color: '#DB2777', icon: 'shopping' },
  { key: 'gear',        name: 'ציוד',      color: '#7C3AED', icon: 'gear' },
  { key: 'courses',     name: 'קורסים',    color: '#2563EB', icon: 'meeting' },
  { key: 'other',       name: 'אחר',       color: '#94A3B8', icon: 'other' },
];

/** תאריכי הטיול הם מקור האמת של כל לוח הזמנים. שניהם אופציונליים (דילוג באונבורדינג). */
function readDates({ startDate, endDate }) {
  const from = isDate(startDate) ? startDate : null;
  const to = isDate(endDate) ? endDate : null;
  if (from && to && to < from) throw new Error('תאריך הסיום של הטיול מוקדם מתאריך ההתחלה');
  return { startDate: from, endDate: to };
}

export async function createTrip({ name, startDate, endDate, currency = 'ILS', totalBudget = 0 }) {
  const clean = (name || '').trim();
  if (!clean) throw new Error('לטיול חייב להיות שם');

  const trip = await db.put(db.STORES.trips, {
    name: clean,
    ...readDates({ startDate, endDate }),
    currency: (currency || 'ILS').toUpperCase(),
    totalBudget: Number(totalBudget) || 0,
  });

  await db.bulkPut(db.STORES.categories, DEFAULT_CATEGORIES.map(c => ({ ...c, tripId: trip.id })));
  await ensureGeneralSegment(trip.id);
  return trip;
}

/** המקטע הקבוע שאליו משויך כל מה שאינו שייך ליעד ספציפי. אין לו תאריכים. */
export async function ensureGeneralSegment(tripId) {
  const rows = await db.all(db.STORES.segments, tripId);
  const existing = rows.find(s => s.kind === 'general');
  if (existing) return existing;
  return db.put(db.STORES.segments, {
    tripId, kind: 'general', city: GENERAL_CITY, country: '',
    startDate: null, endDate: null, currency: 'ILS', allocation: 0,
  });
}

export async function listTrips() {
  const rows = await db.all(db.STORES.trips);
  return rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function getTrip(tripId) {
  return db.get(db.STORES.trips, tripId);
}

export async function updateTrip(trip) {
  if (!trip?.id) throw new Error('אין טיול לעדכון');
  if (!(trip.name || '').trim()) throw new Error('לטיול חייב להיות שם');
  return db.put(db.STORES.trips, {
    ...trip,
    name: trip.name.trim(),
    ...readDates(trip),
    currency: (trip.currency || 'ILS').toUpperCase(),
    totalBudget: Number(trip.totalBudget) || 0,
  });
}

export async function removeTrip(tripId) {
  await db.deleteTrip(tripId);
}

export async function tripDates(tripId) {
  const trip = await db.get(db.STORES.trips, tripId);
  const { startDate = null, endDate = null } = trip || {};
  const days = startDate && endDate
    ? Math.round((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86400000) + 1
    : 0;
  return { startDate, endDate, days };
}

/** תקרה כוללת מול סך ההקצאות למקטעים. חריגה מסומנת אך לעולם אינה חוסמת שמירה. */
export async function budgetSummary(tripId) {
  const [trip, segs] = await Promise.all([
    db.get(db.STORES.trips, tripId),
    db.all(db.STORES.segments, tripId),
  ]);
  const ceiling = trip?.totalBudget || 0;
  const allocated = round2(segs.reduce((sum, s) => sum + (Number(s.allocation) || 0), 0));
  return { ceiling, allocated, unallocated: round2(ceiling - allocated), over: allocated > ceiling };
}

export async function categories(tripId) {
  const rows = await db.all(db.STORES.categories, tripId);
  return rows.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

export async function upsertCategory(tripId, { id, name, color, icon }) {
  const clean = (name || '').trim();
  if (!clean) throw new Error('לקטגוריה חייב להיות שם');
  if (!/^#[0-9A-F]{6}$/i.test(color || '')) throw new Error('צבע הקטגוריה אינו תקין');
  return db.put(db.STORES.categories, { id, tripId, name: clean, color, icon: icon || 'other' });
}

export async function removeCategory(tripId, categoryId) {
  const [items, expenses, tasks] = await Promise.all([
    db.all(db.STORES.items, tripId),
    db.all(db.STORES.expenses, tripId),
    db.all(db.STORES.prepTasks, tripId),
  ]);
  const used = [...items, ...expenses, ...tasks].filter(r => r.categoryId === categoryId).length;
  if (used) throw new Error(`לא ניתן למחוק — ${used} רשומות משויכות לקטגוריה הזו`);
  await db.remove(db.STORES.categories, categoryId);
}
