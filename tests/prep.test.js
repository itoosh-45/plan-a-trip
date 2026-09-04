import { suite, assertEqual, assertTrue, assertThrows } from './harness.js';
import * as db from '../js/db.js';
import * as trips from '../js/trips.js';
import * as prep from '../js/prep.js';

async function freshTrip() {
  await db.wipe();
  return trips.createTrip({ name: 'הכנה', currency: 'ILS' });
}

export default async function () {
  const s = suite('רשימת הכנה');
  await db.useTestDatabase();

  s.test('שלוש קטגוריות ושלוש רמות דחיפות בלבד', () => {
    assertEqual(Object.keys(prep.STAGES), ['before', 'during', 'after']);
    assertEqual(Object.keys(prep.URGENCY), ['critical', 'important', 'normal']);
  });

  s.test('ארבעת שלבי הקטלוג ממופים לשלוש הקטגוריות, ו"בדרך" נכנס ל"לפני"', () => {
    assertEqual(prep.STAGE_BY_PHASE['לפני'], 'before');
    assertEqual(prep.STAGE_BY_PHASE['בדרך'], 'before');
    assertEqual(prep.STAGE_BY_PHASE['בשהות'], 'during');
    assertEqual(prep.STAGE_BY_PHASE['בחזרה'], 'after');
  });

  s.test('addFromCatalog ממפה עדיפות לדחיפות', async () => {
    const t = await freshTrip();
    await prep.addFromCatalog(t.id, [
      { id: 'p0001', phase: 'לפני', text: 'בדיקת דרכון', priority: 'חובה' },
      { id: 'p0002', phase: 'בשהות', text: 'סים מקומי', priority: 'רלוונטי' },
      { id: 'p0003', phase: 'בחזרה', text: 'החזר מס', priority: 'נוחות' },
    ]);
    const all = await prep.listTasks(t.id);
    const by = Object.fromEntries(all.map(x => [x.title, [x.stage, x.urgency]]));
    assertEqual(by['בדיקת דרכון'], ['before', 'critical']);
    assertEqual(by['סים מקומי'], ['during', 'important']);
    assertEqual(by['החזר מס'], ['after', 'normal']);
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
    assertEqual((await prep.listTasks(t.id, 'before')).length, 2);
  });

  s.test('משימה מהקטלוג הופכת לרשומה עצמאית וניתנת לעריכה', async () => {
    const t = await freshTrip();
    await prep.addFromCatalog(t.id, [{ id: 'p0010', phase: 'לפני', text: 'מקור', priority: 'רלוונטי' }]);
    const [task] = await prep.listTasks(t.id, 'before');
    await prep.saveTask(t.id, { ...task, title: 'נערך ידנית' });
    const [updated] = await prep.listTasks(t.id, 'before');
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

  s.test('setUrgency משנה דחיפות בלבד ואינו נוגע בקטגוריה', async () => {
    const t = await freshTrip();
    const task = await prep.saveTask(t.id, { stage: 'during', title: 'כביסה', urgency: 'normal' });
    const moved = await prep.setUrgency(t.id, task.id, 'critical');
    assertEqual([moved.urgency, moved.stage], ['critical', 'during']);
  });

  s.test('setStage מעביר בין קטגוריות ואינו נוגע בדחיפות', async () => {
    const t = await freshTrip();
    const task = await prep.saveTask(t.id, { stage: 'before', title: 'דרכון', urgency: 'critical' });
    const moved = await prep.setStage(t.id, task.id, 'after');
    assertEqual([moved.stage, moved.urgency], ['after', 'critical']);
  });

  s.test('דחיפות או קטגוריה לא מוכרת נדחות', async () => {
    const t = await freshTrip();
    const task = await prep.saveTask(t.id, { stage: 'before', title: 'א' });
    await assertThrows(() => prep.setUrgency(t.id, task.id, 'דחוף מאוד'), 'דחיפות פסולה התקבלה');
    await assertThrows(() => prep.setStage(t.id, task.id, 'אי־שם'), 'קטגוריה פסולה התקבלה');
  });

  s.test('משימה עם סכום נספרת פעם אחת בלבד, ומשימה ללא סכום אינה נוגעת בכסף', async () => {
    const t = await freshTrip();
    await prep.saveTask(t.id, { stage: 'before', title: 'ביטוח', urgency: 'critical', plannedAmount: 200 });
    await prep.saveTask(t.id, { stage: 'before', title: 'בדיקת דרכון', urgency: 'critical' });
    const tasks = await prep.listTasks(t.id, 'before');
    assertEqual(tasks.reduce((sum, x) => sum + (x.plannedAmount || 0), 0), 200);
    assertEqual(tasks.find(x => x.title === 'בדיקת דרכון').plannedAmount, undefined);
  });

  s.test('קריטי שטרם בוצע מוצג ראשון, ומה שבוצע יורד לסוף', async () => {
    const t = await freshTrip();
    await prep.saveTask(t.id, { stage: 'before', title: 'רגיל', urgency: 'normal' });
    await prep.saveTask(t.id, { stage: 'before', title: 'קריטי בוצע', urgency: 'critical', done: true });
    await prep.saveTask(t.id, { stage: 'before', title: 'קריטי פתוח', urgency: 'critical' });
    const tasks = await prep.listTasks(t.id, 'before');
    assertEqual(tasks[0].title, 'קריטי פתוח');
    assertEqual(tasks[tasks.length - 1].title, 'קריטי בוצע', 'המשימה שבוצעה לא ירדה לסוף');
  });

  s.test('progress סופר done/total נכון לקטגוריה נתונה', async () => {
    const t = await freshTrip();
    await prep.saveTask(t.id, { stage: 'before', title: 'א', done: true });
    await prep.saveTask(t.id, { stage: 'before', title: 'ב' });
    await prep.saveTask(t.id, { stage: 'during', title: 'ג' });
    assertEqual(await prep.progress(t.id, 'before'), { done: 1, total: 2 });
    assertEqual(await prep.progress(t.id, 'during'), { done: 0, total: 1 });
  });

  s.test('הקטלוג נטען אופליין — קובץ סטטי מקומי בלי תלות ברשת', async () => {
    const { load } = await import('../js/catalog.js');
    const cat = await load();
    assertTrue(cat.length === 519);
  });

  // ---- קטגוריות, סדר וסינון הקטלוג ----

  s.test('משימה מהקטלוג יורשת את המדור שלה כקטגוריה', async () => {
    const t = await freshTrip();
    await prep.addFromCatalog(t.id, [{ id: 'p0001', phase: 'לפני', section: 'תכנון', text: 'דרכון', priority: 'חובה' }]);
    const [task] = await prep.listTasks(t.id);
    assertEqual(task.category, 'תכנון');
  });

  s.test('משימה ישנה בלי category נגזרת מהקטלוג לפי catalogId', async () => {
    const t = await freshTrip();
    // רשומה כמו שנשמרה לפני השינוי: catalogId בלי category
    await db.put(db.STORES.prepTasks, {
      tripId: t.id, catalogId: 'p0001', stage: 'before', urgency: 'critical', title: 'ישן',
    });
    const [task] = await prep.listTasks(t.id);
    assertEqual(task.category, 'תכנון', 'הקטגוריה לא נגזרה מהקטלוג');
  });

  s.test('משימה ידנית בלי קטגוריה נופלת לאחר', async () => {
    const t = await freshTrip();
    await prep.saveTask(t.id, { stage: 'before', title: 'משהו שלי' });
    const [task] = await prep.listTasks(t.id);
    assertEqual(task.category, prep.OTHER);
  });

  s.test('categoriesFor מחזיר את מדורי הקטלוג של השלב ואחר אחרון', async () => {
    const before = await prep.categoriesFor('before');
    assertTrue(before.includes('אריזה'), 'אריזה חסרה בשלב לפני');
    assertTrue(before.includes('בדרך'), 'המדור של יום הטיסה חסר בשלב לפני');
    assertEqual(before[before.length - 1], prep.OTHER);
    const after = await prep.categoriesFor('after');
    assertTrue(!after.includes('אריזה'), 'מדור של לפני דלף לשלב בחזרה');
  });

  s.test('reorder קובע סדר מפורש שגובר על הדחיפות', async () => {
    const t = await freshTrip();
    const a = await prep.saveTask(t.id, { stage: 'before', category: 'אריזה', urgency: 'critical', title: 'א' });
    const b = await prep.saveTask(t.id, { stage: 'before', category: 'אריזה', urgency: 'normal', title: 'ב' });
    assertEqual((await prep.listTasks(t.id)).map(x => x.title), ['א', 'ב'], 'המיון ההתחלתי אינו לפי דחיפות');
    await prep.reorder(t.id, 'before', 'אריזה', [b.id, a.id]);
    assertEqual((await prep.listTasks(t.id)).map(x => x.title), ['ב', 'א'], 'הסדר הידני לא גבר על הדחיפות');
  });

  s.test('גרירה לקבוצה אחרת מעבירה שלב וקטגוריה יחד', async () => {
    const t = await freshTrip();
    const a = await prep.saveTask(t.id, { stage: 'before', category: 'אריזה', title: 'א' });
    await prep.reorder(t.id, 'during', 'במהלך השהות', [a.id]);
    const [task] = await prep.listTasks(t.id);
    assertEqual([task.stage, task.category], ['during', 'במהלך השהות']);
  });

  s.test('מה שבוצע יורד לסוף גם כשיש סדר ידני', async () => {
    const t = await freshTrip();
    const a = await prep.saveTask(t.id, { stage: 'before', category: 'אריזה', title: 'א', done: true });
    const b = await prep.saveTask(t.id, { stage: 'before', category: 'אריזה', title: 'ב' });
    await prep.reorder(t.id, 'before', 'אריזה', [a.id, b.id]);
    assertEqual((await prep.listTasks(t.id)).map(x => x.title), ['ב', 'א']);
  });

  s.test('usedCatalogIds מחזיר את מה שכבר ברשימה, והסרה מחזירה לקטלוג', async () => {
    const t = await freshTrip();
    await prep.addFromCatalog(t.id, [{ id: 'p0001', phase: 'לפני', section: 'תכנון', text: 'דרכון', priority: 'חובה' }]);
    assertTrue((await prep.usedCatalogIds(t.id)).has('p0001'), 'הפריט לא סומן כתפוס');
    const [task] = await prep.listTasks(t.id);
    await prep.removeTask(t.id, task.id);
    assertTrue(!(await prep.usedCatalogIds(t.id)).has('p0001'), 'הפריט לא חזר לקטלוג אחרי הסרה');
  });

  s.test('מה שתפוס בטיול אחד זמין בטיול אחר', async () => {
    const a = await freshTrip();
    const b = await trips.createTrip({ name: 'טיול שני', currency: 'ILS' });
    await prep.addFromCatalog(a.id, [{ id: 'p0001', phase: 'לפני', section: 'תכנון', text: 'דרכון', priority: 'חובה' }]);
    assertTrue((await prep.usedCatalogIds(a.id)).has('p0001'));
    assertTrue(!(await prep.usedCatalogIds(b.id)).has('p0001'), 'ההסתרה דלפה בין טיולים');
  });

  await s.done();
}
