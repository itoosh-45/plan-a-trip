import { suite, assertEqual, assertTrue, assertThrows } from './harness.js';
import * as db from '../js/db.js';
import * as trips from '../js/trips.js';
import * as it from '../js/itinerary.js';
import * as budget from '../js/budget.js';

async function freshTrip() {
  await db.wipe();
  return trips.createTrip({ name: 'תקציב', homeCurrency: 'ILS' });
}

export default async function () {
  const s = suite('תקציב');
  await db.useTestDatabase();

  s.test('setPlanned דוחה קטגוריה חסרה, סכום שלילי, ומקבל אפס', async () => {
    const t = await freshTrip();
    const [cat] = await trips.categories(t.id);
    await assertThrows(() => budget.setPlanned(t.id, null, 100), 'קטגוריה ריקה עברה');
    await assertThrows(() => budget.setPlanned(t.id, cat.id, -1), 'סכום שלילי עבר');
    await budget.setPlanned(t.id, cat.id, 0);
    assertEqual((await budget.rows(t.id)).find(r => r.categoryId === cat.id).planned, 0);
  });

  s.test('setPlanned קורא לאותה קטגוריה פעמיים מעדכן ולא משכפל', async () => {
    const t = await freshTrip();
    const [cat] = await trips.categories(t.id);
    await budget.setPlanned(t.id, cat.id, 1000);
    await budget.setPlanned(t.id, cat.id, 1500.5);
    const row = (await budget.rows(t.id)).find(r => r.categoryId === cat.id);
    assertEqual(row.planned, 1500.5);
  });

  s.test('קטגוריה בלי תקציב מוגדר מחזירה planned=0, pct=null, ולא קורסת', async () => {
    const t = await freshTrip();
    const catId = (await trips.categories(t.id))[0].id;
    await it.saveItem(t.id, { type: 'other', title: 'הוצאה בלי תקציב', date: '2026-01-01', categoryId: catId, actualAmount: 50 });
    const row = (await budget.rows(t.id)).find(r => r.categoryId === catId);
    assertEqual([row.planned, row.pct, row.actual], [0, null, 50]);
  });

  s.test('rows מצרף פריטים והוצאות חופשיות באותה קטגוריה', async () => {
    const t = await freshTrip();
    const [cat] = await trips.categories(t.id);
    await budget.setPlanned(t.id, cat.id, 1000);
    await it.saveItem(t.id, { type: 'other', title: 'פריט', date: '2026-01-01', categoryId: cat.id, actualAmount: 300 });
    await db.put(db.STORES.expenses, { tripId: t.id, amount: 200, currency: 'ILS', date: '2026-01-02', categoryId: cat.id, method: 'cash' });
    const row = (await budget.rows(t.id)).find(r => r.categoryId === cat.id);
    assertEqual(row.actual, 500);
    assertEqual(row.remaining, 500);
    assertEqual(row.pct, 50);
  });

  s.test('סף הפס: מתחת ל-80% ללא צבע, 80% warn, מעל 100% over', async () => {
    const t = await freshTrip();
    const [cat] = await trips.categories(t.id);
    await budget.setPlanned(t.id, cat.id, 100);
    await it.saveItem(t.id, { type: 'other', title: 'א', date: '2026-01-01', categoryId: cat.id, actualAmount: 79 });
    assertEqual((await budget.rows(t.id)).find(r => r.categoryId === cat.id).barClass, '');

    await it.saveItem(t.id, { type: 'other', title: 'ב', date: '2026-01-01', categoryId: cat.id, actualAmount: 1 });
    assertEqual((await budget.rows(t.id)).find(r => r.categoryId === cat.id).barClass, 'warn');

    await it.saveItem(t.id, { type: 'other', title: 'ג', date: '2026-01-01', categoryId: cat.id, actualAmount: 21 });
    assertEqual((await budget.rows(t.id)).find(r => r.categoryId === cat.id).barClass, 'over');
  });

  s.test('עשרוניות מצטברות מעוגלות נכון ולא סוטות משגיאת נקודה צפה', async () => {
    const t = await freshTrip();
    const [cat] = await trips.categories(t.id);
    await it.saveItem(t.id, { type: 'other', title: 'א', date: '2026-01-01', categoryId: cat.id, actualAmount: 0.1 });
    await it.saveItem(t.id, { type: 'other', title: 'ב', date: '2026-01-01', categoryId: cat.id, actualAmount: 0.2 });
    const row = (await budget.rows(t.id)).find(r => r.categoryId === cat.id);
    assertEqual(row.actual, 0.3);
  });

  s.test('רק rateToILS צרוב משפיע — פריט בלי שער נספר כערכו הגולמי', async () => {
    const t = await freshTrip();
    const [cat] = await trips.categories(t.id);
    await it.saveItem(t.id, { type: 'other', title: 'עם שער', date: '2026-01-01', categoryId: cat.id, actualAmount: 10, currency: 'USD', rateToILS: 3.7 });
    await it.saveItem(t.id, { type: 'other', title: 'בלי שער', date: '2026-01-01', categoryId: cat.id, actualAmount: 10, currency: 'USD' });
    const row = (await budget.rows(t.id)).find(r => r.categoryId === cat.id);
    assertEqual(row.actual, 47); // 10*3.7 + 10 (בלי שער — נספר כמו שהוא)
  });

  await s.done();
}
