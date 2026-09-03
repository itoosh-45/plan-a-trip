import * as db from './db.js';

/** שלוש קטגוריות, וכולן גלויות תמיד. אין מצב שמסתיר תוכן. */
export const STAGES = { before: 'לפני הטיול', during: 'במהלך השהייה', after: 'בחזרה' };

/** שלוש רמות דחיפות, מהגבוהה לנמוכה. */
export const URGENCY = { critical: 'קריטי', important: 'חשוב', normal: 'רגיל' };

/** הקטלוג נכתב בארבעה שלבים. "בדרך" (יום הטיסה) שייך להיערכות שלפני הטיול. */
export const STAGE_BY_PHASE = { 'לפני': 'before', 'בדרך': 'before', 'בשהות': 'during', 'בחזרה': 'after' };
export const URGENCY_BY_PRIORITY = { 'חובה': 'critical', 'רלוונטי': 'important', 'נוחות': 'normal' };

const URGENCY_ORDER = { critical: 0, important: 1, normal: 2 };

export async function listTasks(tripId, stage) {
  const rows = await db.all(db.STORES.prepTasks, tripId);
  const filtered = stage ? rows.filter(t => t.stage === stage) : rows;
  return filtered.sort((a, b) => {
    if (!!a.done !== !!b.done) return a.done ? 1 : -1;
    const ua = URGENCY_ORDER[a.urgency] ?? 2;
    const ub = URGENCY_ORDER[b.urgency] ?? 2;
    if (ua !== ub) return ua - ub;
    return String(a.createdAt).localeCompare(String(b.createdAt));
  });
}

export async function saveTask(tripId, task) {
  const title = (task.title || '').trim();
  if (!title) throw new Error('למשימה חייבת להיות כותרת');
  const stage = task.stage || STAGE_BY_PHASE[task.phase] || 'before';
  if (!STAGES[stage]) throw new Error(`קטגוריה לא מוכרת: ${stage}`);
  const urgency = task.urgency || URGENCY_BY_PRIORITY[task.priority] || 'normal';
  if (!URGENCY[urgency]) throw new Error(`רמת דחיפות לא מוכרת: ${urgency}`);
  return db.put(db.STORES.prepTasks, {
    ...task, id: task.id, tripId, title, stage, urgency, segmentId: task.segmentId ?? null,
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

/** גרירה בין אזורים משנה דחיפות בלבד — לא קטגוריה. */
export async function setUrgency(tripId, taskId, urgency) {
  if (!URGENCY[urgency]) throw new Error(`רמת דחיפות לא מוכרת: ${urgency}`);
  return patch(tripId, taskId, { urgency });
}

/** מעבר בין קטגוריות נעשה בכפתור "העבר ל…", לא בגרירה. */
export async function setStage(tripId, taskId, stage) {
  if (!STAGES[stage]) throw new Error(`קטגוריה לא מוכרת: ${stage}`);
  return patch(tripId, taskId, { stage });
}

export async function removeTask(tripId, taskId) {
  await db.remove(db.STORES.prepTasks, taskId);
}

/** מוסיף פריטים מהקטלוג כמשימות עצמאיות. מדלג על catalogId שכבר קיים לטיול. */
export async function addFromCatalog(tripId, catalogItems) {
  const existing = await db.all(db.STORES.prepTasks, tripId);
  const already = new Set(existing.filter(t => t.catalogId).map(t => t.catalogId));
  const toAdd = catalogItems.filter(c => !already.has(c.id));
  if (!toAdd.length) return [];
  return db.bulkPut(db.STORES.prepTasks, toAdd.map(c => ({
    tripId,
    catalogId: c.id,
    stage: STAGE_BY_PHASE[c.phase] || 'before',
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
