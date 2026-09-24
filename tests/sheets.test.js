import { suite, assertEqual, assertTrue, assertThrows } from './harness.js';
import * as db from '../js/db.js';
import * as trips from '../js/trips.js';
import * as it from '../js/itinerary.js';
import * as expenses from '../js/expenses.js';
import * as sheets from '../js/sheets.js';

const REAL_FETCH = globalThis.fetch;

/** מחליף את fetch ומחזיר יומן של הקריאות, כדי שאף בדיקה לא תיגע ברשת. */
function stubFetch(reply) {
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, body: opts?.body });
    const out = typeof reply === 'function' ? reply(calls.length) : reply;
    if (out instanceof Error) throw out;
    return { ok: true, text: async () => out };
  };
  return calls;
}

const restore = () => { globalThis.fetch = REAL_FETCH; };

async function connected() {
  await db.wipe();
  const calls = stubFetch(JSON.stringify({ ok: true, version: 1 }));
  await sheets.connect('https://script.google.com/macros/s/AKfyABC123/exec');
  calls.length = 0;
  return calls;
}

export default async function () {
  const s = suite('גיבוי לגוגל שיטס');
  await db.useTestDatabase();

  // ---- כתובת ----

  s.test('כתובת שאינה של Apps Script נדחית', () => {
    assertThrows(() => sheets.validateUrl('https://example.com/hook'));
    assertThrows(() => sheets.validateUrl(''));
  });

  s.test('כתובת שנגמרת ב-dev נדחית עם הסבר שמפנה ל-exec', () => {
    let msg = '';
    try { sheets.validateUrl('https://script.google.com/macros/s/AKfyABC123/dev'); }
    catch (e) { msg = e.message; }
    assertTrue(msg.includes('/exec'), `ההודעה אינה מפנה ל-exec: ${msg}`);
  });

  s.test('כתובת תקינה עוברת ומנוקה מרווחים', () => {
    assertEqual(
      sheets.validateUrl('  https://script.google.com/macros/s/AKfyABC123/exec  '),
      'https://script.google.com/macros/s/AKfyABC123/exec',
    );
  });

  // ---- פיצול הגיבוי ----

  s.test('פיצול הגיבוי הלוך ושוב מחזיר בדיוק את המקור', () => {
    const text = 'א'.repeat(sheets.CHUNK * 2 + 17);
    const parts = sheets.chunk(text);
    assertEqual(parts.length, 3);
    assertTrue(parts.every(p => p.length <= sheets.CHUNK), 'מקטע חרג מהגודל המותר');
    assertEqual(parts.join(''), text);
  });

  s.test('טקסט קצר מהמקטע נשאר מקטע אחד, וטקסט ריק אינו מפיק מקטעים', () => {
    assertEqual(sheets.chunk('שלום').length, 1);
    assertEqual(sheets.chunk('').length, 0);
  });

  // ---- שורות הלשוניות ----

  s.test('שורות ההוצאות נושאות את שם היעד, הקטגוריה, הסוג בעברית והסכום בשקלים', async () => {
    await db.wipe();
    const trip = await trips.createTrip({ name: 'יוון', currency: 'EUR', totalBudget: 5000 });
    const [seg] = await it.listSegments(trip.id);
    const [cat] = await trips.categories(trip.id);

    await expenses.saveExpense(trip.id, {
      date: '2026-10-02', amount: 40, currency: 'EUR', rateToILS: 4,
      segmentId: seg.id, categoryId: cat.id, note: 'ארוחה', kind: 'expense',
    });
    await expenses.saveExpense(trip.id, {
      date: '2026-10-03', amount: 100, currency: 'EUR', rateToILS: 4,
      segmentId: seg.id, kind: 'withdraw',
    });

    const rows = sheets.expenseRows(
      trip, await it.listSegments(trip.id), await trips.categories(trip.id),
      await expenses.list(trip.id),
    );

    assertEqual(rows.length, 2);
    const withdraw = rows.find(r => r[5] === 'משיכת מזומן');
    const expense = rows.find(r => r[5] === 'הוצאה');
    assertTrue(withdraw, 'שורת המשיכה חסרה');
    assertEqual(expense[1], 'יוון');
    assertEqual(expense[3], cat.name);
    assertEqual(expense[4], 'ארוחה');
    // 40 אירו בשער 4 — לפי השער הצרוב על הרשומה, לא לפי שער היום
    assertEqual(expense[8], 160);
  });

  s.test('לשונית היעדים והמסלול מפרידה בין שני הבלוקים בשורה ריקה', async () => {
    await db.wipe();
    const trip = await trips.createTrip({
      name: 'פורטוגל', currency: 'EUR', startDate: '2026-05-01', endDate: '2026-05-10',
    });
    await it.saveSegment(trip.id, {
      city: 'ליסבון', startDate: '2026-05-01', endDate: '2026-05-04', allocation: 900,
    });
    const segs = await it.listSegments(trip.id);
    await it.saveItem(trip.id, {
      title: 'טיסה הלוך', date: '2026-05-01', type: 'flight',
      segmentId: segs[0].id, plannedAmount: 700,
    });

    const payload = await sheets.buildPayload();
    const tab = payload.sheets['יעדים ומסלול'];
    const blank = tab.findIndex(r => r.length === 0);

    assertTrue(blank > 1, 'לא נמצאה שורה ריקה בין הבלוקים');
    assertEqual(tab[0][0], 'טיול');
    assertEqual(tab[blank + 1][0], 'טיול');
    assertTrue(tab.slice(1, blank).some(r => r[1] === 'ליסבון'), 'היעד אינו בבלוק היעדים');
    assertTrue(tab.slice(blank + 2).some(r => r[5] === 'טיסה הלוך'), 'הפריט אינו בבלוק המסלול');
    assertTrue(tab.slice(blank + 2).some(r => r[4] === 'טיסה'), 'סוג הפריט אינו בעברית');
  });

  s.test('המטען נושא גיבוי מלא שאפשר לפרסר בחזרה', async () => {
    await db.wipe();
    await trips.createTrip({ name: 'איסלנד', currency: 'ILS' });
    const payload = await sheets.buildPayload();
    const parsed = JSON.parse(payload.backup.join(''));
    assertEqual(parsed.stores.trips.length, 1);
    assertEqual(parsed.stores.trips[0].name, 'איסלנד');
    assertEqual(payload.app, 'trip-planner');
  });

  // ---- מכונת המצבים ----

  s.test('connect שולח ping, שומר את הכתובת ומדליק את הדגל', async () => {
    await db.wipe();
    const calls = stubFetch(JSON.stringify({ ok: true, version: 1 }));
    await sheets.connect('https://script.google.com/macros/s/AKfyABC123/exec');
    restore();

    assertEqual(calls.length, 1);
    assertEqual(JSON.parse(calls[0].body).ping, true);
    const st = await sheets.status();
    assertEqual([st.connected, st.dirty], [true, true]);
  });

  s.test('תשובה שאינה JSON מפילה את החיבור עם הודעה על Anyone', async () => {
    await db.wipe();
    stubFetch('<!doctype html><html>Google sign-in</html>');
    let msg = '';
    try { await sheets.connect('https://script.google.com/macros/s/AKfyABC123/exec'); }
    catch (e) { msg = e.message; }
    restore();
    assertTrue(msg.includes('Anyone'), `ההודעה אינה מפנה ל-Anyone: ${msg}`);
    assertEqual(await sheets.isConnected(), false);
  });

  s.test('סנכרון מוצלח מכבה את הדגל ורושם מועד', async () => {
    await connected();
    stubFetch(JSON.stringify({ ok: true }));
    const res = await sheets.syncNow();
    restore();

    assertEqual(res.ok, true);
    const st = await sheets.status();
    assertEqual([st.dirty, st.lastError], [false, null]);
    assertTrue(st.lastSyncAt, 'לא נרשם מועד סנכרון');
  });

  s.test('סנכרון שנכשל משאיר את הדגל דלוק ושומר את השגיאה', async () => {
    await connected();
    stubFetch(new Error('נפילת רשת'));
    const res = await sheets.syncNow();
    restore();

    assertEqual(res.ok, false);
    const st = await sheets.status();
    assertEqual(st.dirty, true, 'הדגל כבה למרות שהשליחה נכשלה');
    assertTrue(st.lastError, 'השגיאה לא נשמרה');
  });

  s.test('בלי רשת לא נשלחת בקשה והדגל נשאר דלוק', async () => {
    await connected();
    const calls = stubFetch(JSON.stringify({ ok: true }));
    const online = Object.getOwnPropertyDescriptor(Navigator.prototype, 'onLine');
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });

    const res = await sheets.syncNow();

    if (online) Object.defineProperty(Navigator.prototype, 'onLine', online);
    delete navigator.onLine;
    restore();

    assertEqual(calls.length, 0, 'נשלחה בקשה למרות שאין רשת');
    assertEqual(res.skipped, 'אין רשת');
    assertEqual((await sheets.status()).dirty, true);
  });

  s.test('שתי קריאות במקביל מפיקות בקשת רשת אחת', async () => {
    await connected();
    const calls = stubFetch(JSON.stringify({ ok: true }));
    const [a, b] = await Promise.all([sheets.syncNow(), sheets.syncNow()]);
    restore();

    assertEqual(calls.length, 1, `נשלחו ${calls.length} בקשות במקום אחת`);
    assertEqual([a.ok, b.ok], [true, true]);
  });

  s.test('בלי חיבור אין שליחה בכלל', async () => {
    await db.wipe();
    const calls = stubFetch(JSON.stringify({ ok: true }));
    const res = await sheets.syncNow();
    restore();
    assertEqual(calls.length, 0);
    assertEqual(res.skipped, 'לא מחובר');
  });

  s.test('disconnect מנקה את כל המצב', async () => {
    await connected();
    restore();
    await sheets.disconnect();
    const st = await sheets.status();
    assertEqual([st.connected, st.url, st.lastSyncAt, st.lastError], [false, null, null, null]);
  });

  s.test('הקוד שהמשתמש מדביק עונה ל-ping ואינו קורא מהגיליון', () => {
    const src = sheets.SCRIPT_SOURCE;
    assertTrue(src.includes('function doPost'), 'אין doPost');
    assertTrue(src.includes('payload.ping'), 'אין מענה ל-ping');
    assertTrue(src.includes('hideSheet'), 'לשונית הגיבוי אינה מוסתרת');
    assertTrue(!src.includes('getValues'), 'הסקריפט קורא מהגיליון — הוא אמור רק לכתוב');
  });

  restore();
  await s.done();
}
