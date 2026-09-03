import { suite, assertEqual, assertTrue, assertClose, assertThrows } from './harness.js';
import * as db from '../js/db.js';
import * as trips from '../js/trips.js';
import * as it from '../js/itinerary.js';
import * as money from '../js/money.js';

async function freshTrip(totalBudget) {
  await db.wipe();
  return trips.createTrip({ name: 'מטבעות', homeCurrency: 'ILS', totalBudget });
}

export default async function () {
  const s = suite('מטבעות, שערים וסיכום');
  await db.useTestDatabase();
  const realFetch = window.fetch;

  s.test('getRate על מטבע זהה למטבע הבית מחזיר יחס 1 בלי לגעת ברשת', async () => {
    await db.wipe();
    assertEqual((await money.getRate('ILS')).rate, 1);
  });

  s.test('getRate על מטבע בלי שער שמור מחזיר null ולא קורס', async () => {
    await db.wipe();
    assertEqual(await money.getRate('XYZ'), null);
  });

  s.test('setManualRate שומר שער ידני שנקרא חזרה דרך getRate', async () => {
    await db.wipe();
    await money.setManualRate('XYZ', 2.5);
    const r = await money.getRate('XYZ');
    assertEqual([r.rate, r.source, r.stale], [2.5, 'manual', false]);
  });

  s.test('setManualRate דוחה שער אפס ושלילי', async () => {
    await db.wipe();
    await assertThrows(() => money.setManualRate('XYZ', 0), 'שער אפס עבר');
    await assertThrows(() => money.setManualRate('XYZ', -3), 'שער שלילי עבר');
  });

  s.test('getRate מסמן stale כשהשער ישן מיממה', async () => {
    await db.wipe();
    await db.put(db.STORES.fxRates, {
      pair: 'OLD_ILS', rate: 3, source: 'manual',
      ts: new Date(Date.now() - 48 * 3600 * 1000).toISOString(),
    });
    const r = await money.getRate('OLD');
    assertEqual(r.stale, true);
  });

  s.test('refreshRates נופל מ-Frankfurter ל-er-api כשהראשון נכשל', async () => {
    await db.wipe();
    window.fetch = async (url) => {
      if (String(url).includes('frankfurter')) return { ok: false };
      return { ok: true, json: async () => ({ rates: { ILS: 3.7 } }) };
    };
    try {
      const res = await money.refreshRates(['USD']);
      assertEqual([res.USD.ok, res.USD.source, res.USD.rate], [true, 'er-api', 3.7]);
      assertEqual((await money.getRate('USD')).source, 'er-api');
    } finally { window.fetch = realFetch; }
  });

  s.test('refreshRates לא נכשל וזורק כשגם Frankfurter וגם er-api נופלים (אופליין)', async () => {
    await db.wipe();
    window.fetch = async () => { throw new Error('offline'); };
    try {
      const res = await money.refreshRates(['EUR']);
      assertEqual(res.EUR, { ok: false });
    } finally { window.fetch = realFetch; }
  });

  s.test('stamp צורב rate/source/date רק כשיש מידע שער', () => {
    const withRate = money.stamp(10, 'usd', { rate: 3.7, source: 'frankfurter' });
    assertEqual([withRate.currency, withRate.rateToILS, withRate.rateSource], ['USD', 3.7, 'frankfurter']);
    const withoutRate = money.stamp(10, 'usd', null);
    assertEqual(withoutRate.rateToILS, undefined);
  });

  s.test('migrateMissingRates ממלא שער לפריטים ישנים בלבד, ולא נוגע בפריט עם שער קיים', async () => {
    const t = await freshTrip(0);
    await money.setManualRate('USD', 3.7);
    const withRate = await it.saveItem(t.id, { type: 'other', title: 'עם שער', date: '2026-01-01', currency: 'USD', actualAmount: 10, rateToILS: 4.0 });
    const withoutRate = await it.saveItem(t.id, { type: 'other', title: 'בלי שער', date: '2026-01-01', currency: 'USD', actualAmount: 10 });
    const sameCurrency = await it.saveItem(t.id, { type: 'other', title: 'בשקל', date: '2026-01-01', currency: 'ILS', actualAmount: 10 });

    const result = await money.migrateMissingRates(t.id);
    assertEqual(result, { checked: 1, fixed: 1 });

    const after = await it.listItems(t.id);
    assertEqual(after.find(i => i.id === withRate.id).rateToILS, 4.0, 'שער קיים נדרס');
    assertEqual(after.find(i => i.id === withoutRate.id).rateToILS, 3.7, 'לא מולא שער חסר');
    assertEqual(after.find(i => i.id === sameCurrency.id).rateToILS, undefined, 'מטבע ביתי קיבל שער בטעות');
  });

  s.test('שינוי שער אחרי הזנה — הוצאות עבר נשארות קפואות', async () => {
    const t = await freshTrip(0);
    await money.setManualRate('USD', 3.7);
    const item = await it.saveItem(t.id, { type: 'other', title: 'פריט', date: '2026-01-01', currency: 'USD', actualAmount: 100, rateToILS: 3.7 });
    await money.setManualRate('USD', 4.5); // עדכון שער מאוחר יותר
    const stillFrozen = (await it.listItems(t.id)).find(i => i.id === item.id);
    assertEqual(stillFrozen.rateToILS, 3.7, 'השער הקפוא השתנה בעקבות עדכון גלובלי');
  });

  s.test('summary מחשב מתוכנן/בפועל/יתרה ופילוח לפי קטגוריה נכון', async () => {
    const t = await freshTrip(1000);
    const [cat] = await trips.categories(t.id);
    await it.saveItem(t.id, { type: 'other', title: 'א', date: '2026-01-01', categoryId: cat.id, plannedAmount: 200, actualAmount: 150, method: 'cash' });
    await db.put(db.STORES.expenses, { tripId: t.id, amount: 50, currency: 'ILS', date: '2026-01-02', categoryId: cat.id, method: 'credit' });

    const sum = await money.summary(t.id);
    assertEqual(sum.totalPaid, 200);
    assertEqual(sum.balance, 800);
    assertEqual(sum.byCategory.find(c => c.id === cat.id).amount, 200);
    assertClose(sum.byCategory.reduce((s, c) => s + c.amount, 0), sum.totalPaid, 0.001, 'העוגה לא משקפת את סך ההוצאות');
    assertEqual(sum.byMethod.find(m => m.method === 'cash').amount, 150);
    assertEqual(sum.byMethod.find(m => m.method === 'credit').amount, 50);
  });

  window.fetch = realFetch;
  await s.done();
}
