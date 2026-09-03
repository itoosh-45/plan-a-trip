import { suite, assertEqual, assertTrue, assertThrows } from './harness.js';
import * as db from '../js/db.js';
import * as trips from '../js/trips.js';
import * as it from '../js/itinerary.js';

async function freshTrip() {
  await db.wipe();
  return trips.createTrip({ name: 'מסלול', homeCurrency: 'ILS' });
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
    await it.saveSegment(t.id, { city: 'טוקיו', country: 'יפן', startDate: '2026-10-01', endDate: '2026-10-06', currency: 'JPY' });
    assertEqual((await it.listSegments(t.id)).map(x => x.city), ['טוקיו', 'קיוטו']);
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

  s.test('overlappingSegments מזהה יום מעבר משותף', async () => {
    const segs = [
      { id: 'a', startDate: '2026-10-01', endDate: '2026-10-06' },
      { id: 'b', startDate: '2026-10-06', endDate: '2026-10-09' },
      { id: 'c', startDate: '2026-10-20', endDate: '2026-10-22' },
    ];
    assertEqual([...it.overlappingSegments(segs)].sort(), ['a', 'b']);
  });

  s.test('overlappingSegments על מקטע בודד מחזיר ריק', () => {
    assertEqual([...it.overlappingSegments([{ id: 'a', startDate: '2026-10-01', endDate: '2026-10-06' }])], []);
  });

  s.test('segmentForDate מחזיר את המקטע הנכון ו-null מחוץ לטווח', () => {
    const segs = [
      { id: 'a', startDate: '2026-10-01', endDate: '2026-10-06' },
      { id: 'b', startDate: '2026-10-07', endDate: '2026-10-09' },
    ];
    assertEqual(it.segmentForDate(segs, '2026-10-08')?.id, 'b');
    assertEqual(it.segmentForDate(segs, '2026-10-01')?.id, 'a');
    assertEqual(it.segmentForDate(segs, '2026-11-01'), null);
  });

  s.test('moveSegment מזיז את המקטע ואת כל הפריטים שבתוכו', async () => {
    const t = await freshTrip();
    const seg = await it.saveSegment(t.id, { city: 'ליסבון', startDate: '2026-10-01', endDate: '2026-10-05', currency: 'EUR' });
    await it.saveItem(t.id, { segmentId: seg.id, type: 'attraction', title: 'מצפה', date: '2026-10-02', time: '10:00' });
    await it.saveItem(t.id, { segmentId: seg.id, type: 'restaurant', title: 'ארוחה', date: '2026-10-05' });

    await it.moveSegment(t.id, seg.id, '2026-10-11');

    const moved = (await it.listSegments(t.id))[0];
    assertEqual([moved.startDate, moved.endDate], ['2026-10-11', '2026-10-15']);
    assertEqual((await it.listItems(t.id)).map(i => i.date).sort(), ['2026-10-12', '2026-10-15']);
  });

  s.test('moveSegment אחורה עובד גם מעבר לגבול חודש', async () => {
    const t = await freshTrip();
    const seg = await it.saveSegment(t.id, { city: 'אתונה', startDate: '2026-10-02', endDate: '2026-10-04', currency: 'EUR' });
    await it.saveItem(t.id, { segmentId: seg.id, type: 'flight', title: 'טיסה', date: '2026-10-02' });
    await it.moveSegment(t.id, seg.id, '2026-09-29');
    const moved = (await it.listSegments(t.id))[0];
    assertEqual([moved.startDate, moved.endDate], ['2026-09-29', '2026-10-01']);
    assertEqual((await it.listItems(t.id))[0].date, '2026-09-29');
  });

  s.test('removeSegment מנתק פריטים ואינו מוחק אותם', async () => {
    const t = await freshTrip();
    const seg = await it.saveSegment(t.id, { city: 'פורטו', startDate: '2026-10-01', endDate: '2026-10-03', currency: 'EUR' });
    await it.saveItem(t.id, { segmentId: seg.id, type: 'other', title: 'משהו', date: '2026-10-02' });
    await it.removeSegment(t.id, seg.id);
    const items = await it.listItems(t.id);
    assertEqual((await it.listSegments(t.id)).length, 0);
    assertEqual([items.length, items[0].segmentId], [1, null]);
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

  s.test('effectiveAmount — בפועל דורס מתוכנן, ומתוכנן נשמר', () => {
    assertEqual(it.effectiveAmount({ plannedAmount: 100, actualAmount: 85 }), 85);
    assertEqual(it.effectiveAmount({ plannedAmount: 100 }), 100);
    assertEqual(it.effectiveAmount({ plannedAmount: 100, actualAmount: 0 }), 0, 'אפס בפועל חייב לדרוס');
    assertEqual(it.effectiveAmount({}), 0);
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
    const a = await trips.createTrip({ name: 'א', homeCurrency: 'ILS' });
    const b = await trips.createTrip({ name: 'ב', homeCurrency: 'ILS' });
    await it.saveItem(a.id, { type: 'flight', title: 'טיסה א', date: '2026-10-01' });
    await it.saveItem(b.id, { type: 'flight', title: 'טיסה ב', date: '2026-10-01' });
    assertEqual((await it.listItems(a.id)).map(i => i.title), ['טיסה א']);
    assertEqual((await it.listItems(b.id)).map(i => i.title), ['טיסה ב']);
  });

  await s.done();
}
