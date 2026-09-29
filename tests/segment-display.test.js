import { suite, assertEqual } from './harness.js';
import { segmentGroups, displaySegmentTotals } from '../js/segment-display.js';

export default async function () {
  const s = suite('תצוגת יעדים בלי שינוי שיוכים');
  const general = { id: 'g', kind: 'general', city: 'כללי' };
  const a = { id: 'a', kind: 'place', city: 'בנגקוק' };
  const b = { id: 'b', kind: 'place', city: 'קו סמוי' };
  const totals = [
    { id: 'a', amount: 30, allocation: 100 },
    { id: 'b', amount: 40, allocation: 120 },
    { id: 'g', amount: 20, allocation: 10 },
  ];

  s.test('בלי יעד מקום: כללי נשאר ברמת הטיול', () => {
    assertEqual(segmentGroups([general]).map(g => g.segment.city), ['כללי']);
  });
  s.test('יעד אחד: כללי מוצג תחתיו והסכומים מצטרפים בלי שינוי מקור', () => {
    const groups = segmentGroups([a, general]);
    assertEqual(groups.map(g => [g.segment.id, g.ids]), [['a', ['a', 'g']]]);
    assertEqual(displaySegmentTotals(groups, totals)[0].amount, 50);
    assertEqual(displaySegmentTotals(groups, totals)[0].allocation, 110);
    assertEqual(totals[2], { id: 'g', amount: 20, allocation: 10 });
  });
  s.test('שני יעדים: כללי נפתח מחדש עם אותו ID ואותם סכומים', () => {
    const groups = segmentGroups([a, b, general]);
    assertEqual(groups.map(g => g.ids), [['a'], ['b'], ['g']]);
    assertEqual(displaySegmentTotals(groups, totals).map(g => g.amount), [30, 40, 20]);
  });
  s.test('מחיקת יעד מחזירה לתצוגת יעד יחיד; אפס יעדים מציג כללי', () => {
    assertEqual(segmentGroups([b, general])[0].ids, ['b', 'g']);
    assertEqual(segmentGroups([general])[0].ids, ['g']);
  });
  await s.done();
}
