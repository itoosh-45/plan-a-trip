import * as db from './db.js';

export const TRIP_STATUS = { planned: 'מתוכנן', active: 'פעיל', done: 'הסתיים' };

export const DEFAULT_CATEGORIES = [
  { key: 'flights',     name: 'טיסות',     color: '#EE4266' },
  { key: 'lodging',     name: 'לינה',      color: '#06BCC1' },
  { key: 'food',        name: 'אוכל',      color: '#D97706' },
  { key: 'attractions', name: 'אטרקציות',  color: '#0E9F6E' },
  { key: 'transport',   name: 'תחבורה',    color: '#5A6672' },
  { key: 'gear',        name: 'ציוד',      color: '#7C3AED' },
  { key: 'courses',     name: 'קורסים',    color: '#2563EB' },
  { key: 'other',       name: 'אחר',       color: '#94A3B8' },
];

export async function createTrip({ name, homeCurrency = 'ILS', totalBudget = 0, status = 'planned' }) {
  const clean = (name || '').trim();
  if (!clean) throw new Error('לטיול חייב להיות שם');
  if (!TRIP_STATUS[status]) throw new Error(`סטטוס לא מוכר: ${status}`);

  const trip = await db.put(db.STORES.trips, {
    name: clean,
    homeCurrency,
    totalBudget: Number(totalBudget) || 0,
    status,
  });

  await db.bulkPut(db.STORES.categories, DEFAULT_CATEGORIES.map(c => ({
    tripId: trip.id, key: c.key, name: c.name, color: c.color,
  })));

  return trip;
}

export async function listTrips() {
  const rows = await db.all(db.STORES.trips);
  return rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function updateTrip(trip) {
  if (!trip?.id) throw new Error('אין טיול לעדכון');
  if (!(trip.name || '').trim()) throw new Error('לטיול חייב להיות שם');
  return db.put(db.STORES.trips, trip);
}

export async function removeTrip(tripId) {
  await db.deleteTrip(tripId);
}

/** תאריכי הטיול נגזרים מהמקטעים. זו הנקודה היחידה שמחשבת אותם. */
export async function tripDates(tripId) {
  const segs = await db.all(db.STORES.segments, tripId);
  if (!segs.length) return { startDate: null, endDate: null, days: 0 };
  const starts = segs.map(s => s.startDate).filter(Boolean).sort();
  const ends = segs.map(s => s.endDate || s.startDate).filter(Boolean).sort();
  const startDate = starts[0];
  const endDate = ends[ends.length - 1];
  const days = Math.round(
    (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86400000
  ) + 1;
  return { startDate, endDate, days };
}

export async function categories(tripId) {
  const rows = await db.all(db.STORES.categories, tripId);
  return rows.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

export async function upsertCategory(tripId, { id, name, color }) {
  const clean = (name || '').trim();
  if (!clean) throw new Error('לקטגוריה חייב להיות שם');
  if (!/^#[0-9A-F]{6}$/i.test(color || '')) throw new Error('צבע הקטגוריה אינו תקין');
  return db.put(db.STORES.categories, { id, tripId, name: clean, color });
}

export async function removeCategory(tripId, categoryId) {
  const [items, expenses, tasks, budgets] = await Promise.all([
    db.all(db.STORES.items, tripId),
    db.all(db.STORES.expenses, tripId),
    db.all(db.STORES.prepTasks, tripId),
    db.all(db.STORES.budgets, tripId),
  ]);
  const used = [...items, ...expenses, ...tasks].filter(r => r.categoryId === categoryId).length;
  if (used) throw new Error(`לא ניתן למחוק — ${used} רשומות משויכות לקטגוריה הזו`);
  for (const b of budgets.filter(b => b.categoryId === categoryId)) {
    await db.remove(db.STORES.budgets, b.id);
  }
  await db.remove(db.STORES.categories, categoryId);
}
