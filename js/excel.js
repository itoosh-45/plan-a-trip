import * as db from './db.js';
import * as trips from './trips.js';

export const SHEET_NAMES = ['סיכום', 'מסלול', 'תקציב', 'הוצאות'];

function xlsxLib() {
  if (!window.XLSX) throw new Error('ספריית האקסל לא נטענה');
  return window.XLSX;
}

function styleHeaderRow(ws, colCount) {
  const XLSX = xlsxLib();
  for (let c = 0; c < colCount; c++) {
    const addr = XLSX.utils.encode_cell({ r: 0, c });
    if (ws[addr]) ws[addr].s = { fill: { fgColor: { rgb: '06BCC1' } }, font: { bold: true, color: { rgb: 'FFFFFF' } } };
  }
}

function sheetFromRows(headers, rows) {
  const XLSX = xlsxLib();
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws['!cols'] = headers.map(h => ({ wch: Math.max(12, String(h).length + 2) }));
  styleHeaderRow(ws, headers.length);
  return ws;
}

/** בונה קובץ xlsx בפורמט הקבוע (4 גיליונות) עבור טיול יחיד. */
export async function build(tripId) {
  const XLSX = xlsxLib();
  const trip = (await trips.listTrips()).find(t => t.id === tripId);
  if (!trip) throw new Error('הטיול לא נמצא');
  const { startDate, endDate } = await trips.tripDates(tripId);
  const [segments, items, budgets, expenses, categories] = await Promise.all([
    db.all(db.STORES.segments, tripId),
    db.all(db.STORES.items, tripId),
    db.all(db.STORES.budgets, tripId),
    db.all(db.STORES.expenses, tripId),
    trips.categories(tripId),
  ]);
  const catName = id => categories.find(c => c.id === id)?.name || '';

  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };

  const wsSummary = sheetFromRows(['שדה', 'ערך'], [
    ['שם הטיול', trip.name],
    ['מטבע בית', trip.homeCurrency],
    ['תקציב כולל', trip.totalBudget],
    ['סטטוס', trip.status],
    ['תאריך התחלה', startDate || ''],
    ['תאריך סיום', endDate || ''],
  ]);
  XLSX.utils.book_append_sheet(wb, wsSummary, 'סיכום');

  const itinHeaders = [
    'שורה', 'id', 'segmentId', 'עיר', 'מדינה', 'תאריך התחלה', 'תאריך סיום', 'מטבע מקטע',
    'סוג', 'כותרת', 'תאריך', 'שעה', 'תאריך סיום פריט', 'מיקום', 'הזמנה', 'קטגוריה',
    'מתוכנן', 'בפועל', 'מטבע פריט', 'סטטוס תשלום', 'אמצעי תשלום', 'שער', 'תאריך שער', 'מקור שער',
  ];
  const itinRows = [
    ...segments.map(s => ['מקטע', s.id, '', s.city, s.country || '', s.startDate, s.endDate, s.currency,
      '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']),
    ...items.map(i => ['פריט', i.id, i.segmentId || '', '', '', '', '', '',
      i.type, i.title, i.date, i.time || '', i.endDate || '', i.place || '', i.ref || '',
      catName(i.categoryId), i.plannedAmount ?? '', i.actualAmount ?? '', i.currency || '',
      i.payStatus || '', i.method || '', i.rateToILS ?? '', i.rateDate || '', i.rateSource || '']),
  ];
  XLSX.utils.book_append_sheet(wb, sheetFromRows(itinHeaders, itinRows), 'מסלול');

  const budgetHeaders = ['קטגוריה', 'מתוכנן'];
  const budgetRows = budgets.map(b => [catName(b.categoryId), b.plannedAmount]);
  XLSX.utils.book_append_sheet(wb, sheetFromRows(budgetHeaders, budgetRows), 'תקציב');

  const expHeaders = ['id', 'סכום', 'מטבע', 'תאריך', 'קטגוריה', 'אמצעי תשלום', 'הערה', 'שער', 'תאריך שער', 'מקור שער'];
  const expRows = expenses.map(e => [
    e.id, e.amount, e.currency, e.date, catName(e.categoryId), e.method || '', e.note || '',
    e.rateToILS ?? '', e.rateDate || '', e.rateSource || '',
  ]);
  XLSX.utils.book_append_sheet(wb, sheetFromRows(expHeaders, expRows), 'הוצאות');

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
    'מסלול': ['שורה', 'id', 'סוג', 'כותרת', 'תאריך'],
    'תקציב': ['קטגוריה', 'מתוכנן'],
    'הוצאות': ['id', 'סכום', 'מטבע', 'תאריך'],
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
      if (!row['עיר'] || !row['תאריך התחלה']) {
        errors.push(`שורה ${rowNum} בגיליון "מסלול" — למקטע חסרה עיר או תאריך התחלה`);
        return;
      }
      segments.push({
        id: row['id'] || undefined, city: String(row['עיר']), country: String(row['מדינה'] || ''),
        startDate: String(row['תאריך התחלה']), endDate: String(row['תאריך סיום'] || row['תאריך התחלה']),
        currency: String(row['מטבע מקטע'] || 'ILS').toUpperCase(),
      });
    } else if (row['שורה'] === 'פריט') {
      if (!row['כותרת'] || !row['תאריך']) {
        errors.push(`שורה ${rowNum} בגיליון "מסלול" — לפריט חסרה כותרת או תאריך`);
        return;
      }
      items.push({
        id: row['id'] || undefined, segmentId: row['segmentId'] || null,
        type: row['סוג'] || 'other', title: String(row['כותרת']), date: String(row['תאריך']),
        time: row['שעה'] || undefined, endDate: row['תאריך סיום פריט'] || undefined,
        place: row['מיקום'] || undefined, ref: row['הזמנה'] || undefined,
        categoryName: row['קטגוריה'] || '', plannedAmount: num(row['מתוכנן']), actualAmount: num(row['בפועל']),
        currency: row['מטבע פריט'] ? String(row['מטבע פריט']).toUpperCase() : undefined,
        payStatus: row['סטטוס תשלום'] || undefined, method: row['אמצעי תשלום'] || undefined,
        rateToILS: num(row['שער']), rateDate: row['תאריך שער'] || undefined, rateSource: row['מקור שער'] || undefined,
      });
    } else {
      errors.push(`שורה ${rowNum} בגיליון "מסלול" — ערך לא מוכר בעמודת "שורה": "${row['שורה']}"`);
    }
  });

  const budgets = [];
  sheetRows('תקציב').forEach((row, idx) => {
    const rowNum = idx + 2;
    if (row['מתוכנן'] === '' || row['מתוכנן'] === undefined) {
      errors.push(`שורה ${rowNum} בגיליון "תקציב" — חסר סכום מתוכנן`);
      return;
    }
    budgets.push({ categoryName: row['קטגוריה'] || '', plannedAmount: Number(row['מתוכנן']) });
  });

  const expenses = [];
  sheetRows('הוצאות').forEach((row, idx) => {
    const rowNum = idx + 2;
    if (row['סכום'] === '' || row['סכום'] === undefined || !row['תאריך']) {
      errors.push(`שורה ${rowNum} בגיליון "הוצאות" — חסר סכום או תאריך`);
      return;
    }
    const n = Number(row['סכום']);
    if (!Number.isFinite(n) || n < 0) {
      errors.push(`שורה ${rowNum} בגיליון "הוצאות" — הסכום אינו מספר תקין`);
      return;
    }
    expenses.push({
      id: row['id'] || undefined, amount: n, currency: String(row['מטבע'] || 'ILS').toUpperCase(),
      date: String(row['תאריך']), categoryName: row['קטגוריה'] || '', method: row['אמצעי תשלום'] || undefined,
      note: row['הערה'] || undefined, rateToILS: num(row['שער']),
      rateDate: row['תאריך שער'] || undefined, rateSource: row['מקור שער'] || undefined,
    });
  });

  if (errors.length) return { ok: false, errors, preview: null };

  return {
    ok: true,
    errors: [],
    preview: { segments: segments.length, items: items.length, budgets: budgets.length, expenses: expenses.length },
    data: { segments, items, budgets, expenses },
  };
}

/** מיישם תצוגה מקדימה שאושרה: מחליף מקטעים/פריטים/תקציב/הוצאות של הטיול הזה בלבד. */
export async function apply(tripId, parsed) {
  if (!parsed?.ok) throw new Error('אין נתונים תקינים ליישום');
  const { segments, items, budgets, expenses } = parsed.data;
  const cats = await trips.categories(tripId);
  const catId = name => cats.find(c => c.name === name)?.id || undefined;

  await db.removeWhere(db.STORES.segments, tripId);
  await db.removeWhere(db.STORES.items, tripId);
  await db.removeWhere(db.STORES.budgets, tripId);
  await db.removeWhere(db.STORES.expenses, tripId);

  if (segments.length) await db.bulkPut(db.STORES.segments, segments.map(s => ({ ...s, tripId })));
  if (items.length) await db.bulkPut(db.STORES.items, items.map(({ categoryName, ...i }) => ({
    ...i, tripId, categoryId: catId(categoryName),
  })));
  if (budgets.length) await db.bulkPut(db.STORES.budgets, budgets.map(b => ({
    tripId, categoryId: catId(b.categoryName), plannedAmount: b.plannedAmount,
  })).filter(b => b.categoryId));
  if (expenses.length) await db.bulkPut(db.STORES.expenses, expenses.map(({ categoryName, ...e }) => ({
    ...e, tripId, categoryId: catId(categoryName),
  })));

  return { counts: { segments: segments.length, items: items.length, budgets: budgets.length, expenses: expenses.length } };
}
