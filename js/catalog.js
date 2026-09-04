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
 * הפריטים שבעל המוצר סימן שאינם רלוונטיים לו, ולכן אינם מוצעים בשום טיול
 * כברירת מחדל. זו העדפה ולא מחיקה: הפריטים נשארים בקובץ הקטלוג, ומסך
 * ההגדרות מחזיר כל אחד מהם בלחיצה. ברגע שמשתמש נוגע ברשימה, ההעדפה שלו
 * נשמרת במסד וגוברת על ברירת המחדל הזו.
 */
const DEFAULT_HIDDEN = `
  p0028 p0030 p0032 p0033 p0034 p0039 p0047 p0048 p0049 p0053 p0054 p0063 p0067 p0068 p0069
  p0070 p0071 p0072 p0073 p0074 p0075 p0076 p0077 p0078 p0079 p0080 p0081 p0082 p0083 p0084
  p0085 p0086 p0087 p0088 p0089 p0090 p0091 p0092 p0093 p0094 p0119 p0120 p0121 p0122 p0123
  p0125 p0126 p0127 p0128 p0129 p0130 p0131 p0132 p0134 p0135 p0136 p0137 p0138 p0139 p0140
  p0141 p0142 p0143 p0144 p0145 p0146 p0147 p0148 p0149 p0150 p0151 p0152 p0153 p0160 p0161
  p0162 p0163 p0164 p0165 p0166 p0167 p0168 p0276 p0277 p0278 p0279 p0280 p0284 p0285 p0287
  p0290 p0291 p0292 p0293 p0294 p0295 p0297 p0298 p0299 p0300 p0301 p0302 p0303 p0304 p0305
  p0306 p0307 p0308 p0310 p0311 p0312 p0313 p0314 p0315 p0316 p0317 p0319 p0326 p0328 p0331
  p0332 p0344 p0346 p0378 p0379 p0380 p0381 p0382 p0383 p0384 p0385 p0386 p0387 p0388 p0389
  p0390 p0391 p0395 p0396 p0397 p0406 p0407 p0408 p0409 p0410 p0411 p0412 p0413 p0414 p0415
  p0416 p0417 p0418 p0419 p0420 p0421 p0422 p0423 p0424 p0425 p0426 p0427 p0428 p0429 p0430
  p0431 p0432 p0433 p0434 p0435 p0436 p0437 p0438 p0439 p0440 p0441 p0442 p0443 p0444 p0445
  p0446 p0447 p0448 p0449 p0450 p0451 p0452 p0453 p0454 p0455 p0456 p0457 p0458 p0459 p0460
  p0461 p0462 p0463 p0464 p0465 p0466 p0467 p0468 p0469 p0470 p0471 p0472 p0473 p0474 p0475
  p0476 p0505 p0506 p0507 p0508 p0509 p0510 p0511 p0512 p0513 p0517 p0518
`.trim().split(/\s+/);

export async function hiddenIds() {
  return new Set(await db.getSetting(HIDDEN_KEY, DEFAULT_HIDDEN));
}

export async function setHidden(ids) {
  const clean = [...new Set(ids)].filter(id => typeof id === 'string' && id);
  await db.setSetting(HIDDEN_KEY, clean);
  return clean;
}

// שתי הפעולות קוראות דרך hiddenIds, כך שהשינוי הראשון של המשתמש נשמר
// יחד עם כל ברירת המחדל ולא מוחק אותה.
export async function hide(id) {
  const ids = [...await hiddenIds()];
  return ids.includes(id) ? ids : setHidden([...ids, id]);
}

export async function unhide(id) {
  return setHidden([...await hiddenIds()].filter(x => x !== id));
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
