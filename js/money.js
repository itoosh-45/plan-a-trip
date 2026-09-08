import * as db from './db.js';
import * as trips from './trips.js';
import * as it from './itinerary.js';
import * as expenses from './expenses.js';
import * as rates from './rates.js';
import * as budgets from './budgets.js';

export const CASH_IN_WALLET = 'מזומן בארנק';
export const NO_CATEGORY = 'ללא קטגוריה';

const round2 = rates.round2;

/** שער המטבע הראשי של הטיול, לצורך תצוגה בלבד. שערי הרשומות עצמן קפואים. */
async function tripRateToILS(trip) {
  if (!trip?.currency || trip.currency === 'ILS') return 1;
  return (await rates.getRate(trip.currency))?.rate || 1;
}

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
  const tRate = await tripRateToILS(trip);

  // רשומה שכבר במטבע הטיול מוצגת כמו שהיא. רק מטבע אחר עובר המרה, דרך השקל.
  const inTrip = rec => {
    const cur = (rec.currency || tripCurrency).toUpperCase();
    if (cur === tripCurrency) return round2(Number(rec.amount) || 0);
    return round2(rates.toILS(rec) / tRate);
  };
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

  const balances = await expenses.walletBalances(tripId);
  let cashInWallet = 0;
  for (const [currency, balance] of Object.entries(balances)) {
    if (currency === tripCurrency) { cashInWallet += balance; continue; }
    cashInWallet += (balance * ((await rates.getRate(currency))?.rate ?? 1)) / tRate;
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
  const tRate = await tripRateToILS(trip);
  const spentOf = new Map(totals.byCategory.map(c => [c.id, c.amount]));

  const plannedOf = new Map();
  for (const i of items) {
    if (!i.plannedAmount) continue;
    const key = i.categoryId || 'none';
    const value = rates.toILS({ amount: i.plannedAmount, rateToILS: i.rateToILS }) / tRate;
    plannedOf.set(key, round2((plannedOf.get(key) || 0) + value));
  }

  // תקציב אינו נושא שער קפוא, ולכן הוא מומר לפי השער הנוכחי כשמטבע הטיול השתנה.
  const rateCache = new Map();
  const toTrip = async (amount, currency) => {
    const code = (currency || tripCurrency).toUpperCase();
    if (code === tripCurrency) return round2(Number(amount) || 0);
    if (!rateCache.has(code)) rateCache.set(code, (await rates.getRate(code))?.rate ?? 1);
    return round2(((Number(amount) || 0) * rateCache.get(code)) / tRate);
  };

  const order = new Map(cats.map((c, i) => [c.id, i]));
  const out = [];
  for (const row of rows) {
    const cat = cats.find(c => c.id === row.categoryId);
    if (!cat) continue;   // הקטגוריה נמחקה — התקציב שלה אינו תקציב של דבר
    const budget = await toTrip(row.amount, row.currency);
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
  };
}

/** סך העלויות המתוכננות במסלול, להשוואה מול התקציב. */
export async function plannedTotal(tripId) {
  const [trip, items] = await Promise.all([trips.getTrip(tripId), db.all(db.STORES.items, tripId)]);
  const tRate = await tripRateToILS(trip);
  return round2(items.reduce((sum, i) =>
    sum + rates.toILS({ amount: i.plannedAmount || 0, rateToILS: i.rateToILS }) / tRate, 0));
}
