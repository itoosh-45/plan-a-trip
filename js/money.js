import * as db from './db.js';
import * as trips from './trips.js';
import * as it from './itinerary.js';
import * as expenses from './expenses.js';
import * as rates from './rates.js';
import * as budgets from './budgets.js';

export const CASH_IN_WALLET = 'מזומן בארנק';
export const NO_CATEGORY = 'ללא קטגוריה';

const round2 = rates.round2;

/**
 * ממיר סכום למטבע הטיול, דרך השקל. שער שנצרב על הרשומה קודם לשער הנוכחי —
 * כך הוצאת עבר אינה משנה את ערכה כשהשער זז.
 *
 * כשאין שער בכלל — למטבע הרשומה או למטבע הטיול — מוחזר null, והסכום מדווח
 * דרך onMissing. סכום שאי אפשר להמיר לעולם לא ייספר כאילו הוא 1:1: זה בדיוק
 * מה שהציג 100 ש"ח כ-100 לארי.
 */
function converter(tripCurrency, fx, onMissing = () => {}) {
  const tRate = fx[tripCurrency];
  return (amount, currency, stamped) => {
    const code = (currency || tripCurrency).toUpperCase();
    const value = Number(amount) || 0;
    if (!value) return 0;
    if (code === tripCurrency) return round2(value);
    const toILS = stamped || fx[code];
    if (!toILS || !tRate) { onMissing(code, value); return null; }
    return round2((value * toILS) / tRate);
  };
}

/** כל המטבעות שנוגעים לטיול, כדי לשלוף את השערים במכה אחת. */
const currenciesOf = (...lists) => lists.flat().filter(Boolean);

/**
 * כל הכסף של הטיול במקום אחד.
 *   סך הוצאות = הוצאות שאינן מזומן + סך המשיכות
 *   פילוח קטגוריות = הוצאות + הוצאות מזומן בפועל + פרוסת "מזומן בארנק"
 * שני החישובים חייבים להסתכם לאותו מספר, ולכן הם יושבים בפונקציה אחת.
 */
export async function tripTotals(tripId) {
  const [trip, segs, cats, rows] = await Promise.all([
    trips.getTrip(tripId),
    it.listSegments(tripId),
    trips.categories(tripId),
    expenses.list(tripId),
  ]);

  const tripCurrency = (trip?.currency || 'ILS').toUpperCase();
  const balances = await expenses.walletBalances(tripId);
  const fx = await rates.rateMap(currenciesOf(
    tripCurrency, rows.map(r => r.currency), Object.keys(balances),
  ));

  // מטבע שאין לו שער אינו מומר, ומדווח בנפרד כדי שהמסך יוכל לומר זאת.
  const missing = new Map();
  const convert = converter(tripCurrency, fx,
    (code, amount) => missing.set(code, round2((missing.get(code) || 0) + amount)));

  const value = new Map(rows.map(r => [r.id, convert(r.amount, r.currency, r.rateToILS) ?? 0]));
  const inTrip = rec => value.get(rec.id) ?? 0;
  const counted = rows.filter(r => r.kind !== 'cashSpend');

  const total = round2(counted.reduce((sum, r) => sum + inTrip(r), 0));

  const bySegment = segs.map(seg => {
    const amount = round2(counted
      .filter(r => r.segmentId === seg.id)
      .reduce((sum, r) => sum + inTrip(r), 0));
    const allocation = Number(seg.allocation) || 0;
    return {
      id: seg.id, city: seg.city, kind: seg.kind,
      startDate: seg.startDate, endDate: seg.endDate,
      amount, allocation,
      remaining: round2(allocation - amount),
      over: allocation > 0 && amount > allocation,
    };
  });

  // המשיכה נספרה כהוצאה, ולכן היא מתפרקת לקטגוריות דרך הוצאות המזומן בפועל.
  const spent = rows.filter(r => r.kind === 'expense' || r.kind === 'cashSpend');
  const byCategory = cats.map(c => ({
    id: c.id, name: c.name, color: c.color, icon: c.icon,
    amount: round2(spent.filter(r => r.categoryId === c.id).reduce((s, r) => s + inTrip(r), 0)),
  }));

  const uncategorised = round2(spent
    .filter(r => !r.categoryId || !cats.some(c => c.id === r.categoryId))
    .reduce((s, r) => s + inTrip(r), 0));
  if (uncategorised) {
    byCategory.push({ id: 'none', name: NO_CATEGORY, color: '#8B95A1', icon: 'other', amount: uncategorised });
  }

  let cashInWallet = 0;
  for (const [currency, balance] of Object.entries(balances)) {
    cashInWallet += convert(balance, currency) ?? 0;
  }
  cashInWallet = round2(cashInWallet);
  if (cashInWallet) {
    // אפור נייטרלי בכוונה: מזומן שנותר בארנק אינו קטגוריית הוצאה,
    // ולכן הוא לא לוקח גוון מפלטת הקטגוריות.
    byCategory.push({ id: 'cash', name: CASH_IN_WALLET, color: '#8B95A1', icon: 'wallet', amount: cashInWallet });
  }

  const budget = await trips.budgetSummary(tripId);

  return {
    currency: tripCurrency,
    total,
    balances,
    cashInWallet,
    bySegment,
    byCategory: byCategory.filter(c => c.amount !== 0),
    ceiling: budget.ceiling,
    allocated: budget.allocated,
    unallocated: budget.unallocated,
    remaining: round2(budget.ceiling - total),
    overCeiling: budget.ceiling > 0 && total > budget.ceiling,
    // מטבעות שאין להם שער שמור, ולכן הסכומים בהם אינם נספרים בסך
    unconverted: [...missing].map(([currency, amount]) => ({ currency, amount })),
  };
}

/**
 * תכנון התקציב: שורה לכל קטגוריה שהוזן לה תקציב, עם מה ששולם בפועל ועם מה
 * שמתוכנן במסלול. החריגה נמדדת מול השולם בלבד — המתוכנן הוא מידע ולא חיוב.
 *
 * "מזומן בארנק" ו"ללא קטגוריה" אינם קטגוריות ולכן אינם מקבלים כאן שורה,
 * ומכאן שסכום השורות אינו חייב להשתוות לסך ההוצאות של הטיול.
 */
export async function budgetByCategory(tripId) {
  const [trip, cats, rows, items, totals] = await Promise.all([
    trips.getTrip(tripId),
    trips.categories(tripId),
    budgets.list(tripId),
    db.all(db.STORES.items, tripId),
    tripTotals(tripId),
  ]);

  const tripCurrency = (trip?.currency || 'ILS').toUpperCase();
  const fx = await rates.rateMap(currenciesOf(
    tripCurrency, items.map(i => i.currency), rows.map(b => b.currency),
  ));
  const convert = converter(tripCurrency, fx);
  const spentOf = new Map(totals.byCategory.map(c => [c.id, c.amount]));

  const plannedOf = new Map();
  for (const i of items) {
    if (!i.plannedAmount) continue;
    const value = convert(i.plannedAmount, i.currency, i.rateToILS);
    if (value === null) continue;   // בלי שער אין מה להוסיף לסכום
    const key = i.categoryId || 'none';
    plannedOf.set(key, round2((plannedOf.get(key) || 0) + value));
  }

  const order = new Map(cats.map((c, i) => [c.id, i]));
  const out = [];
  for (const row of rows) {
    const cat = cats.find(c => c.id === row.categoryId);
    if (!cat) continue;   // הקטגוריה נמחקה — התקציב שלה אינו תקציב של דבר
    // תקציב אינו נושא שער קפוא: הוא תוכנית קדימה, ולכן מומר לפי השער הנוכחי.
    const budget = convert(row.amount, row.currency) ?? round2(Number(row.amount) || 0);
    const spent = spentOf.get(cat.id) || 0;
    out.push({
      id: cat.id, name: cat.name, color: cat.color, icon: cat.icon,
      budget, spent,
      planned: plannedOf.get(cat.id) || 0,
      remaining: round2(budget - spent),
      over: budget > 0 && spent > budget,
    });
  }
  out.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

  const ceiling = trip?.totalBudget || 0;
  const budgeted = round2(out.reduce((sum, r) => sum + r.budget, 0));
  return {
    currency: tripCurrency,
    rows: out,
    budgeted,
    ceiling,
    unbudgeted: round2(ceiling - budgeted),
    over: ceiling > 0 && budgeted > ceiling,
    overBy: round2(budgeted - ceiling),
    cashInWallet: totals.cashInWallet,
    unconverted: totals.unconverted,
  };
}

/** סך העלויות המתוכננות במסלול, להשוואה מול התקציב. */
export async function plannedTotal(tripId) {
  const [trip, items] = await Promise.all([trips.getTrip(tripId), db.all(db.STORES.items, tripId)]);
  const tripCurrency = (trip?.currency || 'ILS').toUpperCase();
  const fx = await rates.rateMap(currenciesOf(tripCurrency, items.map(i => i.currency)));
  const convert = converter(tripCurrency, fx);
  return round2(items.reduce((sum, i) =>
    sum + (convert(i.plannedAmount, i.currency, i.rateToILS) ?? 0), 0));
}
