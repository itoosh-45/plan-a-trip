import { suite, assertEqual } from './harness.js';

export default async function () {
  const s = suite('קטלוג ההכנה');
  const cat = await (await fetch('./data/prep-catalog.json')).json();

  s.test('הקטלוג מכיל 613 פריטים', () => {
    assertEqual(cat.length, 613);
  });

  s.test('לכל פריט יש id בפורמט pNNNN', () => {
    const bad = cat.filter(x => !/^p\d{4}$/.test(x.id || ''));
    assertEqual(bad.length, 0, `פריטים בלי id תקין: ${bad.length}`);
  });

  s.test('כל המזהים ייחודיים', () => {
    assertEqual(new Set(cat.map(x => x.id)).size, 613);
  });

  s.test('לכל פריט יש phase, section, topic, priority, text', () => {
    const bad = cat.filter(x => !x.phase || !x.section || !x.topic || !x.priority || !x.text);
    assertEqual(bad.length, 0);
  });

  s.test('התפלגות השלבים תואמת לאפיון', () => {
    const count = p => cat.filter(x => x.phase === p).length;
    assertEqual(
      { before: count('לפני'), onWay: count('בדרך'), during: count('בשהות'), back: count('בחזרה') },
      { before: 368, onWay: 45, during: 157, back: 43 }
    );
  });

  s.test('העדיפויות הן מתוך שלושת הערכים המותרים בלבד', () => {
    const allowed = new Set(['חובה', 'רלוונטי', 'נוחות']);
    assertEqual([...new Set(cat.map(x => x.priority))].filter(p => !allowed.has(p)), []);
  });

  s.test('10 מדורים ו-55 נושאים, כולל ציוד לטרקים וציוד סקי', () => {
    assertEqual(new Set(cat.map(x => x.section)).size, 10);
    assertEqual(new Set(cat.map(x => x.topic)).size, 55);
    const sections = new Set(cat.map(x => x.section));
    assertEqual(sections.has('ציוד לטרקים'), true);
    assertEqual(sections.has('ציוד סקי'), true);
  });

  await s.done();
}
