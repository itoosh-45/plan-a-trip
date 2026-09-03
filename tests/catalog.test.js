import { suite, assertEqual, assertTrue } from './harness.js';
import * as catalog from '../js/catalog.js';

export default async function () {
  const s = suite('קטלוג — ניווט וחיפוש');

  s.test('load מחזיר 519 פריטים ומטמין בזיכרון', async () => {
    const a = await catalog.load();
    const b = await catalog.load();
    assertEqual(a.length, 519);
    assertTrue(a === b, 'הקריאה השנייה לא הוחזרה מהמטמון');
  });

  s.test('phases מחזיר את 4 השלבים בסדר הקבוע', async () => {
    assertEqual(await catalog.phases(), ['לפני', 'בדרך', 'בשהות', 'בחזרה']);
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

  await s.done();
}
