import { suite, assertEqual, assertTrue } from './harness.js';
import * as db from '../js/db.js';
import * as trips from '../js/trips.js';
import * as prep from '../js/prep.js';

async function freshTrip() {
  await db.wipe();
  return trips.createTrip({ name: 'הכנה', homeCurrency: 'ILS' });
}

export default async function () {
  const s = suite('רשימת הכנה');
  await db.useTestDatabase();

  s.test('currentPhase ממופה נכון לפי סטטוס הטיול', () => {
    assertEqual(prep.currentPhase('planned'), 'לפני');
    assertEqual(prep.currentPhase('done'), 'בחזרה');
    assertEqual(prep.currentPhase('active', { startDate: '2026-10-01', endDate: '2026-10-05', today: '2026-10-03' }), 'בשהות');
    assertEqual(prep.currentPhase('active', { startDate: '2026-10-01', endDate: '2026-10-05', today: '2026-10-01' }), 'בדרך');
    assertEqual(prep.currentPhase('active', { startDate: '2026-10-01', endDate: '2026-10-05', today: '2026-10-05' }), 'בדרך');
  });

  s.test('addFromCatalog מונע הוספה כפולה לפי catalogId', async () => {
    const t = await freshTrip();
    const items = [
      { id: 'p0001', phase: 'לפני', text: 'בדיקת דרכון', priority: 'חובה' },
      { id: 'p0002', phase: 'לפני', text: 'ביטוח נסיעות', priority: 'רלוונטי' },
    ];
    await prep.addFromCatalog(t.id, items);
    const again = await prep.addFromCatalog(t.id, items);
    assertEqual(again.length, 0, 'הוספה שנייה לא סירבה');
    assertEqual((await prep.listTasks(t.id, 'לפני')).length, 2);
  });

  s.test('משימה מהקטלוג הופכת לרשומה עצמאית וניתנת לעריכה', async () => {
    const t = await freshTrip();
    await prep.addFromCatalog(t.id, [{ id: 'p0010', phase: 'לפני', text: 'מקור', priority: 'רלוונטי' }]);
    const [task] = await prep.listTasks(t.id, 'לפני');
    await prep.saveTask(t.id, { ...task, title: 'נערך ידנית' });
    const [updated] = await prep.listTasks(t.id, 'לפני');
    assertEqual(updated.title, 'נערך ידנית');
    assertEqual(updated.catalogId, 'p0010', 'הקשר לקטלוג אבד');
  });

  s.test('toggleDone הופך את הסטטוס', async () => {
    const t = await freshTrip();
    const [task] = await prep.addFromCatalog(t.id, [{ id: 'p0020', phase: 'לפני', text: 'משהו', priority: 'נוחות' }]);
    await prep.toggleDone(t.id, task.id);
    assertEqual((await db.get(db.STORES.prepTasks, task.id)).done, true);
    await prep.toggleDone(t.id, task.id);
    assertEqual((await db.get(db.STORES.prepTasks, task.id)).done, false);
  });

  s.test('משימה עם סכום נספרת פעם אחת בלבד, ומשימה ללא סכום אינה נוגעת בכסף', async () => {
    const t = await freshTrip();
    await prep.saveTask(t.id, { phase: 'לפני', title: 'ביטוח', priority: 'חובה', plannedAmount: 200 });
    await prep.saveTask(t.id, { phase: 'לפני', title: 'בדיקת דרכון', priority: 'חובה' });
    const tasks = await prep.listTasks(t.id, 'לפני');
    const total = tasks.reduce((sum, x) => sum + prep.effectiveAmount(x), 0);
    assertEqual(total, 200);
    assertEqual(prep.effectiveAmount(tasks.find(x => x.title === 'בדיקת דרכון')), 0);
  });

  s.test('"חובה" שטרם בוצעו מוצגות ראשונות', async () => {
    const t = await freshTrip();
    await prep.saveTask(t.id, { phase: 'לפני', title: 'נוחות', priority: 'נוחות' });
    await prep.saveTask(t.id, { phase: 'לפני', title: 'חובה בוצע', priority: 'חובה', done: true });
    await prep.saveTask(t.id, { phase: 'לפני', title: 'חובה פתוח', priority: 'חובה' });
    const tasks = await prep.listTasks(t.id, 'לפני');
    assertEqual(tasks[0].title, 'חובה פתוח');
    assertEqual(tasks[tasks.length - 1].title, 'חובה בוצע', 'המשימה שבוצעה לא ירדה לסוף');
  });

  s.test('progress סופר done/total נכון לשלב נתון', async () => {
    const t = await freshTrip();
    await prep.saveTask(t.id, { phase: 'לפני', title: 'א', priority: 'חובה', done: true });
    await prep.saveTask(t.id, { phase: 'לפני', title: 'ב', priority: 'חובה' });
    await prep.saveTask(t.id, { phase: 'בדרך', title: 'ג', priority: 'חובה' });
    assertEqual(await prep.progress(t.id, 'לפני'), { done: 1, total: 2 });
    assertEqual(await prep.progress(t.id, 'בדרך'), { done: 0, total: 1 });
  });

  s.test('הקטלוג נטען אופליין — קובץ סטטי מקומי בלי תלות ברשת', async () => {
    const { load } = await import('../js/catalog.js');
    const cat = await load();
    assertTrue(cat.length === 519);
  });

  await s.done();
}
