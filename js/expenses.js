import * as db from './db.js';
import * as rates from './rates.js';

/**
 * שלושה סוגי רשומה, וזו ההגדרה היחידה שלהם:
 *  expense   — הוצאה רגילה. נספרת בסך ההוצאות.
 *  withdraw  — משיכת מזומן מכספומט. זו ההוצאה: נספרת במלואה, ומגדילה את הארנק.
 *  cashSpend — הוצאה במזומן. מקטינה את הארנק, ואינה נספרת (הכסף נספר במשיכה).
 */
export const KINDS = { expense: 'הוצאה', withdraw: 'משיכת מזומן', cashSpend: 'הוצאה במזומן' };

const today = () => new Date().toISOString().slice(0, 10);

export async function saveExpense(tripId, exp) {
  const kind = exp.kind || 'expense';
  if (!KINDS[kind]) throw new Error(`סוג רשומה לא מוכר: ${kind}`);

  const amount = Number(exp.amount);
  if (!Number.isFinite(amount) || amount < 0) throw new Error('הסכום חייב להיות מספר אפס ומעלה');
  if (!exp.segmentId) throw new Error('יש לשייך את ההוצאה ליעד או למקטע "כללי"');

  const currency = (exp.currency || 'ILS').toUpperCase();
  const payload = { ...exp, id: exp.id, tripId, kind, amount, currency, date: exp.date || today() };
  if (!payload.rateToILS) Object.assign(payload, await rates.stamp(currency));

  const saved = await db.put(db.STORES.expenses, payload);
  if (kind !== 'cashSpend') return saved;

  const balance = (await walletBalances(tripId))[currency] ?? 0;
  return balance < 0 ? { ...saved, overdrawn: true } : saved;
}

export async function removeExpense(tripId, expenseId) {
  await db.remove(db.STORES.expenses, expenseId);
}

export async function list(tripId) {
  const rows = await db.all(db.STORES.expenses, tripId);
  return rows.sort((a, b) =>
    String(b.date).localeCompare(String(a.date)) ||
    String(b.createdAt).localeCompare(String(a.createdAt)));
}

/** ארנק נפרד לכל מטבע שנמשך בו מזומן. */
export async function walletBalances(tripId) {
  const rows = await db.all(db.STORES.expenses, tripId);
  const out = {};
  for (const r of rows) {
    if (r.kind !== 'withdraw' && r.kind !== 'cashSpend') continue;
    const delta = r.kind === 'withdraw' ? r.amount : -r.amount;
    out[r.currency] = rates.round2((out[r.currency] || 0) + delta);
  }
  return out;
}
