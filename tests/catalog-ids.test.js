import { suite, assertEqual } from './harness.js';

export default async function () {
  const s = suite('קטלוג ההכנה');
  const cat = await (await fetch('./data/prep-catalog.json')).json();

  s.test('הקטלוג מכיל 519 פריטים', () => {
    assertEqual(cat.length, 519);
  });

  s.test('לכל פריט יש id בפורמט pNNNN', () => {
    const bad = cat.filter(x => !/^p\d{4}$/.test(x.id || ''));
    assertEqual(bad.length, 0, `פריטים בלי id תקין: ${bad.length}`);
  });

  s.test('כל המזהים ייחודיים', () => {
    assertEqual(new Set(cat.map(x => x.id)).size, 519);
  });

  s.test('לכל פריט יש phase, section, topic, priority, text', () => {
    const bad = cat.filter(x => !x.phase || !x.section || !x.topic || !x.priority || !x.text);
    assertEqual(bad.length, 0);
  });

  s.test('התפלגות השלבים תואמת לאפיון', () => {
    const count = p => cat.filter(x => x.phase === p).length;
    assertEqual(
      { before: count('לפני'), onWay: count('בדרך'), during: count('בשהות'), back: count('בחזרה') },
      { before: 274, onWay: 45, during: 157, back: 43 }
    );
  });

  s.test('העדיפויות הן מתוך שלושת הערכים המותרים בלבד', () => {
    const allowed = new Set(['חובה', 'רלוונטי', 'נוחות']);
    assertEqual([...new Set(cat.map(x => x.priority))].filter(p => !allowed.has(p)), []);
  });

  s.test('8 מדורים ו-37 נושאים', () => {
    assertEqual(new Set(cat.map(x => x.section)).size, 8);
    assertEqual(new Set(cat.map(x => x.topic)).size, 37);
  });

  await s.done();
}
