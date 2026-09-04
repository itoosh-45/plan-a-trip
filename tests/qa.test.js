import { suite, assertEqual, assertClose, assertTrue, assertThrows } from './harness.js';
import * as db from '../js/db.js';
import * as trips from '../js/trips.js';
import * as it from '../js/itinerary.js';
import * as rates from '../js/rates.js';
import * as expenses from '../js/expenses.js';
import * as money from '../js/money.js';
import { fmtMoney, fmtDate, fmtDateRange } from '../js/ui.js';

async function tripWith(over = {}) {
  await db.wipe();
  const trip = await trips.createTrip({
    name: 'QA', startDate: '2026-11-01', endDate: '2026-11-10', currency: 'ILS', ...over,
  });
  const gen = await it.generalSegment(trip.id);
  return { trip, gen };
}

export default async function () {
  const s = suite('QA — מקרי קצה');
  await db.useTestDatabase();

  // ---- נתונים ----

  s.test('טיול בלי יעדים כלל מסתכם ל-0 ולא קורס', async () => {
    const { trip } = await tripWith();
    const t = await money.tripTotals(trip.id);
    assertEqual([t.total, t.bySegment.length, t.byCategory.length], [0, 1, 0]);
  });

  s.test('טיול של יום אחד עם יעד של יום אחד', async () => {
    const { trip } = await tripWith({ startDate: '2026-11-01', endDate: '2026-11-01' });
    const seg = await it.saveSegment(trip.id, { city: 'עקבה', startDate: '2026-11-01', endDate: '2026-11-01' });
    assertEqual(it.segmentDays(seg), ['2026-11-01']);
  });

  s.test('טיול חוצה שנה מחשיב את הימים נכון', async () => {
    const { trip } = await tripWith({ startDate: '2026-12-28', endDate: '2027-01-03' });
    assertEqual((await trips.tripDates(trip.id)).days, 7);
  });

  s.test('שני טיולים חופפים בתאריכים אינם מדליפים הוצאות', async () => {
    await db.wipe();
    const a = await trips.createTrip({ name: 'א', startDate: '2026-11-01', endDate: '2026-11-10', currency: 'ILS' });
    const b = await trips.createTrip({ name: 'ב', startDate: '2026-11-05', endDate: '2026-11-15', currency: 'ILS' });
    await expenses.saveExpense(a.id, { amount: 100, segmentId: (await it.generalSegment(a.id)).id });
    await expenses.saveExpense(b.id, { amount: 250, segmentId: (await it.generalSegment(b.id)).id });
    assertEqual((await money.tripTotals(a.id)).total, 100);
    assertEqual((await money.tripTotals(b.id)).total, 250);
  });

  s.test('מחיקת טיול עם הוצאות אינה נוגעת בטיול השני', async () => {
    await db.wipe();
    const a = await trips.createTrip({ name: 'א', currency: 'ILS' });
    const b = await trips.createTrip({ name: 'ב', currency: 'ILS' });
    await expenses.saveExpense(a.id, { amount: 100, segmentId: (await it.generalSegment(a.id)).id });
    await expenses.saveExpense(b.id, { amount: 250, segmentId: (await it.generalSegment(b.id)).id });
    await trips.removeTrip(a.id);
    assertEqual((await db.all(db.STORES.expenses, a.id)).length, 0);
    assertEqual((await db.all(db.STORES.expenses, b.id)).length, 1);
    assertEqual((await it.listSegments(a.id)).length, 0, 'המקטע הכללי לא נמחק עם הטיול');
  });

  // ---- כספים ----

  s.test('סכום אפס נדחה בכל שלושת סוגי הרשומות', async () => {
    const { trip, gen } = await tripWith();
    for (const kind of ['expense', 'withdraw', 'cashSpend']) {
      await assertThrows(
        () => expenses.saveExpense(trip.id, { kind, amount: 0, segmentId: gen.id }),
        `סכום אפס נשמר בסוג ${kind}`
      );
    }
    assertEqual((await money.tripTotals(trip.id)).total, 0);
  });

  s.test('סכום שלילי נדחה בעברית', async () => {
    const { trip, gen } = await tripWith();
    await assertThrows(() => expenses.saveExpense(trip.id, { amount: -1, segmentId: gen.id }));
  });

  s.test('עשרוניות נשמרות ומסתכמות בלי שגיאת נקודה צפה', async () => {
    const { trip, gen } = await tripWith();
    for (const amount of [0.1, 0.2, 10.05, 3.33]) {
      await expenses.saveExpense(trip.id, { amount, segmentId: gen.id });
    }
    assertClose((await money.tripTotals(trip.id)).total, 13.68, 0.001);
  });

  s.test('מטבע בלי שער שמור אינו קורס — הסכום מוצג כמו שהוא', async () => {
    const { trip, gen } = await tripWith();
    const e = await expenses.saveExpense(trip.id, { amount: 40, currency: 'XYZ', segmentId: gen.id });
    assertEqual(e.rateToILS, undefined, 'נצרב שער שלא קיים');
    assertEqual((await money.tripTotals(trip.id)).total, 40);
  });

  s.test('שינוי שער אחרי הזנה אינו משנה הוצאות עבר', async () => {
    const { trip, gen } = await tripWith();
    await rates.setManualRate('USD', 3.5);
    await expenses.saveExpense(trip.id, { amount: 100, currency: 'USD', segmentId: gen.id });
    const before = (await money.tripTotals(trip.id)).total;
    await rates.setManualRate('USD', 4.2);
    assertEqual((await money.tripTotals(trip.id)).total, before, 'הוצאת עבר השתנתה בדיעבד');
    assertEqual(before, 350);
  });

  s.test('חריגה מהתקציב מדווחת אך אינה חוסמת', async () => {
    const { trip, gen } = await tripWith({ totalBudget: 100 });
    await expenses.saveExpense(trip.id, { amount: 180, segmentId: gen.id });
    const t = await money.tripTotals(trip.id);
    assertEqual([t.overCeiling, t.remaining], [true, -80]);
  });

  s.test('תקציב שלא הוגדר אינו מסומן כחריגה', async () => {
    const { trip, gen } = await tripWith({ totalBudget: 0 });
    await expenses.saveExpense(trip.id, { amount: 180, segmentId: gen.id });
    const t = await money.tripTotals(trip.id);
    assertEqual(t.overCeiling, false);
  });

  s.test('משיכה שכולה הוצאה בפועל מאפסת את פרוסת המזומן בארנק', async () => {
    const { trip, gen } = await tripWith();
    await expenses.saveExpense(trip.id, { kind: 'withdraw', amount: 500, segmentId: gen.id });
    await expenses.saveExpense(trip.id, { kind: 'cashSpend', amount: 500, segmentId: gen.id });
    const t = await money.tripTotals(trip.id);
    assertEqual([t.total, t.cashInWallet], [500, 0]);
    assertEqual(t.byCategory.some(c => c.name === money.CASH_IN_WALLET), false);
  });

  s.test('אין ספירה כפולה: משיכה והוצאת מזומן על אותו כסף נספרות פעם אחת', async () => {
    const { trip, gen } = await tripWith();
    await expenses.saveExpense(trip.id, { kind: 'withdraw', amount: 1000, segmentId: gen.id });
    await expenses.saveExpense(trip.id, { kind: 'cashSpend', amount: 400, segmentId: gen.id });
    const t = await money.tripTotals(trip.id);
    const balances = await expenses.walletBalances(trip.id);
    assertEqual(t.total, 1000);
    assertEqual(1000, 400 + balances.ILS, 'סך המשיכות ≠ הוצאות מזומן + יתרת הארנק');
  });

  // ---- ממשק וטקסט ----

  s.test('שם ארוך מאוד נשמר במלואו ואינו נחתך בשכבת הנתונים', async () => {
    const { trip } = await tripWith();
    const long = 'מסעדה יפנית עם שם ארוך במיוחד '.repeat(12).trim();
    const seg = await it.saveSegment(trip.id, { city: long, startDate: '2026-11-02', endDate: '2026-11-03' });
    assertEqual((await db.get(db.STORES.segments, seg.id)).city, long);
  });

  s.test('סכומים גדולים מוצגים בלי אגורות, וקטנים עם', () => {
    assertTrue(fmtMoney(122265.22, 'ILS').includes('122,265'), fmtMoney(122265.22, 'ILS'));
    assertTrue(!fmtMoney(122265.22, 'ILS').includes('.22'), 'אגורות בסכום גדול');
    assertTrue(fmtMoney(12.5, 'ILS').includes('12.5'), fmtMoney(12.5, 'ILS'));
  });

  s.test('תאריך ריק אינו מדפיס "Invalid Date"', () => {
    assertEqual(fmtDate(''), '');
    assertEqual(fmtDateRange(null, null), '');
  });

  s.test('טווח של יום אחד מוצג כתאריך יחיד', () => {
    assertEqual(fmtDateRange('2026-11-01', '2026-11-01'), fmtDate('2026-11-01'));
  });

  s.test('500 הוצאות: הסיכום נשאר מדויק ומהיר', async () => {
    const { trip, gen } = await tripWith();
    await db.bulkPut(db.STORES.expenses, Array.from({ length: 500 }, () => ({
      tripId: trip.id, segmentId: gen.id, kind: 'expense', amount: 7.5,
      currency: 'ILS', rateToILS: 1, date: '2026-11-02',
    })));
    const started = performance.now();
    const t = await money.tripTotals(trip.id);
    const ms = performance.now() - started;
    assertClose(t.total, 3750, 0.01);
    assertTrue(ms < 2000, `חישוב 500 הוצאות ארך ${Math.round(ms)}ms`);
  });

  await s.done();
}
