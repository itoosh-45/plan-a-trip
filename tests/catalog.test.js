import { suite, assertEqual, assertTrue } from './harness.js';
import * as catalog from '../js/catalog.js';
import * as db from '../js/db.js';

export default async function () {
  const s = suite('קטלוג — ניווט וחיפוש');
  await db.useTestDatabase();

  s.test('load מחזיר 613 פריטים ומטמין בזיכרון', async () => {
    const a = await catalog.load();
    const b = await catalog.load();
    assertEqual(a.length, 613);
    assertTrue(a === b, 'הקריאה השנייה לא הוחזרה מהמטמון');
  });

  s.test('phases מחזיר את 5 השלבים בסדר הקבוע', async () => {
    assertEqual(await catalog.phases(), ['לפני', 'בדרך', 'בשהות', 'בחזרה', 'ציוד מיוחד']);
  });

  s.test('sections מחזיר מדורים ייחודיים לשלב נתון', async () => {
    const secs = await catalog.sections('לפני');
    assertEqual(secs.length, new Set(secs).size, 'יש כפילות במדורים');
    assertTrue(secs.length > 0);
  });

  s.test('topics מחזיר נושאים ייחודיים בתוך שלב ומדור', async () => {
    const secs = await catalog.sections('לפני');
    const topics = await catalog.topics('לפני', secs[0]);
    assertTrue(topics.length > 0);
    assertEqual(topics.length, new Set(topics).size);
  });

  s.test('byTopic מחזיר רק פריטים מהשלב-מדור-נושא המבוקשים', async () => {
    const secs = await catalog.sections('לפני');
    const topics = await catalog.topics('לפני', secs[0]);
    const items = await catalog.byTopic('לפני', secs[0], topics[0]);
    assertTrue(items.length > 0);
    assertEqual(items.every(i => i.phase === 'לפני' && i.section === secs[0] && i.topic === topics[0]), true);
  });

  s.test('search מוצא לפי טקסט חלקי ומתעלם מרישיות', async () => {
    const results = await catalog.search('דרכון');
    assertTrue(results.length > 0, 'לא נמצאו תוצאות לחיפוש דרכון');
    assertTrue(results.every(r => r.text.includes('דרכון') || r.topic.includes('דרכון') || r.section.includes('דרכון') || (r.group || '').includes('דרכון')));
  });

  s.test('search על מחרוזת ריקה מחזיר ריק', async () => {
    assertEqual(await catalog.search(''), []);
    assertEqual(await catalog.search('   '), []);
  });

  // ---- הסתרה גלובלית מהקטלוג ----

  s.test('הסתרה מורידה פריט מכל מסלולי הניווט בקטלוג', async () => {
    await catalog.setHidden([]);
    const before = (await catalog.byTopic('ציוד מיוחד', 'ציוד סקי', 'הגנה')).map(x => x.text);
    assertTrue(before.includes('קסדה'), 'הקסדה חסרה מהקטלוג מלכתחילה');
    const helmet = (await catalog.load()).find(x => x.text === 'קסדה');
    await catalog.hide(helmet.id);
    const after = (await catalog.byTopic('ציוד מיוחד', 'ציוד סקי', 'הגנה')).map(x => x.text);
    assertTrue(!after.includes('קסדה'), 'הפריט המוסתר עדיין מוצג');
    const hits = (await catalog.search('קסדה')).map(x => x.text);
    assertTrue(!hits.includes('קסדה'), 'הפריט המוסתר עדיין נמצא בחיפוש');
    assertTrue(hits.includes('כובע מתחת לקסדה'), 'החיפוש הפסיק להחזיר פריטים שלא הוסתרו');
    await catalog.unhide(helmet.id);
    assertTrue((await catalog.byTopic('ציוד מיוחד', 'ציוד סקי', 'הגנה')).map(x => x.text).includes('קסדה'),
      'הפריט לא חזר לקטלוג');
  });

  s.test('byId מוצא גם פריט מוסתר, כדי שאפשר יהיה להציג אותו בהגדרות', async () => {
    const helmet = (await catalog.load()).find(x => x.text === 'קסדה');
    await catalog.hide(helmet.id);
    assertEqual((await catalog.byId()).get(helmet.id).text, 'קסדה');
    await catalog.setHidden([]);
  });

  s.test('שני מדורי הציוד חיים בשלב "ציוד מיוחד" ולא ב"לפני"', async () => {
    const sections = await catalog.sections('ציוד מיוחד');
    assertEqual(sections, ['ציוד לטרקים', 'ציוד סקי']);
    const beforeSections = await catalog.sections('לפני');
    assertTrue(!beforeSections.includes('ציוד לטרקים'), 'ציוד לטרקים נשאר בשלב לפני');
    assertTrue(!beforeSections.includes('ציוד סקי'), 'ציוד סקי נשאר בשלב לפני');
    const trek = (await catalog.load()).filter(x => x.section === 'ציוד לטרקים');
    const ski = (await catalog.load()).filter(x => x.section === 'ציוד סקי');
    assertEqual(trek.length, 76);
    assertEqual(ski.length, 18);
    assertTrue(ski.some(x => x.text === 'גרבי סקי תרמיים'), 'פריט סקי חסר');
    assertTrue(trek.some(x => x.text === 'שק שינה'), 'פריט טרקים חסר');
  });

  // ---- רשימת ההסתרה שהגיעה מבעל המוצר ----

  s.test('222 פריטים מוסתרים כברירת מחדל, בלי שאיש נגע בהגדרות', async () => {
    await db.remove(db.STORES.settings, 'catalogHidden');
    const hidden = await catalog.hiddenIds();
    assertEqual(hidden.size, 222);
    const all = await catalog.load();
    assertEqual((await catalog.visible()).length, all.length - 222);
    const known = new Set(all.map(x => x.id));
    assertEqual([...hidden].filter(id => !known.has(id)), [], 'מזהה מוסתר שאינו קיים בקטלוג');
  });

  s.test('החזרת פריט אחד שומרת את שאר ברירת המחדל ולא מוחקת אותה', async () => {
    await db.remove(db.STORES.settings, 'catalogHidden');
    const first = [...await catalog.hiddenIds()][0];
    await catalog.unhide(first);
    const after = await catalog.hiddenIds();
    assertEqual(after.size, 221, 'ההחזרה מחקה את כל רשימת ברירת המחדל');
    assertTrue(!after.has(first), 'הפריט שהוחזר עדיין מוסתר');
    await db.remove(db.STORES.settings, 'catalogHidden');
  });

  s.test('שני המדורים החדשים אינם מוסתרים', async () => {
    await db.remove(db.STORES.settings, 'catalogHidden');
    const visible = await catalog.visible();
    const trek = visible.filter(x => x.section === 'ציוד לטרקים').length;
    const ski = visible.filter(x => x.section === 'ציוד סקי').length;
    assertEqual([trek, ski], [76, 18]);
  });

  s.test('אף מדור לא נעלם לגמרי בגלל ההסתרה', async () => {
    await db.remove(db.STORES.settings, 'catalogHidden');
    const sections = new Set((await catalog.load()).map(x => x.section));
    const left = new Set((await catalog.visible()).map(x => x.section));
    assertEqual([...sections].filter(s2 => !left.has(s2)), []);
  });

  await s.done();
}
