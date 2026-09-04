import * as db from './db.js';

const HIDDEN_KEY = 'catalogHidden';

let cache = null;

/** טוען את קטלוג ההכנה (519 פריטים, קריאה בלבד) פעם אחת ומטמין בזיכרון. */
export async function load() {
  if (cache) return cache;
  const res = await fetch('./data/prep-catalog.json');
  if (!res.ok) throw new Error('לא ניתן לטעון את קטלוג ההכנה');
  cache = await res.json();
  return cache;
}

let index = null;

/** מפת id -> פריט, לחיפוש חוזר בלי לסרוק 519 שורות בכל קריאה. */
export async function byId() {
  if (index) return index;
  index = new Map((await load()).map(item => [item.id, item]));
  return index;
}

const PHASE_ORDER = ['לפני', 'בדרך', 'בשהות', 'בחזרה'];

function uniqueInOrder(values) {
  const seen = new Set();
  const out = [];
  for (const v of values) {
    if (!seen.has(v)) { seen.add(v); out.push(v); }
  }
  return out;
}

/**
 * פריטים שהוסתרו מהקטלוג בכל הטיולים. ההסתרה היא העדפה של המשתמש ולא מחיקה:
 * הפריט נשאר בקובץ הקטלוג, ואפשר להחזיר אותו ממסך ההגדרות.
 */
export async function hiddenIds() {
  return new Set(await db.getSetting(HIDDEN_KEY, []));
}

export async function setHidden(ids) {
  const clean = [...new Set(ids)].filter(id => typeof id === 'string' && id);
  await db.setSetting(HIDDEN_KEY, clean);
  return clean;
}

export async function hide(id) {
  const ids = await db.getSetting(HIDDEN_KEY, []);
  return ids.includes(id) ? ids : setHidden([...ids, id]);
}

export async function unhide(id) {
  const ids = await db.getSetting(HIDDEN_KEY, []);
  return setHidden(ids.filter(x => x !== id));
}

/** הקטלוג כפי שהמשתמש רואה אותו: בלי מה שהוסתר. */
export async function visible() {
  const hidden = await hiddenIds();
  return (await load()).filter(item => !hidden.has(item.id));
}

export async function phases() {
  const cat = await visible();
  const present = new Set(cat.map(x => x.phase));
  return PHASE_ORDER.filter(p => present.has(p));
}

export async function sections(phase) {
  const cat = await visible();
  return uniqueInOrder(cat.filter(x => x.phase === phase).map(x => x.section));
}

export async function topics(phase, section) {
  const cat = await visible();
  return uniqueInOrder(cat.filter(x => x.phase === phase && x.section === section).map(x => x.topic));
}

export async function byTopic(phase, section, topic) {
  const cat = await visible();
  return cat.filter(x => x.phase === phase && x.section === section && x.topic === topic);
}

export async function search(q) {
  const cat = await visible();
  const needle = (q || '').trim().toLowerCase();
  if (!needle) return [];
  return cat.filter(x =>
    x.text.toLowerCase().includes(needle) ||
    x.topic.toLowerCase().includes(needle) ||
    x.section.toLowerCase().includes(needle) ||
    (x.group || '').toLowerCase().includes(needle)
  );
}
