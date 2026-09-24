import { suite, assertEqual, assertTrue } from './harness.js';
import * as db from '../js/db.js';
import * as trips from '../js/trips.js';
import * as backup from '../js/backup.js';

async function freshTrip() {
  await db.wipe();
  return trips.createTrip({ name: 'גיבוי', currency: 'ILS', totalBudget: 1000 });
}

export default async function () {
  const s = suite('גיבוי ושחזור');
  await db.useTestDatabase();

  s.test('buildBackup מפיק JSON תקין עם כל ה-stores ושם קובץ בפורמט הנכון', async () => {
    await freshTrip();
    const { json, filename } = await backup.buildBackup();
    const parsed = JSON.parse(json);
    assertEqual(parsed.stores.trips.length, 1);
    assertTrue(/^trip-planner-backup-\d{4}-\d{2}-\d{2}\.json$/.test(filename), filename);
  });

  s.test('parseBackup מאמת מבנה תקין, מחזיר תצוגה מקדימה, ולא נוגע בנתונים', async () => {
    await freshTrip();
    const { json } = await backup.buildBackup();
    const file = new File([json], 'b.json', { type: 'application/json' });
    const res = await backup.parseBackup(file);
    assertEqual(res.ok, true);
    assertEqual(res.preview.trips, 1);
    assertEqual((await trips.listTrips()).length, 1, 'parseBackup שינה נתונים');
  });

  s.test('parseBackup דוחה JSON לא תקין', async () => {
    const file = new File(['{ לא תקין'], 'b.json');
    const res = await backup.parseBackup(file);
    assertEqual(res.ok, false);
    assertTrue(res.error.length > 0);
  });

  s.test('parseBackup דוחה מבנה בלי stores', async () => {
    const file = new File([JSON.stringify({ hello: 'world' })], 'b.json');
    const res = await backup.parseBackup(file);
    assertEqual(res.ok, false);
  });

  s.test('parseBackup דוחה טבלאות לא מוכרות', async () => {
    const file = new File([JSON.stringify({ stores: { noSuchStore: [] } })], 'b.json');
    const res = await backup.parseBackup(file);
    assertEqual(res.ok, false);
  });

  s.test('restore משחזר בדיוק את מה שגובה — סימטריה מלאה', async () => {
    const t = await freshTrip();
    await trips.upsertCategory(t.id, { name: 'קטגוריה נוספת', color: '#123456' });
    const { json } = await backup.buildBackup();

    await db.wipe();
    assertEqual((await trips.listTrips()).length, 0);

    const parsed = await backup.parseBackup(new File([json], 'b.json'));
    await backup.restore(parsed.payload);

    const restored = await trips.listTrips();
    assertEqual(restored.length, 1);
    assertEqual(restored[0].name, 'גיבוי');
    assertEqual((await trips.categories(restored[0].id)).length, 10);
  });

  // ---- גיבוי ושחזור של טיול בודד ----

  async function twoTrips() {
    await db.wipe();
    const a = await trips.createTrip({
      name: 'יפן', currency: 'JPY', totalBudget: 5000, startDate: '2026-11-01', endDate: '2026-11-10',
    });
    const b = await trips.createTrip({
      name: 'יוון', currency: 'EUR', totalBudget: 3000, startDate: '2026-12-01', endDate: '2026-12-05',
    });
    const it = await import('../js/itinerary.js');
    const expenses = await import('../js/expenses.js');
    const prep = await import('../js/prep.js');
    const segA = await it.saveSegment(a.id, { city: 'טוקיו', startDate: '2026-11-01', endDate: '2026-11-10' });
    await expenses.saveExpense(a.id, { amount: 400, currency: 'JPY', segmentId: segA.id });
    await prep.saveTask(a.id, { stage: 'before', title: 'דרכון' });
    const segB = await it.saveSegment(b.id, { city: 'אתונה', startDate: '2026-12-01', endDate: '2026-12-05' });
    await expenses.saveExpense(b.id, { amount: 90, currency: 'EUR', segmentId: segB.id });
    return { a, b };
  }

  s.test('גיבוי של טיול אחד מכיל רק אותו, בלי שערים והגדרות', async () => {
    const { a } = await twoTrips();
    const { json, filename } = await backup.buildBackup(a.id);
    const payload = JSON.parse(json);
    assertEqual(payload.stores.trips.map(t => t.name), ['יפן']);
    assertEqual(payload.stores.expenses.length, 1);
    assertTrue(!payload.stores.fxRates, 'שערים נכנסו לגיבוי של טיול בודד');
    assertTrue(!payload.stores.settings, 'הגדרות נכנסו לגיבוי של טיול בודד');
    assertTrue(filename.includes('יפן'), `שם הקובץ אינו נושא את שם הטיול: ${filename}`);
  });

  s.test('גיבוי של טיול שאינו קיים נכשל בעברית', async () => {
    await twoTrips();
    let threw = false;
    try { await backup.buildBackup('אין-כזה'); } catch { threw = true; }
    assertTrue(threw, 'גיבוי של טיול לא קיים לא נכשל');
  });

  s.test('tripsIn מונה את מה שיש בקובץ לכל טיול', async () => {
    await twoTrips();
    const { json } = await backup.buildBackup();
    const list = backup.tripsIn(JSON.parse(json));
    assertEqual(list.map(t => t.name).sort(), ['יוון', 'יפן']);
    const japan = list.find(t => t.name === 'יפן');
    assertEqual([japan.counts.expenses, japan.counts.prepTasks], [1, 1]);
  });

  s.test('שחזור טיול אחד אינו נוגע בטיול השני', async () => {
    const { a, b } = await twoTrips();
    const { json } = await backup.buildBackup(a.id);
    const expenses = await import('../js/expenses.js');
    // משנים את יפן אחרי הגיבוי, ואז משחזרים
    await expenses.saveExpense(a.id, { amount: 999, currency: 'JPY',
      segmentId: (await db.all(db.STORES.segments, a.id))[0].id });
    assertEqual((await db.all(db.STORES.expenses, a.id)).length, 2);

    await backup.restoreTrip(JSON.parse(json), a.id, 'replace');
    assertEqual((await db.all(db.STORES.expenses, a.id)).length, 1, 'הטיול לא הוחזר למצב הגיבוי');
    assertEqual((await db.all(db.STORES.expenses, b.id)).length, 1, 'הטיול השני נפגע');
    assertEqual((await trips.listTrips()).length, 2);
  });

  s.test('שחזור כעותק מוסיף טיול חדש ואינו דורס את המקור', async () => {
    const { a } = await twoTrips();
    const { json } = await backup.buildBackup(a.id);
    await backup.restoreTrip(JSON.parse(json), a.id, 'copy');

    const all = await trips.listTrips();
    assertEqual(all.length, 3, 'העותק לא נוסף כטיול נפרד');
    const copy = all.find(t => t.name.includes('עותק'));
    assertTrue(!!copy, 'לעותק אין שם שמבדיל אותו');
    assertTrue(copy.id !== a.id, 'העותק קיבל את המזהה של המקור');

    // ההפניות הפנימיות של העותק מצביעות על עצמו, לא על המקור
    const copyExpenses = await db.all(db.STORES.expenses, copy.id);
    const copySegments = await db.all(db.STORES.segments, copy.id);
    assertEqual(copyExpenses.length, 1);
    assertTrue(copySegments.some(sg => sg.id === copyExpenses[0].segmentId),
      'ההוצאה בעותק מצביעה על יעד של הטיול המקורי');
    assertEqual((await db.all(db.STORES.expenses, a.id)).length, 1, 'המקור נפגע');
  });

  await s.done();
}
