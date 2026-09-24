import { suite, assertEqual, assertTrue } from './harness.js';
import * as db from '../js/db.js';
import * as it from '../js/itinerary.js';
import * as expenses from '../js/expenses.js';
import * as money from '../js/money.js';
import * as migrate from '../js/migrate.js';

/** בונה מסד במבנה הישן (גרסה 1) בלי לעבור דרך המודולים החדשים. */
async function legacyDatabase() {
  await db.wipe();
  const trip = await db.put(db.STORES.trips, {
    name: 'תאילנד ישן', homeCurrency: 'THB', totalBudget: 10000, status: 'active',
  });
  const seg = await db.put(db.STORES.segments, {
    tripId: trip.id, city: 'בנגקוק', country: 'תאילנד',
    startDate: '2026-11-01', endDate: '2026-11-10', currency: 'THB',
  });
  const cat = await db.put(db.STORES.categories, {
    tripId: trip.id, key: 'food', name: 'אוכל', color: '#D97706',
  });
  // הוצאה שנופלת בתוך המקטע, והוצאה שנופלת מחוצה לו
  await db.put(db.STORES.expenses, {
    tripId: trip.id, amount: 400, currency: 'THB', date: '2026-11-05',
    categoryId: cat.id, method: 'credit', note: 'מלון',
  });
  await db.put(db.STORES.expenses, {
    tripId: trip.id, amount: 900, currency: 'THB', date: '2026-09-01',
    categoryId: cat.id, method: 'credit', note: 'ביטוח לפני היציאה',
  });
  // פריט מסלול עם סכום בפועל — הכסף עובר להיות הוצאה
  await db.put(db.STORES.items, {
    tripId: trip.id, segmentId: seg.id, type: 'lodging', title: 'מלון בנגקוק',
    date: '2026-11-02', plannedAmount: 1000, actualAmount: 1200, currency: 'THB',
    rateToILS: 0.1, payStatus: 'paid', method: 'credit', categoryId: cat.id,
  });
  // ארנק ישן: משיכה 2000, הוצאות מזומן 800
  const wallet = await db.put(db.STORES.wallets, { tripId: trip.id, currency: 'THB', status: 'open' });
  await db.put(db.STORES.walletTx, {
    tripId: trip.id, walletId: wallet.id, type: 'withdraw', amount: 2000, date: '2026-11-03',
  });
  await db.put(db.STORES.walletTx, {
    tripId: trip.id, walletId: wallet.id, type: 'spend', amount: 500, date: '2026-11-04', note: 'שוק',
  });
  await db.put(db.STORES.walletTx, {
    tripId: trip.id, walletId: wallet.id, type: 'spend', amount: 300, date: '2026-11-06', note: 'טוקטוק',
  });
  // פריטי צ׳קליסט ישנים
  await db.put(db.STORES.prepTasks, {
    tripId: trip.id, phase: 'לפני', title: 'דרכון', priority: 'חובה', done: false,
  });
  await db.put(db.STORES.prepTasks, {
    tripId: trip.id, phase: 'בדרך', title: 'צ׳ק-אין', priority: 'נוחות', done: false,
  });
  await db.put(db.STORES.prepTasks, {
    tripId: trip.id, phase: 'בשהות', title: 'סים מקומי', priority: 'רלוונטי', done: true,
  });
  await db.put(db.STORES.prepTasks, {
    tripId: trip.id, phase: 'בחזרה', title: 'החזר מס', done: false,
  });
  return { trip, seg, cat };
}

export default async function () {
  const s = suite('מיגרציה לנתונים קיימים');
  await db.useTestDatabase();

  s.test('נוצר מקטע "כללי" לכל טיול קיים', async () => {
    const { trip } = await legacyDatabase();
    await migrate.run();
    const gen = await it.generalSegment(trip.id);
    assertEqual([gen.kind, gen.city], ['general', 'כללי']);
  });

  s.test('הוצאה שתאריכה בתוך מקטע קיים משויכת אליו', async () => {
    const { trip, seg } = await legacyDatabase();
    await migrate.run();
    const hotel = (await expenses.list(trip.id)).find(e => e.note === 'מלון');
    assertEqual(hotel.segmentId, seg.id);
  });

  s.test('הוצאה מחוץ לכל מקטע משויכת ל"כללי"', async () => {
    const { trip } = await legacyDatabase();
    await migrate.run();
    const gen = await it.generalSegment(trip.id);
    const insurance = (await expenses.list(trip.id)).find(e => e.note === 'ביטוח לפני היציאה');
    assertEqual(insurance.segmentId, gen.id);
  });

  s.test('כל הוצאה מקבלת סוג רשומה ומטבע', async () => {
    const { trip } = await legacyDatabase();
    await migrate.run();
    const rows = await expenses.list(trip.id);
    assertEqual(rows.filter(e => !e.kind || !e.currency).length, 0);
  });

  s.test('שדה הסטטוס נמחק והמטבע הראשי עבר לשדה currency', async () => {
    const { trip } = await legacyDatabase();
    await migrate.run();
    const after = await db.get(db.STORES.trips, trip.id);
    assertEqual([after.status, after.currency], [undefined, 'THB']);
  });

  s.test('תאריכי הטיול נגזרים מהמקטעים הקיימים', async () => {
    const { trip } = await legacyDatabase();
    await migrate.run();
    const after = await db.get(db.STORES.trips, trip.id);
    assertEqual([after.startDate, after.endDate], ['2026-11-01', '2026-11-10']);
  });

  s.test('רשומות ארנק ישנות: משיכה = הוצאה, הוצאת מזומן = פילוח בלבד', async () => {
    const { trip } = await legacyDatabase();
    await migrate.run();
    const rows = await expenses.list(trip.id);
    assertEqual(rows.filter(e => e.kind === 'withdraw').length, 1);
    assertEqual(rows.filter(e => e.kind === 'cashSpend').length, 2);
    assertEqual((await expenses.walletBalances(trip.id)).THB, 1200);
  });

  s.test('אין ספירה כפולה: הסך הוא 400+900+1200 הוצאות ועוד 2000 משיכה', async () => {
    const { trip } = await legacyDatabase();
    await migrate.run();
    // מלון 400 + ביטוח 900 + פריט המסלול ששולם 1200 + משיכה 2000 = 4500
    assertEqual((await money.tripTotals(trip.id)).total, 4500);
  });

  s.test('פריט מסלול ששולם הפך להוצאה, והפריט עצמו נשאר עם המתוכנן', async () => {
    const { trip } = await legacyDatabase();
    await migrate.run();
    const item = (await it.listItems(trip.id))[0];
    assertEqual([item.title, item.plannedAmount, item.actualAmount], ['מלון בנגקוק', 1000, undefined]);
    const fromItem = (await expenses.list(trip.id)).find(e => e.amount === 1200);
    assertTrue(!!fromItem, 'הסכום ששולם לא הפך להוצאה');
  });

  s.test('פריטי צ׳קליסט מקבלים קטגוריה ודחיפות לפי העדיפות הקיימת', async () => {
    const { trip } = await legacyDatabase();
    await migrate.run();
    const tasks = await db.all(db.STORES.prepTasks, trip.id);
    const by = Object.fromEntries(tasks.map(t => [t.title, [t.stage, t.urgency]]));
    assertEqual(by['דרכון'], ['before', 'critical']);
    assertEqual(by['צ׳ק-אין'], ['before', 'normal'], '"בדרך" חייב להתמפות ל"לפני הטיול"');
    assertEqual(by['סים מקומי'], ['during', 'important']);
    assertEqual(by['החזר מס'], ['after', 'normal'], 'משימה בלי עדיפות מקבלת "רגיל"');
  });

  s.test('הרצה שנייה אינה משנה דבר ואינה מכפילה רשומות', async () => {
    const { trip } = await legacyDatabase();
    await migrate.run();
    const first = await expenses.list(trip.id);
    await db.setSetting('schemaVersion', 1); // מדמה שחזור גיבוי ישן
    await migrate.run();
    const second = await expenses.list(trip.id);
    assertEqual(second.length, first.length, 'המיגרציה שכפלה רשומות');
    assertEqual((await money.tripTotals(trip.id)).total, 4500);
  });

  s.test('שום טיול, הוצאה או פריט לא נמחק', async () => {
    const { trip } = await legacyDatabase();
    const before = {
      trips: (await db.all(db.STORES.trips)).length,
      items: (await db.all(db.STORES.items, trip.id)).length,
      expenses: (await db.all(db.STORES.expenses, trip.id)).length,
      tasks: (await db.all(db.STORES.prepTasks, trip.id)).length,
    };
    await migrate.run();
    assertEqual((await db.all(db.STORES.trips)).length, before.trips);
    assertEqual((await db.all(db.STORES.items, trip.id)).length, before.items);
    assertTrue((await db.all(db.STORES.expenses, trip.id)).length >= before.expenses, 'הוצאות נעלמו');
    assertEqual((await db.all(db.STORES.prepTasks, trip.id)).length, before.tasks);
  });

  s.test('מסד ריק עובר מיגרציה בלי לקרוס', async () => {
    await db.wipe();
    await migrate.run();
    assertEqual((await db.all(db.STORES.trips)).length, 0);
  });

  await s.done();
}
