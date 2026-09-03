import { suite, assertEqual, assertTrue, assertThrows } from './harness.js';
import * as db from '../js/db.js';
import * as trips from '../js/trips.js';
import * as it from '../js/itinerary.js';
import * as cur from '../js/currencies.js';

async function freshTrip(over = {}) {
  await db.wipe();
  return trips.createTrip({
    name: 'תאילנד', startDate: '2026-11-01', endDate: '2026-11-20', currency: 'THB', ...over,
  });
}

export default async function () {
  const s = suite('מודל חדש — טיול, מקטעים, מטבעות');
  await db.useTestDatabase();

  // ---- טיול: תאריכים משלו, מטבע ראשי, בלי סטטוס ----

  s.test('לטיול יש תאריכי התחלה וסיום משלו', async () => {
    const t = await freshTrip();
    assertEqual([t.startDate, t.endDate], ['2026-11-01', '2026-11-20']);
  });

  s.test('שדה הסטטוס נמחק מהמודל', async () => {
    const t = await freshTrip();
    assertEqual(t.status, undefined, 'הטיול עדיין נושא סטטוס');
    assertEqual(trips.TRIP_STATUS, undefined, 'TRIP_STATUS עדיין מיוצא');
  });

  s.test('מטבע ראשי נשמר בשדה currency', async () => {
    const t = await freshTrip();
    assertEqual(t.currency, 'THB');
  });

  s.test('תאריך סיום לפני תאריך התחלה נדחה', async () => {
    await db.wipe();
    await assertThrows(
      () => trips.createTrip({ name: 'הפוך', startDate: '2026-11-20', endDate: '2026-11-01' }),
      'טווח הפוך נשמר'
    );
  });

  s.test('טיול בלי תאריכים מותר (דילוג באונבורדינג)', async () => {
    await db.wipe();
    const t = await trips.createTrip({ name: 'בלי תאריכים' });
    assertEqual([t.startDate, t.endDate], [null, null]);
  });

  // ---- מקטע "כללי" ----

  s.test('יצירת טיול יוצרת מקטע "כללי" בלי תאריכים', async () => {
    const t = await freshTrip();
    const gen = await it.generalSegment(t.id);
    assertTrue(!!gen, 'לא נוצר מקטע כללי');
    assertEqual([gen.kind, gen.city, gen.startDate, gen.endDate], ['general', 'כללי', null, null]);
  });

  s.test('לא ניתן למחוק את המקטע הכללי', async () => {
    const t = await freshTrip();
    const gen = await it.generalSegment(t.id);
    await assertThrows(() => it.removeSegment(t.id, gen.id), 'המקטע הכללי נמחק');
  });

  s.test('listSegments מסדר יעדים לפי תאריך ומשאיר את "כללי" אחרון', async () => {
    const t = await freshTrip();
    await it.saveSegment(t.id, { city: 'קו סמוי', startDate: '2026-11-10', endDate: '2026-11-15' });
    await it.saveSegment(t.id, { city: 'בנגקוק', startDate: '2026-11-01', endDate: '2026-11-05' });
    assertEqual((await it.listSegments(t.id)).map(x => x.city), ['בנגקוק', 'קו סמוי', 'כללי']);
  });

  // ---- ולידציה: בתוך טווח הטיול, בלי חפיפות ----

  s.test('מקטע שחורג מטווח הטיול נדחה', async () => {
    const t = await freshTrip();
    await assertThrows(
      () => it.saveSegment(t.id, { city: 'מוקדם מדי', startDate: '2026-10-25', endDate: '2026-11-02' }),
      'מקטע מחוץ לטווח הטיול נשמר'
    );
  });

  s.test('שני מקטעים חופפים בתאריכים נדחים', async () => {
    const t = await freshTrip();
    await it.saveSegment(t.id, { city: 'בנגקוק', startDate: '2026-11-01', endDate: '2026-11-05' });
    await assertThrows(
      () => it.saveSegment(t.id, { city: 'צ׳יאנג מאי', startDate: '2026-11-04', endDate: '2026-11-08' }),
      'מקטעים חופפים נשמרו'
    );
  });

  s.test('פער בין מקטעים מותר', async () => {
    const t = await freshTrip();
    await it.saveSegment(t.id, { city: 'בנגקוק', startDate: '2026-11-01', endDate: '2026-11-05' });
    await it.saveSegment(t.id, { city: 'פוקט', startDate: '2026-11-10', endDate: '2026-11-14' });
    assertEqual((await it.listSegments(t.id)).length, 3);
  });

  s.test('עריכת מקטע קיים אינה נחשבת חפיפה עם עצמו', async () => {
    const t = await freshTrip();
    const seg = await it.saveSegment(t.id, { city: 'בנגקוק', startDate: '2026-11-01', endDate: '2026-11-05' });
    const same = await it.saveSegment(t.id, { ...seg, endDate: '2026-11-06' });
    assertEqual(same.endDate, '2026-11-06');
  });

  s.test('המקטע הכללי אינו נכנס לבדיקת החפיפות', async () => {
    const t = await freshTrip();
    await it.saveSegment(t.id, { city: 'בנגקוק', startDate: '2026-11-01', endDate: '2026-11-20' });
    assertEqual((await it.listSegments(t.id)).length, 2, 'מקטע שמכסה את כל הטיול נדחה בגלל "כללי"');
  });

  // ---- ברירת מחדל חכמה לשיוך ----

  s.test('defaultSegmentId בוחר את המקטע שהיום נופל בתוכו', async () => {
    const t = await freshTrip();
    const seg = await it.saveSegment(t.id, { city: 'בנגקוק', startDate: '2026-11-01', endDate: '2026-11-05' });
    assertEqual(await it.defaultSegmentId(t.id, '2026-11-03'), seg.id);
  });

  s.test('defaultSegmentId נופל ל"כללי" כשהיום מחוץ לכל מקטע', async () => {
    const t = await freshTrip();
    await it.saveSegment(t.id, { city: 'בנגקוק', startDate: '2026-11-01', endDate: '2026-11-05' });
    const gen = await it.generalSegment(t.id);
    assertEqual(await it.defaultSegmentId(t.id, '2026-12-31'), gen.id);
  });

  // ---- הקצאת תקציב למקטע ----

  s.test('הקצאה למקטע נשמרת, והיתרה הלא־מוקצית מחושבת', async () => {
    const t = await freshTrip({ totalBudget: 10000 });
    const a = await it.saveSegment(t.id, { city: 'בנגקוק', startDate: '2026-11-01', endDate: '2026-11-05', allocation: 4000 });
    await it.saveSegment(t.id, { city: 'פוקט', startDate: '2026-11-06', endDate: '2026-11-10', allocation: 3000 });
    const b = await trips.budgetSummary(t.id);
    assertEqual([b.ceiling, b.allocated, b.unallocated, b.over], [10000, 7000, 3000, false]);
    assertEqual(a.allocation, 4000);
  });

  s.test('הקצאה מעל התקרה מסומנת כחריגה אך נשמרת', async () => {
    const t = await freshTrip({ totalBudget: 5000 });
    await it.saveSegment(t.id, { city: 'בנגקוק', startDate: '2026-11-01', endDate: '2026-11-05', allocation: 6000 });
    const b = await trips.budgetSummary(t.id);
    assertEqual([b.allocated, b.unallocated, b.over], [6000, -1000, true]);
  });

  // ---- מטבעות ----

  s.test('רשימת המטבעות הפעילה כברירת מחדל היא שש', async () => {
    await db.wipe();
    assertEqual(await cur.listActive(), ['ILS', 'USD', 'EUR', 'GBP', 'THB', 'JPY']);
  });

  s.test('setActive שומר רשימה חדשה ותמיד משאיר את השקל', async () => {
    await db.wipe();
    await cur.setActive(['usd', 'thb']);
    assertEqual(await cur.listActive(), ['ILS', 'USD', 'THB']);
  });

  s.test('קוד מטבע לא תקין נדחה', async () => {
    await assertThrows(() => cur.setActive(['USD', 'לא']), 'קוד מטבע פסול התקבל');
  });

  s.test('לכל מטבע ברירת מחדל יש שם בעברית', async () => {
    assertEqual(cur.DEFAULT_CURRENCIES.filter(c => !cur.NAMES[c]), []);
  });

  await s.done();
}
