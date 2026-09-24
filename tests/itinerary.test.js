import { suite, assertEqual, assertTrue, assertThrows } from './harness.js';
import * as db from '../js/db.js';
import * as trips from '../js/trips.js';
import * as it from '../js/itinerary.js';

async function freshTrip() {
  await db.wipe();
  return trips.createTrip({ name: 'מסלול', startDate: '2026-09-25', endDate: '2026-10-25', currency: 'EUR' });
}

export default async function () {
  const s = suite('מסלול — מקטעים ופריטים');
  await db.useTestDatabase();

  s.test('8 סוגי פריט, כל אחד עם אייקון קיים', async () => {
    const { ICONS } = await import('../js/icons.js');
    assertEqual(it.ITEM_TYPES.length, 8);
    assertEqual(it.ITEM_TYPES.filter(t => !ICONS[t.icon]).map(t => t.key), []);
  });

  s.test('saveSegment שומר ו-listSegments ממוין לפי תאריך', async () => {
    const t = await freshTrip();
    await it.saveSegment(t.id, { city: 'קיוטו', country: 'יפן', startDate: '2026-10-06', endDate: '2026-10-09', currency: 'JPY' });
    await it.saveSegment(t.id, { city: 'טוקיו', country: 'יפן', startDate: '2026-10-01', endDate: '2026-10-05', currency: 'JPY' });
    assertEqual((await it.listSegments(t.id)).map(x => x.city), ['טוקיו', 'קיוטו', 'כללי']);
  });

  s.test('מקטע שתאריך הסיום שלו לפני ההתחלה נדחה בעברית', async () => {
    const t = await freshTrip();
    await assertThrows(
      () => it.saveSegment(t.id, { city: 'הפוך', startDate: '2026-10-09', endDate: '2026-10-01', currency: 'EUR' }),
      'מקטע הפוך נשמר'
    );
  });

  s.test('segmentDays כולל את שני הקצוות, ו-nights הוא יום אחד פחות', async () => {
    const days = it.segmentDays({ startDate: '2026-10-01', endDate: '2026-10-04' });
    assertEqual(days, ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    assertEqual(days.length, 4);
  });

  s.test('segmentForDate מחזיר את המקטע הנכון ו-null מחוץ לטווח', () => {
    const segs = [
      { id: 'a', startDate: '2026-10-01', endDate: '2026-10-06' },
      { id: 'b', startDate: '2026-10-07', endDate: '2026-10-09' },
      { id: 'g', kind: 'general', startDate: null, endDate: null },
    ];
    assertEqual(it.segmentForDate(segs, '2026-10-08')?.id, 'b');
    assertEqual(it.segmentForDate(segs, '2026-10-01')?.id, 'a');
    assertEqual(it.segmentForDate(segs, '2026-11-01'), null);
  });

  s.test('removeSegment מעביר פריטים ל"כללי" ואינו מוחק אותם', async () => {
    const t = await freshTrip();
    const seg = await it.saveSegment(t.id, { city: 'פורטו', startDate: '2026-10-01', endDate: '2026-10-03', currency: 'EUR' });
    await it.saveItem(t.id, { segmentId: seg.id, type: 'other', title: 'משהו', date: '2026-10-02' });
    await it.removeSegment(t.id, seg.id);
    const items = await it.listItems(t.id);
    const gen = await it.generalSegment(t.id);
    assertEqual((await it.listSegments(t.id)).map(x => x.city), ['כללי']);
    assertEqual([items.length, items[0].segmentId], [1, gen.id]);
  });

  s.test('itemsByDate ממיין לפי שעה ודוחף פריט בלי שעה לסוף', () => {
    const map = it.itemsByDate([
      { id: '1', date: '2026-10-01', time: '18:00', title: 'ערב' },
      { id: '2', date: '2026-10-01', title: 'בלי שעה' },
      { id: '3', date: '2026-10-01', time: '09:30', title: 'בוקר' },
      { id: '4', date: '2026-10-02', time: '12:00', title: 'למחרת' },
    ]);
    assertEqual(map.get('2026-10-01').map(i => i.title), ['בוקר', 'ערב', 'בלי שעה']);
    assertEqual(map.get('2026-10-02').map(i => i.title), ['למחרת']);
  });

  s.test('saveItem שומר סכום מתוכנן בלבד ומשליך סכום בפועל', async () => {
    const t = await freshTrip();
    const saved = await it.saveItem(t.id, {
      type: 'lodging', title: 'מלון', date: '2026-10-01', plannedAmount: 400, actualAmount: 380,
    });
    assertEqual([saved.plannedAmount, saved.actualAmount], [400, undefined]);
  });

  s.test('פריט בלי כותרת נדחה, ופריט בלי תאריך נדחה', async () => {
    const t = await freshTrip();
    await assertThrows(() => it.saveItem(t.id, { type: 'other', title: '  ', date: '2026-10-01' }), 'כותרת ריקה עברה');
    await assertThrows(() => it.saveItem(t.id, { type: 'other', title: 'יש', date: '' }), 'תאריך ריק עבר');
  });

  s.test('פריט עם סוג לא מוכר נדחה', async () => {
    const t = await freshTrip();
    await assertThrows(() => it.saveItem(t.id, { type: 'spaceship', title: 'חללית', date: '2026-10-01' }), 'סוג לא מוכר עבר');
  });

  s.test('כותרת ארוכה מאוד נשמרת במלואה ולא נחתכת בשכבת הנתונים', async () => {
    const t = await freshTrip();
    const long = 'מסעדה '.repeat(40).trim();
    const saved = await it.saveItem(t.id, { type: 'restaurant', title: long, date: '2026-10-01' });
    assertEqual((await db.get(db.STORES.items, saved.id)).title, long);
  });

  s.test('פריטים של שני טיולים אינם מתערבבים', async () => {
    await db.wipe();
    const a = await trips.createTrip({ name: 'א' });
    const b = await trips.createTrip({ name: 'ב' });
    await it.saveItem(a.id, { type: 'flight', title: 'טיסה א', date: '2026-10-01' });
    await it.saveItem(b.id, { type: 'flight', title: 'טיסה ב', date: '2026-10-01' });
    assertEqual((await it.listItems(a.id)).map(i => i.title), ['טיסה א']);
    assertEqual((await it.listItems(b.id)).map(i => i.title), ['טיסה ב']);
  });

  // ---- קדימות תאריכים לייעד חדש וחריגה מטווח הטיול ----

  s.test('defaultRange מתחיל ביום שאחרי היעד האחרון ונגמר בסוף הטיול', async () => {
    const t = await freshTrip();
    assertEqual(it.defaultRange(t, []), { startDate: '2026-09-25', endDate: '2026-10-25' });
    await it.saveSegment(t.id, { city: 'טוקיו', startDate: '2026-09-25', endDate: '2026-09-30' });
    const segs = await it.listSegments(t.id);
    assertEqual(it.defaultRange(t, segs), { startDate: '2026-10-01', endDate: '2026-10-25' });
  });

  s.test('defaultRange מחזיר ריק כשאין לטיול תאריכים או כשאין יום פנוי', async () => {
    await db.wipe();
    const bare = await trips.createTrip({ name: 'בלי תאריכים' });
    assertEqual(it.defaultRange(bare, []), { startDate: '', endDate: '' });
    const t = await trips.createTrip({ name: 'מלא', startDate: '2026-09-25', endDate: '2026-09-27' });
    const full = [{ kind: 'place', startDate: '2026-09-25', endDate: '2026-09-27' }];
    assertEqual(it.defaultRange(t, full), { startDate: '', endDate: '' });
  });

  s.test('defaultRange מדלג על מקטע "כללי" שאין לו תאריכים', async () => {
    const t = await freshTrip();
    await it.saveSegment(t.id, { city: 'טוקיו', startDate: '2026-10-02', endDate: '2026-10-04' });
    assertEqual(it.defaultRange(t, await it.listSegments(t.id)).startDate, '2026-10-05');
  });

  s.test('rangeOverflow מזהה חריגה בכל אחד משני הקצוות', async () => {
    const trip = { startDate: '2026-09-25', endDate: '2026-10-25' };
    assertEqual(it.rangeOverflow(trip, '2026-10-01', '2026-10-05'), null);
    assertEqual(it.rangeOverflow(trip, '2026-10-20', '2026-11-02'), { startDate: null, endDate: '2026-11-02' });
    assertEqual(it.rangeOverflow(trip, '2026-09-20', '2026-09-28'), { startDate: '2026-09-20', endDate: null });
    assertEqual(it.rangeOverflow(trip, '2026-09-20', '2026-11-02'), { startDate: '2026-09-20', endDate: '2026-11-02' });
  });

  s.test('rangeOverflow על יום בודד משתמש בתאריך ההתחלה כסוף', () => {
    const trip = { startDate: '2026-09-25', endDate: '2026-10-25' };
    assertEqual(it.rangeOverflow(trip, '2026-10-30', ''), { startDate: null, endDate: '2026-10-30' });
  });

  s.test('טיול בלי תאריכים לעולם אינו זקוק להארכה', () => {
    assertEqual(it.rangeOverflow({ startDate: null, endDate: null }, '2026-10-01', '2026-10-05'), null);
  });

  await s.done();
}
