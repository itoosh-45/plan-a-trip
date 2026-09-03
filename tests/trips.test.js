import { suite, assertEqual, assertTrue, assertThrows } from './harness.js';
import * as db from '../js/db.js';
import * as trips from '../js/trips.js';

export default async function () {
  const s = suite('טיולים וקטגוריות');
  await db.useTestDatabase();

  s.test('createTrip יוצר טיול עם 8 קטגוריות ברירת מחדל', async () => {
    await db.wipe();
    const t = await trips.createTrip({ name: 'יפן 2026', homeCurrency: 'ILS', totalBudget: 20000 });
    assertEqual(t.name, 'יפן 2026');
    assertEqual(t.status, 'planned', 'סטטוס ברירת המחדל אינו "מתוכנן"');
    const cats = await trips.categories(t.id);
    assertEqual(cats.length, 8);
    assertEqual(cats.map(c => c.name).sort(),
      ['אוכל', 'אחר', 'אטרקציות', 'ציוד', 'טיסות', 'לינה', 'קורסים', 'תחבורה'].sort());
    assertTrue(cats.every(c => /^#[0-9A-F]{6}$/i.test(c.color)), 'יש קטגוריה בלי צבע תקין');
  });

  s.test('לכל טיול קטגוריות משל עצמו — אין דליפה', async () => {
    await db.wipe();
    const a = await trips.createTrip({ name: 'א', homeCurrency: 'ILS' });
    const b = await trips.createTrip({ name: 'ב', homeCurrency: 'ILS' });
    assertEqual((await trips.categories(a.id)).length, 8);
    assertEqual((await trips.categories(b.id)).length, 8);
    const ids = new Set([...(await trips.categories(a.id)), ...(await trips.categories(b.id))].map(c => c.id));
    assertEqual(ids.size, 16, 'קטגוריות משותפות בין טיולים');
  });

  s.test('tripDates נגזר מהמקטעים', async () => {
    await db.wipe();
    const t = await trips.createTrip({ name: 'נגזר', homeCurrency: 'ILS' });
    await db.put(db.STORES.segments, { tripId: t.id, city: 'רומא', startDate: '2026-10-05', endDate: '2026-10-09', currency: 'EUR' });
    await db.put(db.STORES.segments, { tripId: t.id, city: 'מילאנו', startDate: '2026-10-01', endDate: '2026-10-05', currency: 'EUR' });
    assertEqual(await trips.tripDates(t.id), { startDate: '2026-10-01', endDate: '2026-10-09', days: 9 });
  });

  s.test('טיול בלי מקטעים מחזיר תאריכים ריקים ולא קורס', async () => {
    await db.wipe();
    const t = await trips.createTrip({ name: 'ריק', homeCurrency: 'ILS' });
    assertEqual(await trips.tripDates(t.id), { startDate: null, endDate: null, days: 0 });
  });

  s.test('טיול של יום אחד', async () => {
    await db.wipe();
    const t = await trips.createTrip({ name: 'יום', homeCurrency: 'ILS' });
    await db.put(db.STORES.segments, { tripId: t.id, city: 'עקבה', startDate: '2026-10-01', endDate: '2026-10-01', currency: 'JOD' });
    assertEqual(await trips.tripDates(t.id), { startDate: '2026-10-01', endDate: '2026-10-01', days: 1 });
  });

  s.test('טיול חוצה שנה', async () => {
    await db.wipe();
    const t = await trips.createTrip({ name: 'סילבסטר', homeCurrency: 'ILS' });
    await db.put(db.STORES.segments, { tripId: t.id, city: 'וינה', startDate: '2026-12-28', endDate: '2027-01-03', currency: 'EUR' });
    assertEqual(await trips.tripDates(t.id), { startDate: '2026-12-28', endDate: '2027-01-03', days: 7 });
  });

  s.test('שני טיולים חופפים בתאריכים אינם מתערבבים', async () => {
    await db.wipe();
    const a = await trips.createTrip({ name: 'א', homeCurrency: 'ILS' });
    const b = await trips.createTrip({ name: 'ב', homeCurrency: 'ILS' });
    await db.put(db.STORES.segments, { tripId: a.id, city: 'פריז', startDate: '2026-10-01', endDate: '2026-10-05', currency: 'EUR' });
    await db.put(db.STORES.segments, { tripId: b.id, city: 'ליסבון', startDate: '2026-10-03', endDate: '2026-10-07', currency: 'EUR' });
    assertEqual((await trips.tripDates(a.id)).endDate, '2026-10-05');
    assertEqual((await trips.tripDates(b.id)).startDate, '2026-10-03');
  });

  s.test('createTrip בלי שם נכשל בעברית', async () => {
    await assertThrows(() => trips.createTrip({ name: '   ', homeCurrency: 'ILS' }), 'שם ריק עבר');
  });

  s.test('updateTrip משנה סטטוס ושומר על הקטגוריות', async () => {
    await db.wipe();
    const t = await trips.createTrip({ name: 'עדכון', homeCurrency: 'ILS' });
    const t2 = await trips.updateTrip({ ...t, status: 'active' });
    assertEqual(t2.status, 'active');
    assertEqual((await trips.categories(t.id)).length, 8);
  });

  s.test('upsertCategory מוסיף קטגוריה חדשה ומעדכן קיימת', async () => {
    await db.wipe();
    const t = await trips.createTrip({ name: 'קט', homeCurrency: 'ILS' });
    const c = await trips.upsertCategory(t.id, { name: 'ביטוח', color: '#06BCC1' });
    assertEqual((await trips.categories(t.id)).length, 9);
    await trips.upsertCategory(t.id, { id: c.id, name: 'ביטוח נסיעות', color: '#06BCC1' });
    const found = (await trips.categories(t.id)).find(x => x.id === c.id);
    assertEqual([found.name, (await trips.categories(t.id)).length], ['ביטוח נסיעות', 9]);
  });

  s.test('removeCategory מסרב כשיש הוצאה שמצביעה עליה', async () => {
    await db.wipe();
    const t = await trips.createTrip({ name: 'הגנה', homeCurrency: 'ILS' });
    const cat = (await trips.categories(t.id))[0];
    await db.put(db.STORES.expenses, {
      tripId: t.id, amount: 10, currency: 'ILS', rateToILS: 1,
      rateDate: '2026-09-03', date: '2026-09-03', categoryId: cat.id, method: 'cash',
    });
    await assertThrows(() => trips.removeCategory(t.id, cat.id), 'קטגוריה בשימוש נמחקה');
    assertEqual((await trips.categories(t.id)).length, 8);
  });

  s.test('removeTrip מוחק טיול עם הוצאות ולא נוגע בשני', async () => {
    await db.wipe();
    const a = await trips.createTrip({ name: 'א', homeCurrency: 'ILS' });
    const b = await trips.createTrip({ name: 'ב', homeCurrency: 'ILS' });
    await db.put(db.STORES.expenses, {
      tripId: a.id, amount: 100, currency: 'ILS', rateToILS: 1,
      rateDate: '2026-09-03', date: '2026-09-03', method: 'cash',
    });
    await trips.removeTrip(a.id);
    assertEqual((await trips.listTrips()).map(x => x.id), [b.id]);
    assertEqual((await db.all(db.STORES.expenses, a.id)).length, 0);
    assertEqual((await trips.categories(a.id)).length, 0);
    assertEqual((await trips.categories(b.id)).length, 8);
  });

  s.test('listTrips ממוין מהחדש לישן', async () => {
    await db.wipe();
    await trips.createTrip({ name: 'ראשון', homeCurrency: 'ILS' });
    await new Promise(r => setTimeout(r, 5));
    await trips.createTrip({ name: 'שני', homeCurrency: 'ILS' });
    assertEqual((await trips.listTrips()).map(t => t.name), ['שני', 'ראשון']);
  });

  await s.done();
}
