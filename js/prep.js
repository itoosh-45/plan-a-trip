import * as db from './db.js';
import * as catalog from './catalog.js';

/** ארבע רשימות קבועות, וכולן גלויות תמיד. אין מצב שמסתיר תוכן. */
export const STAGES = {
  before: 'לפני הטיול', during: 'במהלך השהייה', after: 'בחזרה', gear: 'ציוד מיוחד',
};

/** שלוש רמות דחיפות, מהגבוהה לנמוכה. */
export const URGENCY = { critical: 'קריטי', important: 'חשוב', normal: 'רגיל' };

/**
 * הקטלוג נכתב בחמישה שלבים. "בדרך" (יום הטיסה) שייך להיערכות שלפני הטיול.
 * "ציוד מיוחד" — ציוד לטרקים וציוד סקי — עומד בפני עצמו: הוא לא הכנה
 * לוגיסטית, ורוב הטיולים לא נוגעים בו בכלל.
 */
export const STAGE_BY_PHASE = {
  'לפני': 'before', 'בדרך': 'before', 'בשהות': 'during', 'בחזרה': 'after',
  'ציוד מיוחד': 'gear',
};
export const URGENCY_BY_PRIORITY = { 'חובה': 'critical', 'רלוונטי': 'important', 'נוחות': 'normal' };

/** הקטגוריה של משימה שלא הגיעה מהקטלוג, או שהמדור שלה כבר לא קיים בו. */
export const OTHER = 'אחר';

/**
 * רשימה בשם חופשי חיה על רשומת הטיול, ולא בסטור משלה: היא שייכת לטיול,
 * נמחקת איתו ונכנסת לגיבוי איתו, בלי שינוי סכמה.
 * המזהה שלה יושב באותו שדה stage שבו יושבים שלושת השלבים הקבועים.
 */
export async function listsFor(tripId) {
  const trip = await db.get(db.STORES.trips, tripId);
  const custom = {};
  for (const list of trip?.customLists || []) custom[list.id] = list.name;
  return { ...STAGES, ...custom };
}

export async function addList(tripId, name) {
  const clean = (name || '').trim();
  if (!clean) throw new Error('לרשימה חייב להיות שם');
  const trip = await db.get(db.STORES.trips, tripId);
  if (!trip) throw new Error('הטיול לא נמצא');
  const lists = trip.customLists || [];
  if (lists.some(l => l.name === clean)) throw new Error('כבר קיימת רשימה בשם הזה');
  const list = { id: `list-${crypto.randomUUID()}`, name: clean };
  await db.put(db.STORES.trips, { ...trip, customLists: [...lists, list] });
  return list;
}

/** מחיקת רשימה מוחקת גם את המשימות שבה. אין משימה בלי רשימה. */
export async function removeList(tripId, listId) {
  if (STAGES[listId]) throw new Error('אי אפשר למחוק שלב קבוע');
  const trip = await db.get(db.STORES.trips, tripId);
  if (!trip) throw new Error('הטיול לא נמצא');
  const rows = await db.all(db.STORES.prepTasks, tripId);
  for (const task of rows.filter(t => t.stage === listId)) {
    await db.remove(db.STORES.prepTasks, task.id);
  }
  await db.put(db.STORES.trips, {
    ...trip, customLists: (trip.customLists || []).filter(l => l.id !== listId),
  });
}

async function assertStage(tripId, stage) {
  const lists = await listsFor(tripId);
  if (!lists[stage]) throw new Error(`קטגוריה לא מוכרת: ${stage}`);
}

const URGENCY_ORDER = { critical: 0, important: 1, normal: 2 };

/**
 * הקטגוריה נגזרת בקריאה ולא נשמרת במיגרציה: משימה מהקטלוג יורשת את המדור
 * שממנו באה, ומשימה ידנית מקבלת את מה שנבחר לה בטופס. לכן משימות ישנות
 * מקבלות קטגוריה נכונה בלי לגעת בנתונים השמורים.
 */
async function withCategory(rows) {
  const byId = await catalog.byId();
  return rows.map(t => ({
    ...t,
    category: t.category || byId.get(t.catalogId)?.section || OTHER,
  }));
}

/**
 * סדר התצוגה. פריט שנגרר קיבל order מפורש והוא קובע; פריט שמעולם לא נגרר
 * ממוין לפי דחיפות ואז לפי זמן היצירה, כמו קודם. מה שבוצע תמיד יורד לסוף.
 */
function compare(a, b) {
  if (!!a.done !== !!b.done) return a.done ? 1 : -1;
  const oa = a.order, ob = b.order;
  if (oa != null && ob != null && oa !== ob) return oa - ob;
  if (oa != null && ob == null) return -1;
  if (oa == null && ob != null) return 1;
  const ua = URGENCY_ORDER[a.urgency] ?? 2;
  const ub = URGENCY_ORDER[b.urgency] ?? 2;
  if (ua !== ub) return ua - ub;
  return String(a.createdAt).localeCompare(String(b.createdAt));
}

export async function listTasks(tripId, stage) {
  const rows = await withCategory(await db.all(db.STORES.prepTasks, tripId));
  const filtered = stage ? rows.filter(t => t.stage === stage) : rows;
  return filtered.sort(compare);
}

/** מזהי הקטלוג שכבר נמצאים ברשימה של הטיול. בורר הקטלוג לא מציג אותם. */
export async function usedCatalogIds(tripId) {
  const rows = await db.all(db.STORES.prepTasks, tripId);
  return new Set(rows.filter(t => t.catalogId).map(t => t.catalogId));
}

/**
 * הקטגוריות של שלב, בסדר שבו הן מופיעות בקטלוג. "אחר" קיים תמיד ותמיד אחרון,
 * כי משימה ידנית חייבת מקום לשבת בו.
 */
export async function categoriesFor(stage) {
  const cat = await catalog.load();
  const out = [];
  for (const item of cat) {
    // רשימה בשם חופשי אינה קשורה לשלב, ולכן פתוחה לכל מדורי הקטלוג
    if (STAGES[stage] && STAGE_BY_PHASE[item.phase] !== stage) continue;
    if (!out.includes(item.section)) out.push(item.section);
  }
  out.push(OTHER);
  return out;
}

export async function saveTask(tripId, task) {
  const title = (task.title || '').trim();
  if (!title) throw new Error('למשימה חייבת להיות כותרת');
  const stage = task.stage || STAGE_BY_PHASE[task.phase] || 'before';
  await assertStage(tripId, stage);
  const urgency = task.urgency || URGENCY_BY_PRIORITY[task.priority] || 'normal';
  if (!URGENCY[urgency]) throw new Error(`רמת דחיפות לא מוכרת: ${urgency}`);
  return db.put(db.STORES.prepTasks, {
    ...task,
    id: task.id,
    tripId,
    title,
    stage,
    urgency,
    category: (task.category || '').trim() || OTHER,
    segmentId: task.segmentId ?? null,
  });
}

async function patch(tripId, taskId, changes) {
  const task = await db.get(db.STORES.prepTasks, taskId);
  if (!task) throw new Error('המשימה לא נמצאה');
  return db.put(db.STORES.prepTasks, { ...task, ...changes });
}

export const toggleDone = async (tripId, taskId) => {
  const task = await db.get(db.STORES.prepTasks, taskId);
  if (!task) throw new Error('המשימה לא נמצאה');
  return patch(tripId, taskId, { done: !task.done });
};

/** דחיפות נבחרת בטופס העריכה בלבד. הגרירה עוסקת בסדר, לא בדחיפות. */
export async function setUrgency(tripId, taskId, urgency) {
  if (!URGENCY[urgency]) throw new Error(`רמת דחיפות לא מוכרת: ${urgency}`);
  return patch(tripId, taskId, { urgency });
}

export async function setStage(tripId, taskId, stage) {
  await assertStage(tripId, stage);
  return patch(tripId, taskId, { stage });
}

/**
 * מסדר קבוצה שלמה אחרי גרירה: כל פריט בקבוצה מקבל order מפורש לפי מקומו
 * ברשימה, ואת השלב והקטגוריה של הקבוצה שאליה נגרר.
 */
export async function reorder(tripId, stage, category, orderedIds) {
  await assertStage(tripId, stage);
  const rows = await db.all(db.STORES.prepTasks, tripId);
  const byId = new Map(rows.map(r => [r.id, r]));
  const updates = [];
  orderedIds.forEach((id, index) => {
    const task = byId.get(id);
    if (task) updates.push({ ...task, stage, category, order: index });
  });
  if (!updates.length) return [];
  return db.bulkPut(db.STORES.prepTasks, updates);
}

export async function removeTask(tripId, taskId) {
  await db.remove(db.STORES.prepTasks, taskId);
}

/** מוסיף פריטים מהקטלוג כמשימות עצמאיות. מדלג על catalogId שכבר קיים לטיול. */
export async function addFromCatalog(tripId, catalogItems, stage) {
  const already = await usedCatalogIds(tripId);
  const toAdd = catalogItems.filter(c => !already.has(c.id));
  if (!toAdd.length) return [];
  if (stage) await assertStage(tripId, stage);
  return db.bulkPut(db.STORES.prepTasks, toAdd.map(c => ({
    tripId,
    catalogId: c.id,
    stage: stage || STAGE_BY_PHASE[c.phase] || 'before',
    category: c.section || OTHER,
    urgency: URGENCY_BY_PRIORITY[c.priority] || 'normal',
    title: c.text,
    segmentId: null,
    done: false,
  })));
}

export async function progress(tripId, stage) {
  const rows = await listTasks(tripId, stage);
  return { done: rows.filter(t => t.done).length, total: rows.length };
}
