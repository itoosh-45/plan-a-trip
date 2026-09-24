import { suite, assertEqual, assertTrue } from './harness.js';
import {
  addDays, monthOf, shiftMonth, monthGrid, pickInRange, rangeHas, rangeStatus, dateRangeField,
} from '../js/daterange.js';

export default async function () {
  const s = suite('בורר טווח התאריכים');

  s.test('monthGrid פותח ביום א׳ ומכסה את החודש כולו', () => {
    const weeks = monthGrid('2026-09-14');
    const flat = weeks.flat();
    assertEqual(new Date(`${flat[0]}T00:00:00Z`).getUTCDay(), 0, 'הלוח אינו נפתח ביום א׳');
    assertTrue(flat.includes('2026-09-01') && flat.includes('2026-09-30'), 'חסר יום מהחודש');
    assertEqual(weeks.every(w => w.length === 7), true);
  });

  s.test('monthGrid אינו מוסיף שורה שכולה מחוץ לחודש', () => {
    // פברואר 2027 מתחיל ביום ב׳ — 28 יום שנכנסים בדיוק בחמש שורות
    const weeks = monthGrid('2027-02-01');
    assertEqual(weeks.length, 5);
    assertEqual(weeks.every(w => w.some(d => d.startsWith('2027-02'))), true);
  });

  s.test('חודש חוצה שנה מתקדם ונסוג נכון', () => {
    assertEqual(shiftMonth('2026-12-01', 1), '2027-01-01');
    assertEqual(shiftMonth('2026-01-01', -1), '2025-12-01');
    assertEqual(monthOf('2026-03-17'), '2026-03-01');
    assertEqual(addDays('2026-02-28', 1), '2026-03-01');
  });

  s.test('לחיצה ראשונה קובעת התחלה, שנייה סוגרת את הטווח', () => {
    const first = pickInRange({ startDate: '', endDate: '' }, '2026-09-10');
    assertEqual(first, { startDate: '2026-09-10', endDate: '' });
    assertEqual(pickInRange(first, '2026-09-18'), { startDate: '2026-09-10', endDate: '2026-09-18' });
  });

  s.test('לחיצה שנייה מוקדמת מהראשונה הופכת להתחלה ולא נזרקת', () => {
    assertEqual(
      pickInRange({ startDate: '2026-09-10', endDate: '' }, '2026-09-04'),
      { startDate: '2026-09-04', endDate: '2026-09-10' },
    );
  });

  s.test('לחיצה כפולה על אותו יום היא טווח של יום אחד', () => {
    assertEqual(
      pickInRange({ startDate: '2026-09-10', endDate: '' }, '2026-09-10'),
      { startDate: '2026-09-10', endDate: '2026-09-10' },
    );
  });

  s.test('לחיצה על טווח שלם פותחת טווח חדש', () => {
    assertEqual(
      pickInRange({ startDate: '2026-09-10', endDate: '2026-09-18' }, '2026-10-02'),
      { startDate: '2026-10-02', endDate: '' },
    );
  });

  s.test('rangeHas מכסה את כל הימים שבין הקצוות, כולל אותם', () => {
    const range = { startDate: '2026-09-10', endDate: '2026-09-12' };
    assertEqual(
      ['2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13'].map(d => rangeHas(d, range)),
      [false, true, true, true, false],
    );
    assertEqual(rangeHas('2026-09-10', { startDate: '2026-09-10', endDate: '' }), false,
      'טווח פתוח אינו צובע דבר');
  });

  s.test('שורת המצב מנחה ללחיצה הבאה, ואחר כך מונה ימים', () => {
    assertTrue(rangeStatus({ startDate: '', endDate: '' }).includes('התחלה'));
    assertTrue(rangeStatus({ startDate: '2026-09-10', endDate: '' }).includes('סיום'));
    assertTrue(rangeStatus({ startDate: '2026-09-10', endDate: '2026-09-12' }).includes('3 ימים'));
  });

  s.test('הלוח מסמן את הקצוות ואת מה שביניהם, ומחזיר את הטווח', () => {
    const field = dateRangeField({ startDate: '2026-09-10', endDate: '2026-09-12' });
    assertEqual(field.read(), { startDate: '2026-09-10', endDate: '2026-09-12' });
    const marked = [...field.node.querySelectorAll('.cal-day')]
      .filter(b => b.className.includes('is-in') || b.className.includes('is-start'));
    assertEqual(marked.map(b => b.dataset.iso), ['2026-09-10', '2026-09-11', '2026-09-12']);
    assertEqual(field.node.hasAttribute('data-empty'), false);
  });

  // min קובע גם את החודש שנפתח, ולכן הבדיקה אינה תלויה בתאריך שבו היא רצה
  s.test('שתי לחיצות בלוח בונות טווח, והשלישית פותחת חדש', () => {
    const field = dateRangeField({ min: '2026-09-01' });
    const day = iso => field.node.querySelector(`[data-iso="${iso}"]`);
    day('2026-09-10').click();
    assertEqual(field.read(), { startDate: '2026-09-10', endDate: '' });
    day('2026-09-14').click();
    assertEqual(field.read(), { startDate: '2026-09-10', endDate: '2026-09-14' });
    day('2026-09-20').click();
    assertEqual(field.read(), { startDate: '2026-09-20', endDate: '' });
  });

  s.test('לוח ריק מדווח על עצמו כריק, ו"נקה" מחזיר אותו למצב הזה', () => {
    const field = dateRangeField({ min: '2026-09-01' });
    assertEqual(field.node.hasAttribute('data-empty'), true);
    field.node.querySelector('[data-iso="2026-09-10"]').click();
    assertEqual(field.node.hasAttribute('data-empty'), false);
    [...field.node.querySelectorAll('button')].find(b => b.textContent === 'נקה').click();
    assertEqual(field.read(), { startDate: '', endDate: '' });
    assertEqual(field.node.hasAttribute('data-empty'), true);
  });

  s.test('דפדוף בין חודשים משאיר תא אחד בסדר ה-Tab', () => {
    const field = dateRangeField({ startDate: '2026-09-10' });
    field.node.querySelector('[aria-label="החודש הבא"]').click();
    const tabbable = [...field.node.querySelectorAll('.cal-day')].filter(b => b.tabIndex === 0);
    assertEqual(tabbable.length, 1, 'הלוח נסגר בפני מי שמנווט במקלדת');
    assertTrue(tabbable[0].dataset.iso.startsWith('2026-10'), tabbable[0].dataset.iso);
  });

  s.test('min ו-max חוסמים ימים שמחוץ לטווח המותר', () => {
    const field = dateRangeField({ startDate: '2026-09-10', min: '2026-09-05', max: '2026-09-20' });
    assertEqual(field.node.querySelector('[data-iso="2026-09-04"]').disabled, true);
    assertEqual(field.node.querySelector('[data-iso="2026-09-21"]').disabled, true);
    field.node.querySelector('[data-iso="2026-09-04"]').click();
    assertEqual(field.read(), { startDate: '2026-09-10', endDate: '' }, 'יום חסום שינה את הטווח');
  });

  await s.done();
}
