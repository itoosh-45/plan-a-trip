import * as db from './db.js';
import { effectiveAmount } from './itinerary.js';

export { effectiveAmount };

const PRIORITY_ORDER = { 'חובה': 0, 'רלוונטי': 1, 'נוחות': 2 };

/**
 * שלב הרשימה הנוכחי לפי סטטוס הטיול. טיול "פעיל" מפוצל בין "בדרך" ל"בשהות"
 * לפי ימי מעבר (יום ההגעה או היציאה של המקטע הפעיל): אלה "בדרך", כל שאר ימי
 * הטיול הפעיל הם "בשהות". בלי הקשר תאריכים, ברירת המחדל היא "בשהות".
 */
export function currentPhase(tripStatus, { startDate, endDate, today } = {}) {
  if (tripStatus === 'planned') return 'לפני';
  if (tripStatus === 'done') return 'בחזרה';
  const t = today || new Date().toISOString().slice(0, 10);
  if (t === startDate || t === endDate) return 'בדרך';
  return 'בשהות';
}

export async function listTasks(tripId, phase) {
  const rows = await db.all(db.STORES.prepTasks, tripId);
  const filtered = phase ? rows.filter(t => t.phase === phase) : rows;
  return filtered.sort((a, b) => {
    if (!!a.done !== !!b.done) return a.done ? 1 : -1;
    const pa = PRIORITY_ORDER[a.priority] ?? 3;
    const pb = PRIORITY_ORDER[b.priority] ?? 3;
    if (pa !== pb) return pa - pb;
    return String(a.createdAt).localeCompare(String(b.createdAt));
  });
}

export async function saveTask(tripId, task) {
  const title = (task.title || '').trim();
  if (!title) throw new Error('למשימה חייבת להיות כותרת');
  if (!task.phase) throw new Error('למשימה חייב להיות שלב');
  return db.put(db.STORES.prepTasks, { ...task, id: task.id, tripId, title });
}

export async function toggleDone(tripId, taskId) {
  const task = await db.get(db.STORES.prepTasks, taskId);
  if (!task) throw new Error('המשימה לא נמצאה');
  return db.put(db.STORES.prepTasks, { ...task, done: !task.done });
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
    phase: c.phase,
    title: c.text,
    priority: c.priority,
    done: false,
  })));
}

export async function progress(tripId, phase) {
  const rows = await listTasks(tripId, phase);
  return { done: rows.filter(t => t.done).length, total: rows.length };
}
