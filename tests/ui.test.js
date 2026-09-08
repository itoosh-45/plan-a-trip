import { suite, assertEqual, assertTrue } from './harness.js';
import { ICONS } from '../js/icons.js';
import {
  icon, el, fmtDate, fmtDateRange, fmtMoneyHtml, nightsBetween, datesBetween,
  fmtDayLabel, fmtDays, startOfWeek, ilsText, ilsNote, ilsPairNote,
  fieldRow, requiredNote, flashRequired,
} from '../js/ui.js';
import { symbol, NAMES } from '../js/currencies.js';

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

  s.test('מטבע עם סימן ייחודי מוצג כסימן ולא כקוד', () => {
    const asCode = Object.keys(NAMES).filter(c => symbol(c) === c);
    // CHF, AED, MAD ו-JOD באמת חסרי סימן — כל השאר חייב סימן.
    assertEqual(asCode.sort(), ['AED', 'CHF', 'JOD', 'MAD']);
    assertEqual(symbol('GEL'), '₾');
    assertEqual(symbol('ILS'), '₪');
    // הבחנה בין דולרים לא נמחקת בדרך
    assertEqual(symbol('AUD'), 'A$');
  });

  s.test('fmtMoneyHtml עוטף רק את תו המטבע ב-.cur', () => {
    const node = el('span', { html: fmtMoneyHtml(1234, 'GEL') });
    assertEqual(node.querySelectorAll('.cur').length, 1);
    assertEqual(node.querySelector('.cur').textContent, '₾');
    assertTrue(node.textContent.includes('1,234'), `סכום שגוי: ${node.textContent}`);
    assertEqual(el('span', { html: fmtMoneyHtml(null) }).textContent, '—');
  });

  s.test('tokens.css הוא המקור לצבעים — הערכים נטענו', () => {
    const v = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    assertEqual(v('--color-highlight'), '#EE4266');
    assertEqual(v('--color-accent'), 'oklch(0.60 0.075 195)');
    assertEqual(v('--color-danger'), 'oklch(0.55 0.14 27)');
    assertEqual(v('--radius-card'), '12px');
  });

  s.test('fmtDayLabel נותן שם יום עברי, ו-startOfWeek נופל על יום א׳', () => {
    assertTrue(fmtDayLabel('2026-09-06').startsWith('יום א׳'), fmtDayLabel('2026-09-06'));
    assertTrue(fmtDayLabel('2026-09-12').startsWith('שבת'), fmtDayLabel('2026-09-12'));
    assertEqual(startOfWeek('2026-09-10'), '2026-09-06');
    assertEqual(startOfWeek('2026-09-06'), '2026-09-06');
    assertEqual([fmtDays(1), fmtDays(2), fmtDays(5)], ['יום אחד', 'יומיים', '5 ימים']);
  });

  s.test('שווי בשקלים מוצג רק כשיש מה להמיר', () => {
    assertTrue(ilsText(100, 'EUR', 4).includes('400'), ilsText(100, 'EUR', 4));
    assertEqual(ilsText(100, 'ILS', 1), '', 'שקל אינו זקוק להמרה');
    assertEqual(ilsText(100, 'EUR', null), '', 'בלי שער אין להמציא המרה');
    assertEqual(ilsText(0, 'EUR', 4), '', 'אפס אינו מקבל הערה');
    assertEqual(ilsNote(100, 'ILS', 1), null);
    assertTrue(ilsNote(100, 'EUR', 4).className.includes('ils'), 'לשורת ההמרה אין מחלקה משלה');
  });

  s.test('"מתוך" בשורת ההמרה בנוי משני מספרים נפרדים, לא ממחרוזת מעורבת', () => {
    const node = ilsPairNote(100, 500, 'EUR', 4);
    const nums = node.querySelectorAll('.num');
    assertEqual(nums.length, 2, 'מחרוזת מעורבת בתוך .num מוצגת בסדר הפוך בעברית');
    assertTrue(nums[0].textContent.includes('400') && nums[1].textContent.includes('2,000'),
      [...nums].map(n => n.textContent).join(' | '));
    assertEqual(ilsPairNote(100, 500, 'ILS', 1), null);
  });

  s.test('שדה חובה מסומן בכוכבית אחת, ושדה רשות לא מסומן כלל', () => {
    const must = fieldRow('שם הטיול', el('input', { class: 'field' }), { required: true });
    const may = fieldRow('מדינה', el('input', { class: 'field' }));
    assertEqual(must.querySelectorAll('.req').length, 1);
    assertEqual(must.hasAttribute('data-required'), true);
    assertEqual(must.querySelector('input').getAttribute('aria-required'), 'true');
    assertEqual(may.querySelectorAll('.req').length, 0, 'שדה רשות קיבל סימון חובה');
    assertEqual(may.hasAttribute('data-required'), false);
  });

  s.test('לחיצה על מקרא הכוכבית מדליקה בדיוק את שדות החובה', () => {
    const form = el('div', { class: 'sheet' }, [
      requiredNote('רק שדה עם כוכבית הוא חובה'),
      fieldRow('שם', el('input', { class: 'field' }), { required: true }),
      fieldRow('הערה', el('input', { class: 'field' })),
    ]);
    document.body.append(form);
    form.querySelector('.req-note').click();
    assertEqual(form.querySelectorAll('.req-flash').length, 1);
    assertEqual(form.querySelector('.req-flash').hasAttribute('data-required'), true);
    form.remove();
  });

  s.test('אחרי שמירה שנכשלה מודגשים רק שדות החובה שנשארו ריקים', () => {
    const filled = el('input', { class: 'field', value: 'תאילנד' });
    const empty = el('input', { class: 'field' });
    const form = el('div', { class: 'sheet' }, [
      fieldRow('שם', filled, { required: true }),
      fieldRow('יעד', empty, { required: true }),
    ]);
    document.body.append(form);
    assertEqual(flashRequired(form, { onlyEmpty: true }), 1);
    assertEqual([...form.querySelectorAll('.req-flash')][0].contains(empty), true);
    form.remove();
  });

  s.test('לוח תאריכים ריק נספר כשדה חובה חסר, אף שאין בו input', () => {
    const cal = el('div', { class: 'cal', 'data-empty': '' });
    const form = el('div', { class: 'sheet' }, [
      fieldRow('טווח התאריכים', cal, { required: true }),
    ]);
    document.body.append(form);
    assertEqual(flashRequired(form, { onlyEmpty: true }), 1);
    cal.removeAttribute('data-empty');
    assertEqual(flashRequired(form, { onlyEmpty: true }), 0, 'לוח שנבחר בו טווח עדיין נספר כריק');
    form.remove();
  });

  await s.done();
}
