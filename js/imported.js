import * as db from './db.js';

/**
 * רשימות פריטים שהמשתמש העלה בעצמו. הן חיות לצד הקטלוג המובנה ולא בתוכו:
 * הקטלוג הוא קובץ קריאה-בלבד ששייך למוצר, והרשימות האלה שייכות למכשיר.
 * לכן הן נשמרות כהעדפה בסטור settings, בלי סטור חדש ובלי שינוי סכמה.
 */
const KEY = 'importedCatalogs';

/** תקרות שמירה: קובץ שבור לא אמור להפיל את האפליקציה או לנפח את המסד. */
export const MAX_ITEMS = 1000;
export const MAX_TEXT = 200;

/** אותם שלושה ערכים שבקטלוג המובנה, כדי שהדחיפות תמופה באותה הדרך. */
export const PRIORITIES = ['חובה', 'רלוונטי', 'נוחות'];
const DEFAULT_PRIORITY = 'נוחות';

export async function list() {
  return db.getSetting(KEY, []);
}

/** הפריטים של כל הרשימות יחד, כל אחד עם המדור והשלב של הרשימה שלו. */
export async function allItems() {
  return (await list()).flatMap(entry => itemsOf(entry));
}

/**
 * המדור של פריט מיובא הוא המדור שנבחר לרשימה, ואם לא נבחר — שם הרשימה.
 * כך משימה שנוספה מרשימה מיובאת תמיד יושבת תחת כותרת שאומרת מאיפה היא באה.
 */
export function itemsOf(entry) {
  return entry.items.map(item => ({
    ...item,
    section: entry.section || entry.name,
    phase: entry.phase || null,
  }));
}

function xlsxLib() {
  if (!window.XLSX) throw new Error('ספריית האקסל לא נטענה');
  return window.XLSX;
}

/**
 * קורא קובץ xlsx או csv ומחזיר את הפריטים שבו. אינו נוגע בשום נתון שמור —
 * מחזיר {ok:false, errors} על כל כישלון ולידציה, לפני שנשמר משהו.
 *
 * המבנה: עמודה ראשונה היא טקסט הפריט, עמודה שנייה אופציונלית היא הדחיפות.
 * שורת כותרת מזוהה לפי המילה "פריט" בתא הראשון ונדלגת.
 */
export async function parse(file) {
  const XLSX = xlsxLib();
  let rows;
  try {
    const csv = /\.csv$/i.test(file.name);
    const wb = csv
      // file.text() מפענח UTF-8, וזה מה שמחזיק עברית בקובץ csv
      ? XLSX.read((await file.text()).replace(/^﻿/, ''), { type: 'string' })
      : XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) throw new Error('empty');
    rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  } catch {
    return { ok: false, errors: ['לא הצלחנו לקרוא את הקובץ. צריך xlsx או csv.'], items: [] };
  }

  if (rows.length && String(rows[0][0] ?? '').includes('פריט')) rows = rows.slice(1);

  const errors = [];
  const items = [];
  rows.forEach((row, index) => {
    const text = String(row[0] ?? '').trim();
    if (!text) return;                       // שורה ריקה אינה שגיאה, פשוט מדלגים
    const rowNum = index + 1;
    if (text.length > MAX_TEXT) {
      errors.push(`שורה ${rowNum}: הפריט ארוך מ-${MAX_TEXT} תווים`);
      return;
    }
    const priority = String(row[1] ?? '').trim();
    if (priority && !PRIORITIES.includes(priority)) {
      errors.push(`שורה ${rowNum}: דחיפות "${priority}" אינה אחת מ-${PRIORITIES.join(' / ')}`);
      return;
    }
    items.push({ text, priority: priority || DEFAULT_PRIORITY });
  });

  if (!items.length && !errors.length) errors.push('לא נמצאו פריטים בקובץ');
  if (items.length > MAX_ITEMS) errors.push(`יש ${items.length} פריטים, והמקסימום הוא ${MAX_ITEMS}`);
  if (errors.length) return { ok: false, errors: errors.slice(0, 20), items: [] };
  return { ok: true, errors: [], items };
}

/**
 * שומר רשימה חדשה. המזהים מתחילים ב-imp- ולכן לעולם אינם מתנגשים עם pNNNN
 * של הקטלוג המובנה, וכל מה שעובד על catalogId ממשיך לעבוד בלי שינוי.
 */
export async function add({ name, items, phase = null, section = null }) {
  const clean = (name || '').trim();
  if (!clean) throw new Error('לרשימה חייב להיות שם');
  if (!items?.length) throw new Error('אין פריטים לשמור');

  const lists = await list();
  if (lists.some(l => l.name === clean)) throw new Error('כבר קיימת רשימה מיובאת בשם הזה');

  const id = `imp-${crypto.randomUUID()}`;
  const entry = {
    id,
    name: clean,
    addedAt: new Date().toISOString().slice(0, 10),
    phase: phase || null,
    section: section || null,
    items: items.map((item, index) => ({
      id: `${id}-${String(index + 1).padStart(4, '0')}`,
      text: item.text,
      priority: item.priority || DEFAULT_PRIORITY,
    })),
  };
  await db.setSetting(KEY, [...lists, entry]);
  return entry;
}

/**
 * מחיקת רשימה מסירה רק את הרשימה. משימות שכבר נוספו לטיולים נשארות —
 * הן העתקים עצמאיים עם כותרת משלהן, וה-catalogId שלהן פשוט מפסיק להצביע
 * למשהו. זה כבר המצב של כל משימה שהמדור שלה הוסר מהקטלוג.
 */
export async function remove(id) {
  const lists = await list();
  await db.setSetting(KEY, lists.filter(l => l.id !== id));
}

/** קובץ תבנית להורדה, כדי שלא יהיה צריך לנחש את מבנה העמודות. */
export function templateBlob() {
  const XLSX = xlsxLib();
  const ws = XLSX.utils.aoa_to_sheet([
    ['פריט', 'דחיפות'],
    ['נעלי טרקים מבורגות', 'חובה'],
    ['מקלות הליכה', 'רלוונטי'],
    ['כרית ניפוח', 'נוחות'],
  ]);
  ws['!cols'] = [{ wch: 40 }, { wch: 12 }];
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(wb, ws, 'פריטים');
  return new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}
