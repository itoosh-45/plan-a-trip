import { suite, assertEqual, assertClose, assertTrue, assertThrows } from './harness.js';
import * as db from '../js/db.js';
import * as trips from '../js/trips.js';
import * as it from '../js/itinerary.js';
import * as rates from '../js/rates.js';
import * as expenses from '../js/expenses.js';
import * as money from '../js/money.js';

/** טיול תאילנד: מטבע ראשי THB, שער קבוע 0.1 ש"ח לבאהט. */
async function scenario() {
  await db.wipe();
  await rates.setManualRate('THB', 0.1);
  await rates.setManualRate('USD', 3.7);
  const trip = await trips.createTrip({
    name: 'תאילנד', startDate: '2026-11-01', endDate: '2026-11-20', currency: 'THB', totalBudget: 10000,
  });
  const bangkok = await it.saveSegment(trip.id, {
    city: 'בנגקוק', startDate: '2026-11-01', endDate: '2026-11-10', allocation: 6000,
  });
  const phuket = await it.saveSegment(trip.id, {
    city: 'פוקט', startDate: '2026-11-11', endDate: '2026-11-20', allocation: 3000,
  });
  const general = await it.generalSegment(trip.id);
  const cats = await trips.categories(trip.id);
  const cat = name => cats.find(c => c.name === name).id;
  return { trip, bangkok, phuket, general, cat };
}

export default async function () {
  const s = suite('הוצאות, ארנק מזומן וסיכום');
  await db.useTestDatabase();

  // ---- שיוך למקטע ----

  s.test('הוצאה חייבת להיות משויכת למקטע', async () => {
    const { trip } = await scenario();
    await assertThrows(
      () => expenses.saveExpense(trip.id, { amount: 100, currency: 'THB' }),
      'הוצאה בלי מקטע נשמרה'
    );
  });

  s.test('הוצאה נשמרת עם תאריך אוטומטי בלי שנשאל עליו', async () => {
    const { trip, general } = await scenario();
    const e = await expenses.saveExpense(trip.id, { amount: 100, currency: 'THB', segmentId: general.id });
    assertEqual(e.date, new Date().toISOString().slice(0, 10));
  });

  s.test('סכום שלילי נדחה', async () => {
    const { trip, general } = await scenario();
    await assertThrows(
      () => expenses.saveExpense(trip.id, { amount: -5, currency: 'THB', segmentId: general.id }),
      'סכום שלילי נשמר'
    );
  });

  s.test('סוג רשומה לא מוכר נדחה', async () => {
    const { trip, general } = await scenario();
    await assertThrows(
      () => expenses.saveExpense(trip.id, { amount: 5, currency: 'THB', segmentId: general.id, kind: 'משהו' }),
      'סוג רשומה לא מוכר נשמר'
    );
  });

  // ---- צריבת שער ----

  s.test('השער נצרב ברגע ההזנה ואינו משתנה כששער העולם משתנה', async () => {
    const { trip, general } = await scenario();
    const e = await expenses.saveExpense(trip.id, { amount: 1000, currency: 'THB', segmentId: general.id });
    assertEqual(e.rateToILS, 0.1);
    await rates.setManualRate('THB', 0.2);
    const again = await db.get(db.STORES.expenses, e.id);
    assertEqual(again.rateToILS, 0.1, 'שער היסטורי השתנה בדיעבד');
  });

  // ---- ארנק מזומן ----

  s.test('יתרת הארנק = משיכות פחות הוצאות מזומן, לכל מטבע בנפרד', async () => {
    const { trip, bangkok } = await scenario();
    await expenses.saveExpense(trip.id, { kind: 'withdraw', amount: 2000, currency: 'THB', segmentId: bangkok.id });
    await expenses.saveExpense(trip.id, { kind: 'cashSpend', amount: 500, currency: 'THB', segmentId: bangkok.id });
    await expenses.saveExpense(trip.id, { kind: 'withdraw', amount: 100, currency: 'USD', segmentId: bangkok.id });
    const balances = await expenses.walletBalances(trip.id);
    assertEqual([balances.THB, balances.USD], [1500, 100]);
    assertEqual(Object.keys(balances).sort(), ['THB', 'USD']);
  });

  s.test('הוצאה במזומן גדולה מהיתרה נשמרת אך מסומנת כחריגה', async () => {
    const { trip, bangkok } = await scenario();
    await expenses.saveExpense(trip.id, { kind: 'withdraw', amount: 100, currency: 'THB', segmentId: bangkok.id });
    const res = await expenses.saveExpense(trip.id, {
      kind: 'cashSpend', amount: 300, currency: 'THB', segmentId: bangkok.id,
    });
    assertEqual(res.overdrawn, true, 'לא הותרעה חריגה מיתרת המזומן');
    assertEqual((await expenses.walletBalances(trip.id)).THB, -200);
  });

  // ---- הנוסחה המחייבת של סעיף 6 ----

  s.test('סך ההוצאות = הוצאות שאינן מזומן + סך המשיכות', async () => {
    const { trip, bangkok, phuket, cat } = await scenario();
    await expenses.saveExpense(trip.id, { amount: 1000, currency: 'THB', segmentId: bangkok.id, categoryId: cat('אוכל') });
    await expenses.saveExpense(trip.id, { kind: 'withdraw', amount: 2000, currency: 'THB', segmentId: bangkok.id });
    await expenses.saveExpense(trip.id, { kind: 'cashSpend', amount: 500, currency: 'THB', segmentId: bangkok.id, categoryId: cat('אוכל') });
    await expenses.saveExpense(trip.id, { kind: 'cashSpend', amount: 300, currency: 'THB', segmentId: phuket.id, categoryId: cat('תחבורה') });

    const t = await money.tripTotals(trip.id);
    assertClose(t.total, 3000, 0.01, 'סך ההוצאות אינו לפי הנוסחה');
  });

  s.test('המשיכות מתפרקות בקטגוריות, והיתרה היא פרוסה בשם "מזומן בארנק"', async () => {
    const { trip, bangkok, phuket, cat } = await scenario();
    await expenses.saveExpense(trip.id, { amount: 1000, currency: 'THB', segmentId: bangkok.id, categoryId: cat('אוכל') });
    await expenses.saveExpense(trip.id, { kind: 'withdraw', amount: 2000, currency: 'THB', segmentId: bangkok.id });
    await expenses.saveExpense(trip.id, { kind: 'cashSpend', amount: 500, currency: 'THB', segmentId: bangkok.id, categoryId: cat('אוכל') });
    await expenses.saveExpense(trip.id, { kind: 'cashSpend', amount: 300, currency: 'THB', segmentId: phuket.id, categoryId: cat('תחבורה') });

    const t = await money.tripTotals(trip.id);
    const byName = Object.fromEntries(t.byCategory.map(c => [c.name, c.amount]));
    assertClose(byName['אוכל'], 1500, 0.01);
    assertClose(byName['תחבורה'], 300, 0.01);
    assertClose(byName['מזומן בארנק'], 1200, 0.01);
    assertClose(t.byCategory.reduce((x, c) => x + c.amount, 0), t.total, 0.01,
      'פילוח הקטגוריות אינו מסתכם לסך ההוצאות');
  });

  s.test('קיבוץ לפי מקטע מסתכם לסך הכולל, והמזומן שהוצא אינו נספר פעמיים', async () => {
    const { trip, bangkok, phuket, cat } = await scenario();
    await expenses.saveExpense(trip.id, { amount: 1000, currency: 'THB', segmentId: bangkok.id, categoryId: cat('אוכל') });
    await expenses.saveExpense(trip.id, { kind: 'withdraw', amount: 2000, currency: 'THB', segmentId: bangkok.id });
    await expenses.saveExpense(trip.id, { kind: 'cashSpend', amount: 300, currency: 'THB', segmentId: phuket.id, categoryId: cat('תחבורה') });

    const t = await money.tripTotals(trip.id);
    const bySeg = Object.fromEntries(t.bySegment.map(g => [g.city, g.amount]));
    assertClose(bySeg['בנגקוק'], 3000, 0.01);
    assertClose(bySeg['פוקט'], 0, 0.01);
    assertClose(t.bySegment.reduce((x, g) => x + g.amount, 0), t.total, 0.01);
  });

  s.test('כל מקטע מושווה להקצאה שלו ומסומן בחריגה', async () => {
    const { trip, bangkok, cat } = await scenario();
    await expenses.saveExpense(trip.id, { amount: 7000, currency: 'THB', segmentId: bangkok.id, categoryId: cat('אוכל') });
    const t = await money.tripTotals(trip.id);
    const bkk = t.bySegment.find(g => g.city === 'בנגקוק');
    assertEqual([bkk.allocation, bkk.over], [6000, true]);
  });

  // ---- מטבע זר בתוך טיול במטבע אחר ----

  s.test('הוצאה בדולר מוצגת במטבע הטיול לפי שער צרוב', async () => {
    const { trip, bangkok } = await scenario();
    // 100 USD = 370 ש"ח = 3700 באהט (0.1 ש"ח לבאהט)
    await expenses.saveExpense(trip.id, { amount: 100, currency: 'USD', segmentId: bangkok.id });
    const t = await money.tripTotals(trip.id);
    assertClose(t.total, 3700, 0.01);
  });

  s.test('סכום בשקלים אינו מקבל המרה', async () => {
    assertEqual(rates.toILS({ amount: 250, currency: 'ILS' }), 250);
  });

  s.test('סכום בלי שער שמור מוצג כמו שהוא ולא מתפוצץ', async () => {
    assertEqual(rates.toILS({ amount: 40, currency: 'XYZ' }), 40);
  });

  s.test('מחיקת הוצאה מסירה אותה מהסיכום', async () => {
    const { trip, bangkok, cat } = await scenario();
    const e = await expenses.saveExpense(trip.id, { amount: 500, currency: 'THB', segmentId: bangkok.id, categoryId: cat('אוכל') });
    await expenses.removeExpense(trip.id, e.id);
    assertEqual((await money.tripTotals(trip.id)).total, 0);
  });

  s.test('500 הוצאות מסתכמות נכון ובזמן סביר', async () => {
    const { trip, bangkok } = await scenario();
    const rows = Array.from({ length: 500 }, () => ({
      tripId: trip.id, segmentId: bangkok.id, kind: 'expense',
      amount: 10, currency: 'THB', rateToILS: 0.1, rateDate: '2026-11-01',
      date: '2026-11-02',
    }));
    await db.bulkPut(db.STORES.expenses, rows);
    const started = performance.now();
    const t = await money.tripTotals(trip.id);
    assertClose(t.total, 5000, 0.01);
    assertTrue(performance.now() - started < 2000, 'החישוב ל-500 הוצאות ארך יותר משתי שניות');
  });

  await s.done();
}
