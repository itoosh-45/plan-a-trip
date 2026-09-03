import { suite, assertEqual, assertTrue } from './harness.js';
import { ICONS } from '../js/icons.js';
import { icon, el, fmtDate, fmtDateRange, nightsBetween, datesBetween } from '../js/ui.js';

export default async function () {
  const s = suite('מערכת העיצוב ועוזרי הממשק');

  s.test('כל האייקונים הנדרשים קיימים', () => {
    const need = ['plan','budget','expenses','summary','settings','plus','close','check',
      'chevronDown','chevronLeft','edit','trash','flight','lodging','attraction','restaurant',
      'transfer','ride','meeting','other','cash','card','share','download','refresh','search','alert'];
    assertEqual(need.filter(n => !ICONS[n]), []);
  });

  s.test('אין אימוג׳י בשום אייקון', () => {
    const emoji = /\p{Extended_Pictographic}/u;
    assertEqual(Object.keys(ICONS).filter(k => emoji.test(ICONS[k])), []);
  });

  s.test('כל אייקון בנוי מ-path/circle/rect בלבד', () => {
    const bad = Object.entries(ICONS).filter(([, v]) => !/^<(path|circle|rect|line|polyline)\b/.test(v));
    assertEqual(bad.map(([k]) => k), []);
  });

  s.test('icon() מפיק svg עם currentColor ו-stroke-width 1.8', () => {
    const svg = icon('plan');
    assertTrue(svg.includes('stroke="currentColor"'), 'חסר currentColor');
    assertTrue(svg.includes('stroke-width="1.8"'), 'עובי קו שגוי');
    assertTrue(svg.includes('fill="none"'), 'חסר fill=none');
  });

  s.test('icon() בשם לא מוכר נופל ל-other ולא קורס', () => {
    assertTrue(icon('no-such-icon').includes('<svg'), 'לא הוחזר svg');
  });

  s.test('el() מגדיר class, text ומאזין לאירוע', () => {
    let clicked = 0;
    const node = el('button', { class: 'btn', text: 'שלח', onClick: () => clicked++ });
    node.dispatchEvent(new Event('click'));
    assertEqual([node.tagName, node.className, node.textContent, clicked], ['BUTTON', 'btn', 'שלח', 1]);
  });

  s.test('nightsBetween מחשב לילות נכון', () => {
    assertEqual(nightsBetween('2026-09-01', '2026-09-04'), 3);
    assertEqual(nightsBetween('2026-09-01', '2026-09-01'), 0);
    assertEqual(nightsBetween('2026-09-01', null), 0);
  });

  s.test('datesBetween כולל את שני הקצוות וחוצה חודש', () => {
    assertEqual(datesBetween('2026-08-30', '2026-09-02'),
      ['2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02']);
    assertEqual(datesBetween('2026-09-01', '2026-09-01'), ['2026-09-01']);
  });

  s.test('datesBetween חוצה שנה', () => {
    assertEqual(datesBetween('2026-12-30', '2027-01-02'),
      ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
  });

  s.test('fmtDate ו-fmtDateRange מחזירים טקסט ולא קורסים על ריק', () => {
    assertTrue(fmtDate('2026-09-03').length > 0);
    assertEqual(fmtDate(''), '');
    assertEqual(fmtDateRange('2026-09-03', '2026-09-03'), fmtDate('2026-09-03'));
    assertEqual(fmtDateRange('', ''), '');
  });

  s.test('tokens.css הוא המקור לצבעים — הערכים נטענו', () => {
    const v = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    assertEqual(v('--color-highlight'), '#EE4266');
    assertEqual(v('--color-accent'), '#06BCC1');
    assertEqual(v('--color-danger'), '#D92D20');
    assertEqual(v('--radius-card'), '16px');
  });

  await s.done();
}
