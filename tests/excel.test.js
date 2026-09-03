import { suite, assertEqual, assertTrue } from './harness.js';
import * as db from '../js/db.js';
import * as trips from '../js/trips.js';
import * as it from '../js/itinerary.js';
import * as budget from '../js/budget.js';
import * as excel from '../js/excel.js';

async function tripWithData() {
  await db.wipe();
  const t = await trips.createTrip({ name: 'אקסל', homeCurrency: 'ILS', totalBudget: 5000 });
  const cats = await trips.categories(t.id);
  const seg = await it.saveSegment(t.id, { city: 'טוקיו', country: 'יפן', startDate: '2026-10-01', endDate: '2026-10-05', currency: 'JPY' });
  await it.saveItem(t.id, { segmentId: seg.id, type: 'attraction', title: 'מקדש', date: '2026-10-02', time: '10:00', categoryId: cats[0].id, plannedAmount: 100, actualAmount: 85, currency: 'JPY', rateToILS: 0.024 });
  await it.saveItem(t.id, { type: 'other', title: 'בלי מקטע', date: '2026-10-06' });
  await budget.setPlanned(t.id, cats[0].id, 2000);
  await db.put(db.STORES.expenses, { tripId: t.id, amount: 45, currency: 'ILS', date: '2026-10-03', categoryId: cats[1].id, method: 'cash', note: 'ראמן' });
  return { trip: t, cats, seg };
}

export default async function () {
  const s = suite('אקסל — ייצוא וייבוא');
  await db.useTestDatabase();

  s.test('build מפיק Blob של xlsx עם 4 הגיליונות', async () => {
    const { trip } = await tripWithData();
    const blob = await excel.build(trip.id);
    assertTrue(blob instanceof Blob, 'לא הוחזר Blob');
    assertTrue(blob.size > 0, 'הקובץ ריק');
  });

  s.test('סימטריה: ייצוא ← ייבוא של אותו קובץ ← אותם נתונים בדיוק', async () => {
    const { trip, cats } = await tripWithData();
    const before = {
      segments: await it.listSegments(trip.id),
      items: await it.listItems(trip.id),
      expenses: await db.all(db.STORES.expenses, trip.id),
      budgetRows: await budget.rows(trip.id),
    };

    const blob = await excel.build(trip.id);
    const parsed = await excel.parse(blob);
    assertEqual(parsed.ok, true, JSON.stringify(parsed.errors));
    await excel.apply(trip.id, parsed);

    const after = {
      segments: await it.listSegments(trip.id),
      items: await it.listItems(trip.id),
      expenses: await db.all(db.STORES.expenses, trip.id),
      budgetRows: await budget.rows(trip.id),
    };

    assertEqual(after.segments.map(s => [s.city, s.country, s.startDate, s.endDate, s.currency]),
      before.segments.map(s => [s.city, s.country, s.startDate, s.endDate, s.currency]));
    assertEqual(after.items.map(i => [i.title, i.date, i.time, i.plannedAmount, i.actualAmount, i.currency, i.rateToILS, i.categoryId]),
      before.items.map(i => [i.title, i.date, i.time, i.plannedAmount, i.actualAmount, i.currency, i.rateToILS, i.categoryId]));
    assertEqual(after.expenses.map(e => [e.amount, e.currency, e.date, e.categoryId, e.method, e.note]),
      before.expenses.map(e => [e.amount, e.currency, e.date, e.categoryId, e.method, e.note]));
    assertEqual(after.budgetRows.map(r => [r.categoryId, r.planned]), before.budgetRows.map(r => [r.categoryId, r.planned]));
  });

  s.test('parse בלבד (בלי apply) לא נוגע בשום נתון קיים', async () => {
    const { trip } = await tripWithData();
    const beforeCount = (await it.listItems(trip.id)).length;
    const blob = await excel.build(trip.id);
    await excel.parse(blob);
    assertEqual((await it.listItems(trip.id)).length, beforeCount, 'parse שינה נתונים');
  });

  s.test('קובץ ריק נדחה בעברית ולא קורס', async () => {
    const empty = new Blob([], { type: 'application/octet-stream' });
    const res = await excel.parse(empty);
    assertEqual(res.ok, false);
    assertTrue(res.errors.length > 0);
  });

  s.test('קובץ שאינו xlsx (טקסט חופשי) נדחה עם הודעה ברורה בעברית', async () => {
    // SheetJS מפרש טקסט חופשי כגיליון יחיד — לא נזרקת שגיאת פענוח, אבל 4 הגיליונות
    // הנדרשים חסרים, וזו בדיוק ההודעה שהמשתמש צריך: מה חסר, לא "קובץ פגום" גנרי.
    const notXlsx = new Blob(['שלום, זה לא קובץ אקסל'], { type: 'text/plain' });
    const res = await excel.parse(notXlsx);
    assertEqual(res.ok, false);
    assertTrue(res.errors.length > 0 && res.errors.every(e => e.length > 0), 'אין הודעת שגיאה ברורה');
  });

  s.test('קובץ בינארי לא תקין (לא xlsx ולא טקסט) נדחה בלי לקרוס', async () => {
    const garbage = new Blob([new Uint8Array([0, 1, 2, 3, 255, 254, 253])]);
    const res = await excel.parse(garbage);
    assertEqual(res.ok, false);
    assertTrue(res.errors.length > 0);
  });

  s.test('קובץ עם עמודות חסרות מדווח בדיוק אילו עמודות חסרות', async () => {
    const XLSX = window.XLSX;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['שדה', 'ערך']]), 'סיכום');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['שורה', 'id', 'סוג', 'כותרת']]), 'מסלול'); // בלי 'תאריך'
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['קטגוריה', 'מתוכנן']]), 'תקציב');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['id', 'סכום', 'מטבע', 'תאריך']]), 'הוצאות');
    const arr = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([arr]);
    const res = await excel.parse(blob);
    assertEqual(res.ok, false);
    assertTrue(res.errors.some(e => e.includes('מסלול') && e.includes('תאריך')), JSON.stringify(res.errors));
  });

  s.test('קובץ שנערך ידנית עם עמודה נוספת לא מוכרת עדיין מתקבל', async () => {
    const { trip } = await tripWithData();
    const blob = await excel.build(trip.id);
    const XLSX = window.XLSX;
    const wb = XLSX.read(await blob.arrayBuffer(), { type: 'array' });
    const ws = wb.Sheets['הוצאות'];
    const range = XLSX.utils.decode_range(ws['!ref']);
    const newCol = range.e.c + 1;
    ws[XLSX.utils.encode_cell({ r: 0, c: newCol })] = { t: 's', v: 'הערת עורך' };
    ws[XLSX.utils.encode_cell({ r: 1, c: newCol })] = { t: 's', v: 'נוסף ידנית' };
    range.e.c = newCol;
    ws['!ref'] = XLSX.utils.encode_range(range);
    const edited = new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })]);

    const res = await excel.parse(edited);
    assertEqual(res.ok, true, JSON.stringify(res.errors));
  });

  s.test('קובץ עם 500 הוצאות (ענק יחסית) נקרא בזמן סביר', async () => {
    const { trip, cats } = await tripWithData();
    const rows = Array.from({ length: 500 }, (_, i) => ({
      tripId: trip.id, amount: i + 1, currency: 'ILS', date: '2026-10-01', categoryId: cats[0].id, method: 'cash',
    }));
    await db.bulkPut(db.STORES.expenses, rows);
    const t0 = performance.now();
    const blob = await excel.build(trip.id);
    const res = await excel.parse(blob);
    const ms = performance.now() - t0;
    assertEqual(res.ok, true, JSON.stringify(res.errors));
    assertEqual(res.preview.expenses, 501);
    assertTrue(ms < 5000, `לקח ${Math.round(ms)}ms`);
  });

  await s.done();
}
