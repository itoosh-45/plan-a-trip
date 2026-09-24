import * as db from './db.js';
import * as trips from './trips.js';

export const SHEET_NAMES = ['סיכום', 'מסלול', 'תקציב', 'הוצאות'];

function xlsxLib() {
  if (!window.XLSX) throw new Error('ספריית האקסל לא נטענה');
  return window.XLSX;
}

function sheetFromRows(headers, rows) {
  const XLSX = xlsxLib();
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws['!cols'] = headers.map(h => ({ wch: Math.max(12, String(h).length + 2) }));
  for (let c = 0; c < headers.length; c++) {
    const addr = XLSX.utils.encode_cell({ r: 0, c });
    if (ws[addr]) {
      ws[addr].s = { fill: { fgColor: { rgb: '06BCC1' } }, font: { bold: true, color: { rgb: 'FFFFFF' } } };
    }
  }
  return ws;
}

const ITIN_HEADERS = [
  'שורה', 'id', 'segmentId', 'סוג מקטע', 'יעד', 'מדינה', 'תאריך התחלה', 'תאריך סיום',
  'מטבע יעד', 'הקצאה', 'סוג פריט', 'כותרת', 'תאריך', 'שעה', 'תאריך סיום פריט',
  'מיקום', 'הזמנה', 'קטגוריה', 'מתוכנן', 'מטבע פריט', 'שער פריט', 'בוצע',
];
// שני בלוקים באותו גיליון: הקצאות ליעדים, ותקציב מתוכנן לכל קטגוריה.
// שתי העמודות הראשונות הן הפורמט הישן, ולכן קובץ שיוצא לפני כן עדיין נטען.
const BUDGET_HEADERS = ['יעד', 'הקצאה', 'קטגוריה', 'תקציב'];
const BUDGET_REQUIRED = ['יעד', 'הקצאה'];
const EXP_HEADERS = [
  'id', 'סוג רשומה', 'סכום', 'מטבע', 'יעד', 'קטגוריה', 'הערה', 'תאריך',
  'שער', 'תאריך שער', 'מקור שער',
];

/** בונה קובץ xlsx בפורמט הקבוע (4 גיליונות) עבור טיול יחיד. */
export async function build(tripId) {
  const XLSX = xlsxLib();
  const trip = await trips.getTrip(tripId);
  if (!trip) throw new Error('הטיול לא נמצא');
  const [segments, items, expenses, categories, budgets] = await Promise.all([
    db.all(db.STORES.segments, tripId),
    db.all(db.STORES.items, tripId),
    db.all(db.STORES.expenses, tripId),
    trips.categories(tripId),
    db.all(db.STORES.budgets, tripId),
  ]);
  const catName = id => categories.find(c => c.id === id)?.name || '';
  const segName = id => segments.find(s => s.id === id)?.city || '';

  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };

  XLSX.utils.book_append_sheet(wb, sheetFromRows(['שדה', 'ערך'], [
    ['שם הטיול', trip.name],
    ['מטבע ראשי', trip.currency],
    ['תקציב כולל', trip.totalBudget],
    ['תאריך התחלה', trip.startDate || ''],
    ['תאריך סיום', trip.endDate || ''],
  ]), 'סיכום');

  XLSX.utils.book_append_sheet(wb, sheetFromRows(ITIN_HEADERS, [
    ...segments.map(s => ['מקטע', s.id, '', s.kind || 'place', s.city, s.country || '',
      s.startDate || '', s.endDate || '', s.currency || '', s.allocation || 0,
      '', '', '', '', '', '', '', '', '', '', '', '']),
    ...items.map(i => ['פריט', i.id, i.segmentId || '', '', '', '', '', '', '', '',
      i.type, i.title, i.date, i.time || '', i.endDate || '', i.place || '', i.ref || '',
      catName(i.categoryId), i.plannedAmount ?? '', i.currency || '', i.rateToILS ?? '',
      i.done ? 'כן' : '']),
  ]), 'מסלול');

  const budgetRows = [];
  for (let i = 0; i < Math.max(segments.length, budgets.length); i++) {
    const seg = segments[i];
    const bud = budgets[i];
    budgetRows.push([
      seg ? seg.city : '', seg ? (seg.allocation || 0) : '',
      bud ? catName(bud.categoryId) : '', bud ? (bud.amount || 0) : '',
    ]);
  }
  XLSX.utils.book_append_sheet(wb, sheetFromRows(BUDGET_HEADERS, budgetRows), 'תקציב');

  XLSX.utils.book_append_sheet(wb, sheetFromRows(EXP_HEADERS, expenses.map(e => [
    e.id, e.kind || 'expense', e.amount, e.currency, segName(e.segmentId), catName(e.categoryId),
    e.note || '', e.date, e.rateToILS ?? '', e.rateDate || '', e.rateSource || '',
  ])), 'הוצאות');

  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true });
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

function sheetHeaderRow(XLSX, ws) {
  if (!ws['!ref']) return [];
  const range = XLSX.utils.decode_range(ws['!ref']);
  const headers = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = ws[XLSX.utils.encode_cell({ r: 0, c })];
    headers.push(cell ? String(cell.v) : '');
  }
  return headers;
}

const num = v => (v === '' || v === undefined || v === null ? undefined : Number(v));

/**
 * קורא ומאמת קובץ xlsx. אינו נוגע בשום נתון קיים — מחזיר תצוגה מקדימה בלבד.
 * {ok:false, errors:[...]} על כל כישלון ולידציה, לפני שנוגעים בנתון אחד.
 */
export async function parse(file) {
  const XLSX = xlsxLib();
  let wb;
  try {
    const buf = await file.arrayBuffer();
    wb = XLSX.read(buf, { type: 'array' });
    if (!wb.SheetNames.length) throw new Error('empty');
  } catch {
    return { ok: false, errors: ['הקובץ אינו קובץ אקסל תקין (xlsx)'], preview: null };
  }

  const missingSheets = SHEET_NAMES.filter(name => !wb.SheetNames.includes(name));
  if (missingSheets.length) {
    return { ok: false, errors: missingSheets.map(n => `הגיליון "${n}" חסר בקובץ`), preview: null };
  }

  const need = {
    'מסלול': ['שורה', 'id', 'סוג פריט', 'כותרת', 'תאריך'],
    'תקציב': BUDGET_REQUIRED,
    'הוצאות': ['id', 'סכום', 'מטבע', 'יעד'],
  };
  const errors = [];
  for (const [sheet, cols] of Object.entries(need)) {
    const present = sheetHeaderRow(XLSX, wb.Sheets[sheet]);
    const missing = cols.filter(c => !present.includes(c));
    if (missing.length) errors.push(`בגיליון "${sheet}" חסרות עמודות: ${missing.join(', ')}`);
  }
  if (errors.length) return { ok: false, errors, preview: null };

  const sheetRows = name => XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: '' });

  const segments = [];
  const items = [];
  sheetRows('מסלול').forEach((row, idx) => {
    const rowNum = idx + 2;
    if (row['שורה'] === 'מקטע') {
      const kind = row['סוג מקטע'] || 'place';
      if (!row['יעד']) {
        errors.push(`שורה ${rowNum} בגיליון "מסלול" — למקטע חסר שם יעד`);
        return;
      }
      if (kind !== 'general' && !row['תאריך התחלה']) {
        errors.push(`שורה ${rowNum} בגיליון "מסלול" — ליעד חסר תאריך התחלה`);
        return;
      }
      segments.push({
        id: row['id'] || undefined, kind, city: String(row['יעד']), country: String(row['מדינה'] || ''),
        startDate: row['תאריך התחלה'] ? String(row['תאריך התחלה']) : null,
        endDate: row['תאריך סיום'] ? String(row['תאריך סיום']) : (row['תאריך התחלה'] ? String(row['תאריך התחלה']) : null),
        currency: String(row['מטבע יעד'] || 'ILS').toUpperCase(),
        allocation: Number(row['הקצאה']) || 0,
      });
    } else if (row['שורה'] === 'פריט') {
      if (!row['כותרת'] || !row['תאריך']) {
        errors.push(`שורה ${rowNum} בגיליון "מסלול" — לפריט חסרה כותרת או תאריך`);
        return;
      }
      items.push({
        id: row['id'] || undefined, segmentId: row['segmentId'] || null,
        type: row['סוג פריט'] || 'other', title: String(row['כותרת']), date: String(row['תאריך']),
        time: row['שעה'] || undefined, endDate: row['תאריך סיום פריט'] || undefined,
        place: row['מיקום'] || undefined, ref: row['הזמנה'] || undefined,
        categoryName: row['קטגוריה'] || '', plannedAmount: num(row['מתוכנן']),
        currency: row['מטבע פריט'] ? String(row['מטבע פריט']).toUpperCase() : undefined,
        rateToILS: num(row['שער פריט']),
        done: String(row['בוצע'] || '').trim() === 'כן' || undefined,
      });
    } else {
      errors.push(`שורה ${rowNum} בגיליון "מסלול" — ערך לא מוכר בעמודת "שורה": "${row['שורה']}"`);
    }
  });

  const expenses = [];
  sheetRows('הוצאות').forEach((row, idx) => {
    const rowNum = idx + 2;
    if (row['סכום'] === '' || row['סכום'] === undefined) {
      errors.push(`שורה ${rowNum} בגיליון "הוצאות" — חסר סכום`);
      return;
    }
    const n = Number(row['סכום']);
    if (!Number.isFinite(n) || n <= 0) {
      errors.push(`שורה ${rowNum} בגיליון "הוצאות" — הסכום חייב להיות מספר גדול מאפס`);
      return;
    }
    if (!row['יעד']) {
      errors.push(`שורה ${rowNum} בגיליון "הוצאות" — חסר שיוך ליעד`);
      return;
    }
    expenses.push({
      id: row['id'] || undefined, kind: row['סוג רשומה'] || 'expense', amount: n,
      currency: String(row['מטבע'] || 'ILS').toUpperCase(), segmentName: String(row['יעד']),
      categoryName: row['קטגוריה'] || '', note: row['הערה'] || undefined,
      date: String(row['תאריך'] || ''), rateToILS: num(row['שער']),
      rateDate: row['תאריך שער'] || undefined, rateSource: row['מקור שער'] || undefined,
    });
  });

  // שתי העמודות של תקציבי הקטגוריות אינן חובה: קובץ מהפורמט הקודם אינו כולל
  // אותן, והוא עדיין קובץ תקין שאפשר לייבא.
  const budgets = [];
  sheetRows('תקציב').forEach((row, idx) => {
    const name = String(row['קטגוריה'] || '').trim();
    if (!name) return;
    const amount = Number(row['תקציב']);
    if (!Number.isFinite(amount) || amount <= 0) {
      errors.push(`שורה ${idx + 2} בגיליון "תקציב" — התקציב של "${name}" חייב להיות מספר גדול מאפס`);
      return;
    }
    budgets.push({ categoryName: name, amount });
  });

  if (errors.length) return { ok: false, errors, preview: null };

  return {
    ok: true,
    errors: [],
    preview: {
      segments: segments.length, items: items.length,
      expenses: expenses.length, budgets: budgets.length,
    },
    data: { segments, items, expenses, budgets },
  };
}

/** מיישם תצוגה מקדימה שאושרה: מחליף מסלול והוצאות של הטיול הזה בלבד. */
export async function apply(tripId, parsed) {
  if (!parsed?.ok) throw new Error('אין נתונים תקינים ליישום');
  const { segments, items, expenses, budgets = [] } = parsed.data;
  const cats = await trips.categories(tripId);
  const catId = name => cats.find(c => c.name === name)?.id || undefined;

  await db.removeWhere(db.STORES.segments, tripId);
  await db.removeWhere(db.STORES.items, tripId);
  await db.removeWhere(db.STORES.expenses, tripId);
  await db.removeWhere(db.STORES.budgets, tripId);

  if (segments.length) await db.bulkPut(db.STORES.segments, segments.map(s => ({ ...s, tripId })));
  await trips.ensureGeneralSegment(tripId);

  const saved = await db.all(db.STORES.segments, tripId);
  const segId = name => saved.find(s => s.city === name)?.id
    || saved.find(s => s.kind === 'general')?.id;

  if (items.length) await db.bulkPut(db.STORES.items, items.map(({ categoryName, ...i }) => ({
    ...i, tripId, categoryId: catId(categoryName),
  })));
  if (expenses.length) await db.bulkPut(db.STORES.expenses, expenses.map(({ categoryName, segmentName, ...e }) => ({
    ...e, tripId, categoryId: catId(categoryName), segmentId: segId(segmentName),
  })));

  // תקציב בלי קטגוריה מוכרת אינו תקציב של דבר, ולכן הוא נשמט בשקט.
  const trip = await trips.getTrip(tripId);
  const budgetRows = budgets
    .map(b => ({ categoryId: catId(b.categoryName), amount: b.amount }))
    .filter(b => b.categoryId)
    .map(b => ({ ...b, tripId, currency: trip?.currency || 'ILS' }));
  if (budgetRows.length) await db.bulkPut(db.STORES.budgets, budgetRows);

  return {
    counts: {
      segments: segments.length, items: items.length,
      expenses: expenses.length, budgets: budgetRows.length,
    },
  };
}
