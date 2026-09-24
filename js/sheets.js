import * as db from './db.js';
import * as trips from './trips.js';
import * as it from './itinerary.js';
import * as expenses from './expenses.js';
import * as rates from './rates.js';
import { nightsBetween } from './ui.js';

/**
 * גיבוי מתמשך לגיליון גוגל שבבעלות המשתמש.
 *
 * כל שליחה היא צילום מצב שלם, והסקריפט בצד גוגל מוחק וכותב מחדש. מזה נובע
 * שהשליחה אידמפוטנטית, ולכן אין כאן תור שינויים ואין פתרון קונפליקטים —
 * מספיק דגל בוליאני אחד שאומר "יש משהו שלא נשלח". שליחה שנכשלה משאירה את
 * הדגל דלוק ואת הגיבוי הקודם בגיליון; הנתונים המקומיים הם תמיד המקור.
 */

const KEYS = {
  url:   'sheetsUrl',
  at:    'sheetsLastSyncAt',
  dirty: 'sheetsDirty',
  err:   'sheetsLastError',
};

/** תא בגוגל שיטס מוגבל ל-50,000 תווים. 40,000 משאיר מרווח ולא מתקרב לקצה. */
export const CHUNK = 40000;

const EXPENSE_HEAD = ['תאריך', 'טיול', 'יעד', 'קטגוריה', 'פירוט', 'סוג', 'סכום', 'מטבע', 'בשקלים'];
const SEGMENT_HEAD = ['טיול', 'יעד', 'מתאריך', 'עד תאריך', 'לילות', 'הקצאת תקציב', 'מטבע'];
const ITEM_HEAD    = ['טיול', 'יעד', 'תאריך', 'שעה', 'סוג', 'כותרת', 'סכום מתוכנן', 'מטבע', 'בוצע'];
const BUDGET_HEAD  = ['טיול', 'קטגוריה', 'תקציב', 'מטבע'];

const ITEM_LABEL = Object.fromEntries(it.ITEM_TYPES.map(t => [t.key, t.label]));

export function chunk(text, size = CHUNK) {
  const out = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

// ---------- הלשוניות הקריאות ----------

export function expenseRows(trip, segs, cats, rows) {
  const seg = id => segs.find(s => s.id === id)?.city || '';
  const cat = id => cats.find(c => c.id === id)?.name || '';
  return rows.map(r => [
    r.date, trip.name, seg(r.segmentId), cat(r.categoryId), r.note || '',
    expenses.KINDS[r.kind] || r.kind, r.amount, r.currency, rates.toILS(r),
  ]);
}

export function segmentRows(trip, segs) {
  return segs.map(s => [
    trip.name, s.city, s.startDate || '', s.endDate || '',
    s.startDate && s.endDate ? nightsBetween(s.startDate, s.endDate) : '',
    s.allocation || '', trip.currency,
  ]);
}

export function itemRows(trip, segs, items) {
  const seg = id => segs.find(s => s.id === id)?.city || '';
  return items.map(i => [
    trip.name, seg(i.segmentId), i.date, i.time || '',
    ITEM_LABEL[i.type] || i.type || '', i.title,
    i.plannedAmount ?? '', i.currency || trip.currency, i.done ? 'כן' : '',
  ]);
}

export function budgetRows(trip, cats, rows) {
  const cat = id => cats.find(c => c.id === id)?.name || '';
  return rows
    .filter(b => cat(b.categoryId))
    .map(b => [trip.name, cat(b.categoryId), b.amount, b.currency || trip.currency]);
}

async function buildSheets() {
  const all = await trips.listTrips();
  const expense = [EXPENSE_HEAD];
  const segment = [SEGMENT_HEAD];
  const item = [];
  const budget = [BUDGET_HEAD];

  for (const trip of all) {
    const [segs, cats, rows, items, plans] = await Promise.all([
      it.listSegments(trip.id),
      trips.categories(trip.id),
      expenses.list(trip.id),
      db.all(db.STORES.items, trip.id),
      db.all(db.STORES.budgets, trip.id),
    ]);
    expense.push(...expenseRows(trip, segs, cats, rows));
    segment.push(...segmentRows(trip, segs));
    item.push(...itemRows(trip, segs, items));
    budget.push(...budgetRows(trip, cats, plans));
  }

  // שני בלוקים בלשונית אחת, מופרדים בשורה ריקה: היעדים ואז פריטי המסלול.
  return {
    'הוצאות': expense,
    'יעדים ומסלול': [...segment, [], ITEM_HEAD, ...item],
    'תקציב': budget,
  };
}

export async function buildPayload() {
  const dump = await db.exportAll();
  return {
    app: 'trip-planner',
    version: 1,
    generatedAt: new Date().toISOString(),
    backup: chunk(JSON.stringify(dump)),
    sheets: await buildSheets(),
  };
}

// ---------- התעבורה ----------

const URL_RE = /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/(exec|dev)$/;

export function validateUrl(url) {
  const u = String(url || '').trim();
  if (!URL_RE.test(u)) {
    throw new Error('זו לא כתובת של Apps Script. היא צריכה להתחיל ב-https://script.google.com/macros/s/ ולהסתיים ב-/exec');
  }
  if (u.endsWith('/dev')) {
    throw new Error('זו הכתובת שנגמרת ב-/dev, והיא עובדת רק במחשב שלך. חזור למסך Deploy וקח את הכתובת שנגמרת ב-/exec');
  }
  return u;
}

/**
 * text/plain בכוונה: כך הבקשה נחשבת "פשוטה" והדפדפן אינו שולח preflight,
 * ש-Apps Script אינו יודע לענות עליו. אין כאן כותרות נוספות מאותה סיבה.
 */
async function post(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload),
    redirect: 'follow',
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch {
    throw new Error('הגיליון לא החזיר תשובה תקינה. בדוק שבשדה Who has access נבחר Anyone.');
  }
  if (!data.ok) throw new Error(data.error || 'הגיליון דחה את הבקשה.');
  return data;
}

// ---------- המצב ----------

export async function isConnected() {
  return Boolean(await db.getSetting(KEYS.url, null));
}

export async function status() {
  return {
    connected: await isConnected(),
    url:       await db.getSetting(KEYS.url, null),
    lastSyncAt: await db.getSetting(KEYS.at, null),
    dirty:     await db.getSetting(KEYS.dirty, false),
    lastError: await db.getSetting(KEYS.err, null),
  };
}

/** בדיקת חיבור: ping אינו נוגע בגיליון, ולכן כתובת שגויה לא הורסת דבר. */
export async function connect(url) {
  const clean = validateUrl(url);
  await post(clean, { ping: true });
  await db.setSetting(KEYS.url, clean);
  await db.setSetting(KEYS.err, null);
  await db.setSetting(KEYS.dirty, true);
  return clean;
}

/** מנתק את האפליקציה מהגיליון. הגיליון עצמו והנתונים שבו נשארים כפי שהם. */
export async function disconnect() {
  for (const key of Object.values(KEYS)) await db.setSetting(key, null);
}

let inFlight = null;

export function syncNow() {
  if (!inFlight) inFlight = run().finally(() => { inFlight = null; });
  return inFlight;
}

async function run() {
  const url = await db.getSetting(KEYS.url, null);
  if (!url) return { skipped: 'לא מחובר' };
  if (navigator.onLine === false) return { skipped: 'אין רשת' };
  try {
    await post(url, await buildPayload());
    await db.setSetting(KEYS.at, new Date().toISOString());
    await db.setSetting(KEYS.dirty, false);
    await db.setSetting(KEYS.err, null);
    return { ok: true };
  } catch (err) {
    // הדגל נשאר דלוק בכוונה — הניסיון הבא ישלח את אותו צילום מצב מעודכן.
    await db.setSetting(KEYS.err, err.message);
    return { ok: false, error: err.message };
  }
}

async function pushIfNeeded() {
  const s = await status();
  if (s.connected && s.dirty) await syncNow();
}

/**
 * הטריגרים. visibilitychange ולא pagehide: sendBeacon ו-keepalive מוגבלים
 * ל-64KB וגיבוי מלא גדול מזה, ואילו מעבר לאפליקציה אחרת רק מסתיר את הדף
 * ומשאיר לשליחה זמן להסתיים.
 */
export function watch() {
  document.addEventListener('data:changed', e => {
    // כתיבה ל-settings היא בין השאר הכתיבה של המודול הזה עצמו. בלי הסינון
    // הזה כל סנכרון היה מדליק מחדש את הדגל שהוא בדיוק כיבה.
    if (e.detail?.store === db.STORES.settings) return;
    db.setSetting(KEYS.dirty, true);
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pushIfNeeded(); });
  window.addEventListener('online', pushIfNeeded);
  pushIfNeeded();
}

// ---------- הקוד שהמשתמש מדביק אצלו ----------

/** רק כותב. אינו מחזיר תוכן מהגיליון, ולכן כתובת שדלפה יכולה לדרוס אך לא לקרוא. */
export const SCRIPT_SOURCE = `function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);
    if (payload.ping) return json({ ok: true, version: 1 });

    var book = SpreadsheetApp.getActiveSpreadsheet();

    for (var name in payload.sheets) {
      var rows = payload.sheets[name];
      var tab = book.getSheetByName(name) || book.insertSheet(name);
      tab.clear();
      if (rows.length) {
        var width = 0;
        for (var i = 0; i < rows.length; i++) width = Math.max(width, rows[i].length);
        for (var j = 0; j < rows.length; j++) {
          while (rows[j].length < width) rows[j].push('');
        }
        tab.getRange(1, 1, rows.length, width).setValues(rows);
        tab.setFrozenRows(1);
      }
    }

    var backup = book.getSheetByName('_גיבוי') || book.insertSheet('_גיבוי');
    backup.clear();
    var lines = [['גיבוי אוטומטי · ' + payload.generatedAt + ' · גרסה ' + payload.version]];
    for (var k = 0; k < payload.backup.length; k++) lines.push([payload.backup[k]]);
    backup.getRange(1, 1, lines.length, 1).setValues(lines);
    backup.hideSheet();

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}`;
