import { suite, assertEqual, assertTrue, assertThrows } from './harness.js';
import * as db from '../js/db.js';
import * as imported from '../js/imported.js';
import * as catalog from '../js/catalog.js';

const csv = (text, name = 'רשימה.csv') => new File([text], name, { type: 'text/csv' });

export default async function () {
  const s = suite('קטלוגים מיובאים');
  await db.useTestDatabase();

  async function fresh() {
    await db.remove(db.STORES.settings, 'importedCatalogs');
  }

  s.test('קורא csv עם עמודה אחת ונותן לכולם דחיפות ברירת מחדל', async () => {
    const res = await imported.parse(csv('שק שינה\nמקלות הליכה\n\nפנס ראש\n'));
    assertEqual(res.ok, true);
    assertEqual(res.items.map(i => i.text), ['שק שינה', 'מקלות הליכה', 'פנס ראש']);
    assertEqual([...new Set(res.items.map(i => i.priority))], ['נוחות']);
  });

  s.test('שורת כותרת עם המילה "פריט" נדלגת, ועמודת הדחיפות נקראת', async () => {
    const res = await imported.parse(csv('פריט,דחיפות\nקסדה,חובה\nכפפות,רלוונטי\n'));
    assertEqual(res.ok, true);
    assertEqual(res.items, [
      { text: 'קסדה', priority: 'חובה' },
      { text: 'כפפות', priority: 'רלוונטי' },
    ]);
  });

  s.test('דחיפות לא מוכרת נדחית עם מספר השורה', async () => {
    const res = await imported.parse(csv('קסדה,דחוף מאוד\n'));
    assertEqual(res.ok, false);
    assertTrue(res.errors[0].includes('שורה 1'), `הודעה בלי מספר שורה: ${res.errors[0]}`);
    assertEqual(res.items, []);
  });

  s.test('פריט ארוך מדי וקובץ ריק נדחים', async () => {
    const long = await imported.parse(csv(`${'א'.repeat(imported.MAX_TEXT + 1)}\n`));
    assertEqual(long.ok, false);
    assertEqual((await imported.parse(csv('\n\n'))).ok, false);
  });

  s.test('add שומר מזהים בפורמט imp- שאינם מתנגשים עם pNNNN', async () => {
    await fresh();
    const entry = await imported.add({ name: 'טרק בנפאל', items: [{ text: 'א' }, { text: 'ב' }] });
    assertTrue(entry.id.startsWith('imp-'), `מזהה לא תקין: ${entry.id}`);
    assertEqual(entry.items.map(i => i.id), [`${entry.id}-0001`, `${entry.id}-0002`]);
    assertEqual(entry.items.filter(i => /^p\d{4}$/.test(i.id)).length, 0);
  });

  s.test('שם ריק ושם כפול נדחים', async () => {
    await fresh();
    await imported.add({ name: 'טרק', items: [{ text: 'א' }] });
    await assertThrows(() => imported.add({ name: '  ', items: [{ text: 'א' }] }), 'שם ריק התקבל');
    await assertThrows(() => imported.add({ name: 'טרק', items: [{ text: 'ב' }] }), 'שם כפול התקבל');
  });

  s.test('בלי שיוך המדור הוא שם הרשימה, ועם שיוך הוא המדור שנבחר', async () => {
    await fresh();
    await imported.add({ name: 'טרק בנפאל', items: [{ text: 'שק שינה' }] });
    assertEqual((await imported.allItems())[0].section, 'טרק בנפאל');
    await fresh();
    await imported.add({
      name: 'טרק בנפאל', items: [{ text: 'שק שינה' }],
      phase: 'ציוד מיוחד', section: 'ציוד לטרקים',
    });
    const [item] = await imported.allItems();
    assertEqual([item.section, item.phase], ['ציוד לטרקים', 'ציוד מיוחד']);
  });

  s.test('byId של הקטלוג מוצא גם פריט מיובא, בלי לגעת בקטלוג המובנה', async () => {
    await fresh();
    const entry = await imported.add({ name: 'טרק בנפאל', items: [{ text: 'שק שינה' }] });
    const map = await catalog.byId();
    assertEqual(map.get(entry.items[0].id).text, 'שק שינה');
    assertEqual(map.get('p0001').phase, 'לפני');
    // הפריטים המיובאים אינם נכנסים לניווט של הקטלוג המובנה
    assertEqual((await catalog.load()).filter(x => x.id.startsWith('imp-')).length, 0);
    assertEqual((await catalog.search('שק שינה')).filter(x => x.id.startsWith('imp-')).length, 0);
  });

  s.test('remove מסיר את הרשימה ומחזיר את byId למצב המקורי', async () => {
    await fresh();
    const entry = await imported.add({ name: 'טרק בנפאל', items: [{ text: 'שק שינה' }] });
    await imported.remove(entry.id);
    assertEqual(await imported.list(), []);
    assertEqual((await catalog.byId()).has(entry.items[0].id), false);
    await fresh();
  });

  await s.done();
}
