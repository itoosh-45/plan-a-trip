import * as db from './db.js';
import * as trips from './trips.js';
import * as it from './itinerary.js';
import * as prep from './prep.js';

export function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

const STALE_MS = 24 * 60 * 60 * 1000; // מעל יממה נחשב "ישן" — עדיין מוצג, לא חוסם

function pairKey(currency, base) {
  return `${currency.toUpperCase()}_${base.toUpperCase()}`;
}

/** השער השמור למטבע. null אם אין שער שמור — הקוראים מבקשים שער ידני. */
export async function getRate(currency, base = 'ILS') {
  const cur = (currency || base).toUpperCase();
  if (cur === base.toUpperCase()) return { rate: 1, ts: new Date().toISOString(), source: 'identity', stale: false };
  const row = await db.get(db.STORES.fxRates, pairKey(cur, base));
  if (!row) return null;
  return { rate: row.rate, ts: row.ts, source: row.source, stale: Date.now() - Date.parse(row.ts) > STALE_MS };
}

async function fetchFrankfurter(currency, base) {
  const res = await fetch(`https://api.frankfurter.dev/v1/latest?base=${currency}&symbols=${base}`);
  if (!res.ok) throw new Error('frankfurter unavailable');
  const data = await res.json();
  const rate = data?.rates?.[base];
  if (!rate) throw new Error('currency not supported by frankfurter');
  return rate;
}

async function fetchErApi(currency, base) {
  const res = await fetch(`https://open.er-api.com/v6/latest/${currency}`);
  if (!res.ok) throw new Error('er-api unavailable');
  const data = await res.json();
  const rate = data?.rates?.[base];
  if (!rate) throw new Error('currency not supported by er-api');
  return rate;
}

/**
 * מרענן שערים לרשימת מטבעות: Frankfurter קודם, נפילה ל-er-api. לא נכשל ולא
 * זורק על מטבע בודד שנכשל — מחזיר {ok:false} עבורו וממשיך לבא אחריו.
 */
export async function refreshRates(currencies, base = 'ILS') {
  const results = {};
  for (const raw of currencies) {
    const cur = (raw || '').toUpperCase();
    if (!cur || cur === base.toUpperCase()) continue;
    let rate, source;
    try {
      rate = await fetchFrankfurter(cur, base);
      source = 'frankfurter';
    } catch {
      try {
        rate = await fetchErApi(cur, base);
        source = 'er-api';
      } catch {
        results[cur] = { ok: false };
        continue;
      }
    }
    const ts = new Date().toISOString();
    await db.put(db.STORES.fxRates, { pair: pairKey(cur, base), rate, ts, source });
    results[cur] = { ok: true, rate, source, ts };
  }
  return results;
}

/** שער ידני שהמשתמש הזין כשלא נמצא שער אוטומטי. נשמר כמו כל שער אחר. */
export async function setManualRate(currency, rate, base = 'ILS') {
  const n = Number(rate);
  if (!Number.isFinite(n) || n <= 0) throw new Error('השער חייב להיות מספר גדול מאפס');
  const ts = new Date().toISOString();
  await db.put(db.STORES.fxRates, { pair: pairKey(currency, base), rate: n, ts, source: 'manual' });
  return { rate: n, ts, source: 'manual', stale: false };
}

/** צורב שער על סכום ברגע ההזנה. הרשומה קפואה: עדכון שער עתידי לא נוגע בה. */
export function stamp(amount, currency, rateInfo) {
  const out = { amount: Number(amount) || 0, currency: (currency || 'ILS').toUpperCase() };
  if (rateInfo?.rate) {
    out.rateToILS = rateInfo.rate;
    out.rateDate = new Date().toISOString().slice(0, 10);
    out.rateSource = rateInfo.source;
  }
  return out;
}

/** מאחד את שתי צורות הרשומה (Item עם actual/planned, Expense/PrepTask עם amount) לסכום ביתי. */
function homeAmount(rec) {
  const raw = (rec.actualAmount !== undefined || rec.plannedAmount !== undefined)
    ? it.effectiveAmount(rec)
    : (rec.amount || 0);
  return rec.rateToILS ? round2(raw * rec.rateToILS) : raw;
}

/**
 * ממלא רטרואקטיבית rateToILS לפריטים שנוצרו לפני שהמודול הזה נבנה (משימה 5)
 * ולכן נשמרו בלי שער צרוב. פריט עם שער קיים אינו נוגע — "בפועל דורס מתוכנן"
 * חל גם כאן: אחרי שנקבע שער, הוא קפוא לנצח. פריט שהמטבע שלו זהה לביתי, או
 * שאין לו מטבע בכלל, לא זקוק לשער ולכן לא נספר כ"חסר".
 */
export async function migrateMissingRates(tripId, homeCurrency = 'ILS') {
  const items = await it.listItems(tripId);
  const missing = items.filter(i =>
    (i.actualAmount !== undefined || i.plannedAmount !== undefined) &&
    i.currency && i.currency !== homeCurrency && !i.rateToILS
  );
  let fixed = 0;
  for (const i of missing) {
    const rateInfo = await getRate(i.currency, homeCurrency);
    if (rateInfo?.rate) {
      await db.put(db.STORES.items, {
        ...i, rateToILS: rateInfo.rate,
        rateDate: new Date().toISOString().slice(0, 10),
        rateSource: rateInfo.source,
      });
      fixed++;
    }
  }
  return { checked: missing.length, fixed };
}

export async function summary(tripId) {
  const [cats, items, expenses, tasks, trip] = await Promise.all([
    trips.categories(tripId),
    it.listItems(tripId),
    db.all(db.STORES.expenses, tripId),
    prep.listTasks(tripId),
    trips.listTrips().then(all => all.find(t => t.id === tripId)),
  ]);

  const totalPlanned = round2(
    items.reduce((s, i) => s + (i.plannedAmount ? homeAmount({ ...i, actualAmount: undefined }) : 0), 0) +
    tasks.reduce((s, t) => s + (t.plannedAmount ? homeAmount(t) : 0), 0)
  );
  const totalPaid = round2(
    items.reduce((s, i) => s + homeAmount(i), 0) +
    expenses.reduce((s, e) => s + homeAmount(e), 0)
  );
  const balance = round2((trip?.totalBudget || 0) - totalPaid);

  const byCategory = cats.map(c => ({
    id: c.id, name: c.name, color: c.color,
    amount: round2(
      items.filter(i => i.categoryId === c.id).reduce((s, i) => s + homeAmount(i), 0) +
      expenses.filter(e => e.categoryId === c.id).reduce((s, e) => s + homeAmount(e), 0)
    ),
  })).filter(c => c.amount > 0);

  const byMethod = ['cash', 'credit', 'transfer'].map(method => ({
    method,
    amount: round2(
      items.filter(i => i.method === method).reduce((s, i) => s + homeAmount(i), 0) +
      expenses.filter(e => e.method === method).reduce((s, e) => s + homeAmount(e), 0)
    ),
  })).filter(m => m.amount > 0);

  const bigTransactions = [
    ...items.filter(i => homeAmount(i) > 0).map(i => ({ title: i.title, amount: homeAmount(i), date: i.date })),
    ...expenses.map(e => ({ title: e.note || 'הוצאה', amount: homeAmount(e), date: e.date })),
  ].sort((a, b) => b.amount - a.amount).slice(0, 10);

  return { totalPlanned, totalPaid, balance, byCategory, byMethod, bigTransactions };
}
