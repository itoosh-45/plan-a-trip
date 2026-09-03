import * as db from './db.js';
import * as it from './itinerary.js';

export const EXPENSE_METHOD = it.PAY_METHOD;

export async function saveExpense(tripId, exp) {
  const amount = Number(exp.amount);
  if (!Number.isFinite(amount) || amount < 0) throw new Error('הסכום חייב להיות מספר אפס ומעלה');
  if (!exp.date) throw new Error('להוצאה חייב להיות תאריך');
  if (exp.method && !it.PAY_METHOD[exp.method]) throw new Error('אמצעי תשלום לא מוכר');
  return db.put(db.STORES.expenses, {
    ...exp, id: exp.id, tripId, amount, currency: (exp.currency || 'ILS').toUpperCase(),
  });
}

export async function removeExpense(tripId, expenseId) {
  await db.remove(db.STORES.expenses, expenseId);
}

/** מאחד פריטים ששולמו (actualAmount מוגדר) עם הוצאות חופשיות, לרשימת עסקאות אחת. */
export async function list(tripId, filters = {}) {
  const [items, expenses] = await Promise.all([
    it.listItems(tripId),
    db.all(db.STORES.expenses, tripId),
  ]);

  const fromItems = items
    .filter(i => i.actualAmount !== undefined && i.actualAmount !== null)
    .map(i => ({
      id: i.id, source: 'item', title: i.title, date: i.date,
      amount: it.effectiveAmount(i), currency: i.currency || 'ILS',
      categoryId: i.categoryId, method: i.method, rateToILS: i.rateToILS,
    }));

  const fromExpenses = expenses.map(e => ({
    id: e.id, source: 'expense', title: e.note || 'הוצאה', date: e.date,
    amount: e.amount, currency: e.currency, categoryId: e.categoryId,
    method: e.method, rateToILS: e.rateToILS,
  }));

  let rows = [...fromItems, ...fromExpenses].sort((a, b) => b.date.localeCompare(a.date));
  if (filters.categoryId) rows = rows.filter(r => r.categoryId === filters.categoryId);
  if (filters.method) rows = rows.filter(r => r.method === filters.method);
  if (filters.dateFrom) rows = rows.filter(r => r.date >= filters.dateFrom);
  if (filters.dateTo) rows = rows.filter(r => r.date <= filters.dateTo);
  return rows;
}
