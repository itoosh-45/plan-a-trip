import { suite, assertEqual, assertTrue } from './harness.js';
import * as db from '../js/db.js';
import * as trips from '../js/trips.js';
import * as backup from '../js/backup.js';

async function freshTrip() {
  await db.wipe();
  return trips.createTrip({ name: 'גיבוי', homeCurrency: 'ILS', totalBudget: 1000 });
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
    assertEqual((await trips.categories(restored[0].id)).length, 9);
  });

  await s.done();
}
