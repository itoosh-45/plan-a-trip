import * as db from './db.js';
import * as trips from './trips.js';
import { round2 } from './rates.js';

/**
 * תקציב מתוכנן לקטגוריה. זו תוכנית קדימה ולא רשומה של כסף שיצא, ולכן —
 * בשונה מהוצאה — אין לה שער קפוא: הסכום נשמר במטבע הטיול שבו הוזן, ואם
 * מטבע הטיול משתנה בהמשך, ההמרה לתצוגה נעשית לפי השער הנוכחי.
 *
 * לכל קטגוריה יש לכל היותר רשומת תקציב אחת בטיול.
 */

export async function list(tripId) {
  return db.all(db.STORES.budgets, tripId);
}

export async function forCategory(tripId, categoryId) {
  return (await list(tripId)).find(b => b.categoryId === categoryId) || null;
}

/** סכום 0 או ריק פירושו "אין תקציב", ולכן הוא מוחק את הרשומה במקום לשמור אפס. */
export async function setBudget(tripId, categoryId, amount, currency) {
  if (!categoryId) throw new Error('יש לבחור קטגוריה');
  const value = Number(amount);
  if (!Number.isFinite(value) || value < 0) throw new Error('התקציב חייב להיות מספר');

  const existing = await forCategory(tripId, categoryId);
  if (!value) {
    if (existing) await db.remove(db.STORES.budgets, existing.id);
    return null;
  }

  const trip = await trips.getTrip(tripId);
  return db.put(db.STORES.budgets, {
    ...existing,
    id: existing?.id,
    tripId,
    categoryId,
    amount: round2(value),
    currency: (currency || existing?.currency || trip?.currency || 'ILS').toUpperCase(),
  });
}

export async function removeBudget(tripId, categoryId) {
  const existing = await forCategory(tripId, categoryId);
  if (existing) await db.remove(db.STORES.budgets, existing.id);
}
