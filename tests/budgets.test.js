import { suite, assertEqual, assertClose, assertTrue, assertThrows } from './harness.js';
import * as db from '../js/db.js';
import * as rates from '../js/rates.js';
import * as trips from '../js/trips.js';
import * as it from '../js/itinerary.js';
import * as expenses from '../js/expenses.js';
import * as budgets from '../js/budgets.js';
import * as money from '../js/money.js';

/** טיול בשקלים, כדי שהתקציב וההוצאות יהיו באותו מטבע ובלי המרות. */
async function scenario({ totalBudget = 10000 } = {}) {
  await db.wipe();
  await rates.setManualRate('EUR', 4);
  const trip = await trips.createTrip({
    name: 'איטליה', startDate: '2026-05-01', endDate: '2026-05-10', currency: 'ILS', totalBudget,
  });
  const seg = await it.saveSegment(trip.id, {
    city: 'רומא', startDate: '2026-05-01', endDate: '2026-05-10', allocation: 0,
  });
  const cats = await trips.categories(trip.id);
  const cat = name => cats.find(c => c.name === name).id;
  return { trip, seg, cat };
}

export default async function () {
  const s = suite('תכנון תקציב לפי קטגוריה');
  await db.useTestDatabase();

  s.test('setBudget שומר, מעדכן, ואפס מסיר את הרשומה', async () => {
    const { trip, cat } = await scenario();
    await budgets.setBudget(trip.id, cat('טיסות'), 2000, 'ILS');
    assertEqual((await budgets.list(trip.id)).length, 1);

    await budgets.setBudget(trip.id, cat('טיסות'), 2500, 'ILS');
    const rows = await budgets.list(trip.id);
    assertEqual([rows.length, rows[0].amount], [1, 2500], 'תקציב שני נוצר במקום לעדכן');

    await budgets.setBudget(trip.id, cat('טיסות'), 0, 'ILS');
    assertEqual(await budgets.list(trip.id), []);
  });

  s.test('תקציב שלילי או ללא קטגוריה נדחה', async () => {
    const { trip, cat } = await scenario();
    await assertThrows(() => budgets.setBudget(trip.id, cat('לינה'), -5, 'ILS'), 'תקציב שלילי נשמר');
    await assertThrows(() => budgets.setBudget(trip.id, '', 100, 'ILS'), 'תקציב בלי קטגוריה נשמר');
  });

  s.test('שורת קטגוריה: שולם, מתוכנן במסלול, יתרה וחריגה', async () => {
    const { trip, seg, cat } = await scenario();
    await budgets.setBudget(trip.id, cat('אוכל'), 1000, 'ILS');
    await expenses.saveExpense(trip.id, {
      amount: 400, currency: 'ILS', segmentId: seg.id, categoryId: cat('אוכל'),
    });
    await it.saveItem(trip.id, {
      type: 'restaurant', title: 'ארוחה מוזמנת', date: '2026-05-02', segmentId: seg.id,
      categoryId: cat('אוכל'), plannedAmount: 250, currency: 'ILS',
    });

    const [row] = (await money.budgetByCategory(trip.id)).rows;
    assertEqual([row.name, row.budget, row.spent, row.planned], ['אוכל', 1000, 400, 250]);
    assertEqual([row.remaining, row.over], [600, false]);
  });

  s.test('חריגה נמדדת מול השולם בלבד, לא מול המתוכנן', async () => {
    const { trip, seg, cat } = await scenario();
    await budgets.setBudget(trip.id, cat('לינה'), 500, 'ILS');
    await it.saveItem(trip.id, {
      type: 'lodging', title: 'מלון', date: '2026-05-02', segmentId: seg.id,
      categoryId: cat('לינה'), plannedAmount: 900, currency: 'ILS',
    });
    let [row] = (await money.budgetByCategory(trip.id)).rows;
    assertEqual([row.planned, row.over], [900, false], 'מתוכנן במסלול סימן חריגה');

    await expenses.saveExpense(trip.id, {
      amount: 620, currency: 'ILS', segmentId: seg.id, categoryId: cat('לינה'),
    });
    [row] = (await money.budgetByCategory(trip.id)).rows;
    assertEqual([row.spent, row.over, row.remaining], [620, true, -120]);
  });

  s.test('הוצאה במטבע זר נספרת בתקציב לפי השער שנצרב עליה', async () => {
    const { trip, seg, cat } = await scenario();
    await budgets.setBudget(trip.id, cat('אטרקציות'), 1000, 'ILS');
    await expenses.saveExpense(trip.id, {
      amount: 50, currency: 'EUR', segmentId: seg.id, categoryId: cat('אטרקציות'),
    });
    const [row] = (await money.budgetByCategory(trip.id)).rows;
    assertClose(row.spent, 200, 0.01, '50 יורו בשער 4');
  });

  s.test('סך התקציבים מול תקרת הטיול, ותקרה 0 אינה חריגה', async () => {
    const { trip, cat } = await scenario({ totalBudget: 3000 });
    await budgets.setBudget(trip.id, cat('טיסות'), 2000, 'ILS');
    await budgets.setBudget(trip.id, cat('לינה'), 1500, 'ILS');
    let sum = await money.budgetByCategory(trip.id);
    assertEqual([sum.budgeted, sum.ceiling, sum.over, sum.overBy], [3500, 3000, true, 500]);
    assertEqual(sum.unbudgeted, -500);

    await trips.updateTrip({ ...trip, totalBudget: 0 });
    sum = await money.budgetByCategory(trip.id);
    assertEqual([sum.budgeted, sum.over], [3500, false], 'טיול בלי תקרה סומן כחריגה');
  });

  s.test('הקצאות ליעדים בטיול בלי תקרה אינן חריגה', async () => {
    const { trip, seg } = await scenario({ totalBudget: 0 });
    await it.saveSegment(trip.id, { ...seg, allocation: 4000 });
    const summary = await trips.budgetSummary(trip.id);
    assertEqual([summary.allocated, summary.over], [4000, false]);
  });

  s.test('קטגוריה בשימוש אינה נמחקת, ופנויה נמחקת יחד עם התקציב שלה', async () => {
    const { trip, seg, cat } = await scenario();
    const foodId = cat('אוכל');
    await budgets.setBudget(trip.id, foodId, 700, 'ILS');
    await expenses.saveExpense(trip.id, {
      amount: 100, currency: 'ILS', segmentId: seg.id, categoryId: foodId,
    });
    await assertThrows(() => trips.removeCategory(trip.id, foodId), 'קטגוריה בשימוש נמחקה');

    const gearId = cat('ציוד');
    await budgets.setBudget(trip.id, gearId, 300, 'ILS');
    await trips.removeCategory(trip.id, gearId);
    assertEqual((await budgets.list(trip.id)).map(b => b.categoryId), [foodId]);
  });

  s.test('קטגוריית דיפולט שהוסרה מוצעת להחזרה, וחוזרת עם הצבע המקורי', async () => {
    const { trip, cat } = await scenario();
    const shopping = cat('קניות');
    const before = (await trips.missingDefaultCategories(trip.id)).length;
    await trips.removeCategory(trip.id, shopping);

    const missing = await trips.missingDefaultCategories(trip.id);
    assertEqual([missing.length, missing.at(-1).key], [before + 1, 'shopping']);

    const restored = await trips.restoreDefaultCategory(trip.id, 'shopping');
    assertEqual([restored.name, restored.color], ['קניות', '#CE6196']);
    assertEqual(await trips.missingDefaultCategories(trip.id), []);
    await assertThrows(() => trips.restoreDefaultCategory(trip.id, 'shopping'), 'קטגוריה הוחזרה פעמיים');
  });

  s.test('קטגוריה בשם חופשי מקבלת צבע פנוי, ושם כפול נדחה', async () => {
    const { trip } = await scenario();
    const created = await trips.addCategory(trip.id, 'ביטוח');
    assertTrue(/^#[0-9A-F]{6}$/i.test(created.color), 'לא התקבל צבע תקין');
    const used = (await trips.categories(trip.id)).filter(c => c.color === created.color);
    assertEqual(used.length, 1, 'הצבע החדש כבר היה בשימוש');
    await assertThrows(() => trips.addCategory(trip.id, 'ביטוח'), 'שם קטגוריה כפול התקבל');
  });

  s.test('תקציב של קטגוריה שנמחקה אינו מופיע בשורות', async () => {
    const { trip, cat } = await scenario();
    const gearId = cat('ציוד');
    await budgets.setBudget(trip.id, gearId, 300, 'ILS');
    await db.remove(db.STORES.categories, gearId);
    const sum = await money.budgetByCategory(trip.id);
    assertEqual([sum.rows.length, sum.budgeted], [0, 0]);
  });

  await s.done();
}
