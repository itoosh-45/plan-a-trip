import * as db from './db.js';
import * as trips from './trips.js';

export const SCHEMA_VERSION = 2;

const URGENCY_BY_PRIORITY = { 'חובה': 'critical', 'רלוונטי': 'important', 'נוחות': 'normal' };
const STAGE_BY_PHASE = { 'לפני': 'before', 'בדרך': 'before', 'בשהות': 'during', 'בחזרה': 'after' };

const segmentFor = (segs, date, generalId) =>
  segs.find(s => s.kind !== 'general' && s.startDate <= date && date <= (s.endDate || s.startDate))?.id
  ?? generalId;

/**
 * מעבירה נתונים ממבנה גרסה 1 למבנה החדש. הכללים:
 * שום טיול, הוצאה או פריט לא נמחק · כל רשומה שנוצרת כאן נושאת מזהה דטרמיניסטי,
 * ולכן הרצה חוזרת דורסת את עצמה במקום לשכפל.
 */
export async function run() {
  if ((await db.getSetting('schemaVersion', 1)) >= SCHEMA_VERSION) return { skipped: true };

  const report = { trips: 0, expenses: 0, fromWallet: 0, fromItems: 0, tasks: 0 };
  for (const trip of await db.all(db.STORES.trips)) {
    await migrateTrip(trip, report);
    report.trips++;
  }
  await db.setSetting('schemaVersion', SCHEMA_VERSION);
  return report;
}

async function migrateTrip(trip, report) {
  const tripId = trip.id;
  await trips.ensureGeneralSegment(tripId);

  const segs = await db.all(db.STORES.segments, tripId);
  const general = segs.find(s => s.kind === 'general');
  const places = segs.filter(s => s.kind !== 'general');

  // --- הטיול עצמו: תאריכים משלו, מטבע ראשי, בלי סטטוס ---
  const { status, homeCurrency, ...rest } = trip;
  const dated = places.filter(s => s.startDate);
  await db.put(db.STORES.trips, {
    ...rest,
    currency: (trip.currency || homeCurrency || 'ILS').toUpperCase(),
    startDate: trip.startDate ?? (dated.length ? dated.map(s => s.startDate).sort()[0] : null),
    endDate: trip.endDate ?? (dated.length
      ? dated.map(s => s.endDate || s.startDate).sort().slice(-1)[0] : null),
  });
  const currency = (trip.currency || homeCurrency || 'ILS').toUpperCase();

  // --- מקטעים: סוג והקצאה ---
  const needKind = places.filter(s => !s.kind);
  if (needKind.length) {
    await db.bulkPut(db.STORES.segments,
      needKind.map(s => ({ ...s, kind: 'place', allocation: Number(s.allocation) || 0 })));
  }

  // --- הוצאות קיימות: סוג רשומה, מטבע ושיוך למקטע ---
  const existing = await db.all(db.STORES.expenses, tripId);
  const patched = existing
    .filter(e => !e.kind || !e.segmentId || !e.currency)
    .map(e => ({
      ...e,
      kind: e.kind || 'expense',
      currency: (e.currency || currency).toUpperCase(),
      rateToILS: e.rateToILS ?? ((e.currency || currency) === 'ILS' ? 1 : undefined),
      segmentId: e.segmentId || segmentFor(places, e.date, general?.id),
    }));
  if (patched.length) {
    await db.bulkPut(db.STORES.expenses, patched);
    report.expenses += patched.length;
  }

  // --- ארנק ישן: משיכה היא ההוצאה, הוצאת מזומן היא פילוח בלבד ---
  const wallets = await db.all(db.STORES.wallets, tripId);
  const txs = await db.all(db.STORES.walletTx, tripId);
  const fromWallet = txs.map(tx => ({
    id: `wtx-${tx.id}`,
    tripId,
    kind: tx.type === 'withdraw' ? 'withdraw' : 'cashSpend',
    amount: Number(tx.amount) || 0,
    currency: (wallets.find(w => w.id === tx.walletId)?.currency || currency).toUpperCase(),
    date: tx.date || trip.startDate || new Date().toISOString().slice(0, 10),
    note: tx.note || '',
    segmentId: segmentFor(places, tx.date || '', general?.id),
  }));
  if (fromWallet.length) {
    await db.bulkPut(db.STORES.expenses, fromWallet);
    report.fromWallet += fromWallet.length;
  }

  // --- פריט מסלול ששולם: הכסף עובר להוצאה, הפריט נשאר עם המתוכנן ---
  const items = await db.all(db.STORES.items, tripId);
  const paid = items.filter(i => i.actualAmount !== undefined && i.actualAmount !== null);
  if (paid.length) {
    await db.bulkPut(db.STORES.expenses, paid.map(i => ({
      id: `item-${i.id}`,
      tripId,
      kind: 'expense',
      amount: Number(i.actualAmount) || 0,
      currency: (i.currency || currency).toUpperCase(),
      rateToILS: i.rateToILS,
      rateDate: i.rateDate,
      rateSource: i.rateSource,
      date: i.date,
      note: i.title,
      categoryId: i.categoryId,
      segmentId: i.segmentId || segmentFor(places, i.date, general?.id),
    })));
    await db.bulkPut(db.STORES.items, paid.map(({ actualAmount, payStatus, method, ...keep }) => keep));
    report.fromItems += paid.length;
  }

  // --- פריטי צ׳קליסט: קטגוריה מתוך השלב, דחיפות מתוך העדיפות ---
  const tasks = await db.all(db.STORES.prepTasks, tripId);
  const needStage = tasks.filter(t => !t.stage || !t.urgency);
  if (needStage.length) {
    await db.bulkPut(db.STORES.prepTasks, needStage.map(t => ({
      ...t,
      stage: t.stage || STAGE_BY_PHASE[t.phase] || 'before',
      urgency: t.urgency || URGENCY_BY_PRIORITY[t.priority] || 'normal',
      segmentId: t.segmentId ?? null,
    })));
    report.tasks += needStage.length;
  }
}
