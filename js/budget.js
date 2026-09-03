import * as db from './db.js';
import * as trips from './trips.js';
import { effectiveAmount } from './itinerary.js';

export function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * לפריטי מסלול (Item) יש actualAmount/plannedAmount ו"בפועל דורס מתוכנן".
 * להוצאות חופשיות (Expense) יש שדה amount פשוט. שתי הצורות מתקיימות באותה
 * מערך רשומות כאן, ולכן חייבים להבחין ביניהן ולא רק לקרוא ל-effectiveAmount.
 */
function rawAmount(rec) {
  if (rec.actualAmount !== undefined || rec.plannedAmount !== undefined) return effectiveAmount(rec);
  return rec.amount || 0;
}

/**
 * המרה לביתי בקירוב: אם נצרב rateToILS ברשומה — משתמשים בו. אחרת מוצג הסכום
 * הגולמי כמו שהוא. זהו הפער הידוע שנרשם בתוכנית: פריטים שנוצרו לפני משימה 8
 * (money.js) עדיין לא צורבים שער, ומשימה 8 חייבת למלא אותו רטרואקטיבית.
 */
function homeAmount(rec) {
  const amt = rawAmount(rec);
  return rec.rateToILS ? round2(amt * rec.rateToILS) : amt;
}

export async function setPlanned(tripId, categoryId, amount) {
  if (!categoryId) throw new Error('יש לבחור קטגוריה לפני קביעת תקציב');
  const n = Number(amount);
  if (!Number.isFinite(n) || n < 0) throw new Error('הסכום המתוכנן חייב להיות מספר אפס ומעלה');
  const existing = (await db.all(db.STORES.budgets, tripId)).find(b => b.categoryId === categoryId);
  return db.put(db.STORES.budgets, { ...(existing || {}), tripId, categoryId, plannedAmount: round2(n) });
}

/** שורה לכל קטגוריה: מתוכנן, בפועל, אחוז ניצול (null אם לא הוגדר תקציב), ויתרה. */
export async function rows(tripId) {
  const [cats, budgets, items, expenses] = await Promise.all([
    trips.categories(tripId),
    db.all(db.STORES.budgets, tripId),
    db.all(db.STORES.items, tripId),
    db.all(db.STORES.expenses, tripId),
  ]);

  return cats.map(cat => {
    const budget = budgets.find(b => b.categoryId === cat.id);
    const planned = budget?.plannedAmount || 0;
    const actual = round2(
      items.filter(i => i.categoryId === cat.id).reduce((s, i) => s + homeAmount(i), 0) +
      expenses.filter(e => e.categoryId === cat.id).reduce((s, e) => s + homeAmount(e), 0)
    );
    const pct = planned > 0 ? Math.round((actual / planned) * 100) : null;
    return {
      categoryId: cat.id,
      name: cat.name,
      color: cat.color,
      planned,
      actual,
      pct,
      remaining: round2(planned - actual),
      barClass: pct === null ? '' : pct > 100 ? 'over' : pct >= 80 ? 'warn' : '',
    };
  });
}
