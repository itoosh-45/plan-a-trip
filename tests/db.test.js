import { suite, assertEqual, assertTrue, assertThrows } from './harness.js';
import * as db from '../js/db.js';

export default async function () {
  const s = suite('שכבת הנתונים');

  await db.useTestDatabase();
  await db.wipe();

  s.test('put מייצר id, createdAt ו-updatedAt', async () => {
    const t = await db.put(db.STORES.trips, { name: 'יפן', homeCurrency: 'ILS' });
    assertTrue(!!t.id, 'לא נוצר id');
    assertTrue(!!t.createdAt, 'לא נוצר createdAt');
    assertEqual(t.createdAt, t.updatedAt, 'ברשומה חדשה שני החותמים זהים');
  });

  s.test('put חוזר על אותה רשומה שומר createdAt ומקדם updatedAt', async () => {
    const t = await db.put(db.STORES.trips, { name: 'גאורגיה', homeCurrency: 'ILS' });
    await new Promise(r => setTimeout(r, 5));
    const t2 = await db.put(db.STORES.trips, { ...t, name: 'גאורגיה 2026' });
    assertEqual(t2.createdAt, t.createdAt, 'createdAt השתנה');
    assertTrue(t2.updatedAt > t.updatedAt, 'updatedAt לא התקדם');
    assertEqual(t2.id, t.id, 'ה-id השתנה');
  });

  s.test('get מחזיר undefined על id שאינו קיים', async () => {
    assertEqual(await db.get(db.STORES.trips, 'no-such-id'), undefined);
  });

  s.test('all עם tripId מסנן, ושני טיולים לא דולפים זה לזה', async () => {
    await db.wipe();
    const a = await db.put(db.STORES.trips, { name: 'טיול א', homeCurrency: 'ILS' });
    const b = await db.put(db.STORES.trips, { name: 'טיול ב', homeCurrency: 'ILS' });
    await db.put(db.STORES.segments, { tripId: a.id, city: 'טוקיו', startDate: '2026-10-01', endDate: '2026-10-05', currency: 'JPY' });
    await db.put(db.STORES.segments, { tripId: a.id, city: 'קיוטו', startDate: '2026-10-05', endDate: '2026-10-08', currency: 'JPY' });
    await db.put(db.STORES.segments, { tripId: b.id, city: 'תביליסי', startDate: '2026-11-01', endDate: '2026-11-04', currency: 'GEL' });

    assertEqual((await db.all(db.STORES.segments, a.id)).length, 2);
    assertEqual((await db.all(db.STORES.segments, b.id)).length, 1);
    assertEqual((await db.all(db.STORES.segments)).length, 3);
  });

  s.test('put ל-store תלוי-טיול בלי tripId נכשל בעברית', async () => {
    await assertThrows(
      () => db.put(db.STORES.segments, { city: 'בלי טיול', startDate: '2026-01-01' }),
      'רשומה בלי tripId נשמרה'
    );
  });

  s.test('remove מוחק רשומה אחת בלבד', async () => {
    await db.wipe();
    const t = await db.put(db.STORES.trips, { name: 'ט', homeCurrency: 'ILS' });
    const e1 = await db.put(db.STORES.expenses, { tripId: t.id, amount: 10, currency: 'ILS', date: '2026-09-01' });
    await db.put(db.STORES.expenses, { tripId: t.id, amount: 20, currency: 'ILS', date: '2026-09-02' });
    await db.remove(db.STORES.expenses, e1.id);
    const left = await db.all(db.STORES.expenses, t.id);
    assertEqual([left.length, left[0].amount], [1, 20]);
  });

  s.test('deleteTrip מוחק את הטיול וכל התלויים בו, ולא נוגע בטיול השני', async () => {
    await db.wipe();
    const a = await db.put(db.STORES.trips, { name: 'א', homeCurrency: 'ILS' });
    const b = await db.put(db.STORES.trips, { name: 'ב', homeCurrency: 'ILS' });
    for (const tripId of [a.id, b.id]) {
      await db.put(db.STORES.segments, { tripId, city: 'עיר', startDate: '2026-01-01', endDate: '2026-01-03', currency: 'EUR' });
      await db.put(db.STORES.items, { tripId, type: 'flight', title: 'טיסה', date: '2026-01-01' });
      await db.put(db.STORES.expenses, { tripId, amount: 5, currency: 'EUR', date: '2026-01-02' });
      await db.put(db.STORES.prepTasks, { tripId, title: 'דרכון', phase: 'לפני', done: false });
    }
    await db.deleteTrip(a.id);

    assertEqual(await db.get(db.STORES.trips, a.id), undefined, 'הטיול לא נמחק');
    for (const st of ['segments', 'items', 'expenses', 'prepTasks']) {
      assertEqual((await db.all(db.STORES[st], a.id)).length, 0, `נשארו רשומות ב-${st}`);
      assertEqual((await db.all(db.STORES[st], b.id)).length, 1, `נפגעו רשומות של הטיול השני ב-${st}`);
    }
    assertTrue(!!(await db.get(db.STORES.trips, b.id)), 'הטיול השני נמחק');
  });

  s.test('data:changed משודר בכל כתיבה ובכל מחיקה', async () => {
    await db.wipe();
    let count = 0;
    const onChange = () => count++;
    document.addEventListener('data:changed', onChange);
    const t = await db.put(db.STORES.trips, { name: 'אירוע', homeCurrency: 'ILS' });
    await db.remove(db.STORES.trips, t.id);
    document.removeEventListener('data:changed', onChange);
    assertEqual(count, 2);
  });

  s.test('bulkPut שומר את כל הרשומות ומשדר אירוע אחד', async () => {
    await db.wipe();
    const t = await db.put(db.STORES.trips, { name: 'המוני', homeCurrency: 'ILS' });
    let events = 0;
    const onChange = () => events++;
    document.addEventListener('data:changed', onChange);
    const rows = Array.from({ length: 50 }, (_, i) => ({
      tripId: t.id, title: `משימה ${i}`, phase: 'לפני', done: false,
    }));
    const saved = await db.bulkPut(db.STORES.prepTasks, rows);
    document.removeEventListener('data:changed', onChange);
    assertEqual(saved.length, 50);
    assertEqual((await db.all(db.STORES.prepTasks, t.id)).length, 50);
    assertEqual(events, 1, 'bulkPut שידר יותר מאירוע אחד');
  });

  s.test('settings נשמרות ונקראות עם ברירת מחדל', async () => {
    assertEqual(await db.getSetting('homeCurrency', 'ILS'), 'ILS');
    await db.setSetting('homeCurrency', 'ILS');
    await db.setSetting('fxSource', 'frankfurter');
    assertEqual(await db.getSetting('fxSource', null), 'frankfurter');
    assertEqual(await db.getSetting('noSuchKey', 'ברירת מחדל'), 'ברירת מחדל');
  });

  s.test('exportAll מחזיר את כל ה-stores עם גרסת סכימה', async () => {
    await db.wipe();
    const t = await db.put(db.STORES.trips, { name: 'ייצוא', homeCurrency: 'ILS' });
    await db.put(db.STORES.expenses, { tripId: t.id, amount: 99, currency: 'ILS', date: '2026-09-03' });
    const dump = await db.exportAll();
    assertEqual(dump.schema, db.DB_VERSION);
    assertTrue(!!dump.exportedAt, 'חסר exportedAt');
    assertEqual(dump.stores.trips.length, 1);
    assertEqual(dump.stores.expenses.length, 1);
    assertTrue(Array.isArray(dump.stores.fxRates), 'fxRates אינו מערך');
  });

  s.test('importAll במצב replace משחזר בדיוק את אותם נתונים', async () => {
    await db.wipe();
    const t = await db.put(db.STORES.trips, { name: 'סיבוב', homeCurrency: 'ILS' });
    await db.put(db.STORES.expenses, { tripId: t.id, amount: 42.5, currency: 'EUR', date: '2026-09-03', rateToILS: 4.1, rateDate: '2026-09-03' });
    const dump = await db.exportAll();

    await db.wipe();
    assertEqual((await db.all(db.STORES.trips)).length, 0, 'wipe לא ניקה');

    await db.importAll(dump, 'replace');
    const trips = await db.all(db.STORES.trips);
    const exp = await db.all(db.STORES.expenses);
    assertEqual(trips.length, 1);
    assertEqual([exp[0].amount, exp[0].currency, exp[0].rateToILS], [42.5, 'EUR', 4.1]);

    const sortStores = stores => Object.fromEntries(
      Object.entries(stores).map(([k, rows]) => [k, [...rows].sort((a, b) => String(a.id ?? a.key ?? a.pair).localeCompare(String(b.id ?? b.key ?? b.pair)))])
    );
    assertEqual(JSON.stringify(sortStores((await db.exportAll()).stores)), JSON.stringify(sortStores(dump.stores)), 'ייצוא→ייבוא→ייצוא אינו זהה');
  });

  s.test('importAll על מבנה פסול נכשל בעברית ולא נוגע בנתונים', async () => {
    await db.wipe();
    const keep = await db.put(db.STORES.trips, { name: 'לא לגעת', homeCurrency: 'ILS' });
    await assertThrows(() => db.importAll(null, 'replace'), 'null עבר');
    await assertThrows(() => db.importAll({ stores: 'לא אובייקט' }, 'replace'), 'stores פסול עבר');
    await assertThrows(() => db.importAll({ schema: 1, stores: { noSuchStore: [] } }, 'replace'), 'store לא מוכר עבר');
    assertTrue(!!(await db.get(db.STORES.trips, keep.id)), 'הנתונים הקיימים נפגעו למרות הכישלון');
  });

  s.test('ביצועים: 500 הוצאות נכתבות ונקראות מתחת ל-3 שניות', async () => {
    await db.wipe();
    const t = await db.put(db.STORES.trips, { name: 'עומס', homeCurrency: 'ILS' });
    const rows = Array.from({ length: 500 }, (_, i) => ({
      tripId: t.id,
      amount: (i % 97) + 0.5,
      currency: 'ILS',
      rateToILS: 1,
      rateDate: '2026-09-03',
      categoryId: 'food',
      method: i % 2 ? 'cash' : 'credit',
      date: `2026-09-${String((i % 28) + 1).padStart(2, '0')}`,
    }));
    const t0 = performance.now();
    await db.bulkPut(db.STORES.expenses, rows);
    const read = await db.all(db.STORES.expenses, t.id);
    const ms = performance.now() - t0;
    assertEqual(read.length, 500);
    assertTrue(ms < 3000, `לקח ${Math.round(ms)}ms`);
  });

  s.test('wipe מנקה הכול', async () => {
    await db.wipe();
    const dump = await db.exportAll();
    assertEqual(Object.values(dump.stores).flat().length, 0);
  });

  await s.done();
}
