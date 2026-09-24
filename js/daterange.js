import { el, icon, fmtDate, fmtDateRange, fmtDayLabel, fmtDays, fmtMonth, nightsBetween } from './ui.js';

/**
 * בורר טווח תאריכים — הצורה היחידה של בחירת טווח באפליקציה.
 *
 * במקום שני שדות תאריך שצריך לדלג ביניהם יש כאן לוח חודשי אחד: הלחיצה
 * הראשונה קובעת את תאריך ההתחלה, הלחיצה השנייה סוגרת את הטווח, וכל הימים
 * שביניהם נצבעים. לחיצה נוספת פותחת טווח חדש.
 */

const DAY = 86400000;
const at = iso => Date.parse(`${iso}T00:00:00Z`);
const toIso = ms => new Date(ms).toISOString().slice(0, 10);

export const today = () => toIso(Date.now());
export const addDays = (iso, n) => toIso(at(iso) + n * DAY);
export const monthOf = iso => `${iso.slice(0, 7)}-01`;

export function shiftMonth(iso, delta) {
  const [y, m] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 10);
}

/** שבועות מלאים מיום א׳, בדיוק כמה שהחודש צריך — בלי שורה ריקה בסוף. */
export function monthGrid(iso) {
  const first = monthOf(iso);
  const lead = new Date(at(first)).getUTCDay();
  const length = new Date(at(shiftMonth(first, 1)) - DAY).getUTCDate();
  const start = addDays(first, -lead);
  return Array.from(
    { length: Math.ceil((lead + length) / 7) },
    (_, w) => Array.from({ length: 7 }, (_, d) => addDays(start, w * 7 + d)),
  );
}

/**
 * לחיצה על יום. הראשונה פותחת טווח, השנייה סוגרת אותו — וגם אם היא מוקדמת
 * מהראשונה: אז היא נעשית ההתחלה, ולא נזרקת. טווח שלם ולחיצה נוספת פותחים
 * טווח חדש, וזה גם מה שמתקן בחירה שגויה בלי כפתור נפרד.
 */
export function pickInRange({ startDate, endDate } = {}, iso) {
  if (!startDate || endDate) return { startDate: iso, endDate: '' };
  return iso < startDate ? { startDate: iso, endDate: startDate } : { startDate, endDate: iso };
}

export const rangeHas = (iso, { startDate, endDate } = {}) =>
  Boolean(startDate && endDate && iso >= startDate && iso <= endDate);

/** "12 בספט׳ – 20 בספט׳ · 9 ימים", או ההנחיה ללחיצה הבאה כשהטווח עוד פתוח. */
export function rangeStatus({ startDate, endDate } = {}) {
  if (!startDate) return 'בחרו את תאריך ההתחלה בלוח';
  if (!endDate) return `${fmtDate(startDate)} · עכשיו לחצו על תאריך הסיום`;
  return `${fmtDateRange(startDate, endDate)} · ${fmtDays(nightsBetween(startDate, endDate) + 1)}`;
}

const NARROW = new Intl.DateTimeFormat('he-IL', { weekday: 'narrow', timeZone: 'UTC' });

/**
 * הלוח עצמו. read() מחזיר את הטווח כפי שהוא — תאריך התחלה בלי סיום נשאר
 * כזה, וכל קריאה מחליטה בעצמה מה לעשות איתו.
 */
export function dateRangeField({
  startDate = '', endDate = '', min = '', max = '', label = 'טווח תאריכים',
} = {}) {
  let range = { startDate: startDate || '', endDate: endDate || '' };
  let month = monthOf(range.startDate || min || today());
  // התא שמקבל את הפוקוס במקלדת. תא אחד בלבד נכנס לסדר ה-Tab, והחיצים מזיזים
  // אותו — אחרת כל לוח היה מוסיף ארבעים ושתיים תחנות Tab לטופס.
  let cursor = range.startDate || min || today();

  const node = el('div', { class: 'cal', role: 'group', 'aria-label': label });
  const blocked = iso => Boolean((min && iso < min) || (max && iso > max));

  function pick(iso) {
    if (blocked(iso)) return;
    range = pickInRange(range, iso);
    cursor = iso;
    month = monthOf(iso);
    render(true);
  }

  function moveCursor(delta) {
    const next = addDays(cursor, delta);
    if (blocked(next)) return;
    cursor = next;
    month = monthOf(next);
    render(true);
  }

  // בעברית התאריכים גדלים שמאלה, ולכן חץ שמאלה מקדם יום וחץ ימינה מחזיר.
  const KEYS = { ArrowLeft: 1, ArrowRight: -1, ArrowDown: 7, ArrowUp: -7 };

  function day(iso) {
    const outside = iso.slice(0, 7) !== month.slice(0, 7);
    const isStart = Boolean(range.startDate) && iso === range.startDate;
    const isEnd = Boolean(range.endDate) && iso === range.endDate;
    const cls = ['cal-day',
      outside ? 'is-out' : '',
      rangeHas(iso, range) ? 'is-in' : '',
      isStart ? 'is-start' : '',
      isEnd ? 'is-end' : '',
      iso === today() ? 'is-today' : '',
    ].filter(Boolean).join(' ');

    return el('button', {
      type: 'button', class: cls, disabled: blocked(iso) || null,
      tabindex: iso === cursor ? '0' : '-1',
      'aria-label': fmtDayLabel(iso),
      'aria-pressed': String(isStart || isEnd),
      'data-iso': iso,
      onClick: () => pick(iso),
      onKeydown: e => {
        const step = KEYS[e.key];
        if (!step) return;
        e.preventDefault();
        moveCursor(step);
      },
    }, [el('span', { text: String(Number(iso.slice(8))) })]);
  }

  function navButton(delta, name, aria) {
    return el('button', {
      type: 'button', class: 'icon-btn', 'aria-label': aria, html: icon(name),
      onClick: () => { month = shiftMonth(month, delta); render(); },
    });
  }

  function render(focusCursor = false) {
    // הסימון שאומר לטופס "השדה הזה עדיין ריק", כדי שהבהוב שדות החובה יתפוס
    // גם לוח שלא נגעו בו — כאן אין input שאפשר לבדוק את ה-value שלו.
    if (range.startDate) node.removeAttribute('data-empty');
    else node.setAttribute('data-empty', '');

    const weeks = monthGrid(month);
    // דפדוף בין חודשים משאיר את תא המקלדת מאחור. בלי זה אף תא בלוח המוצג לא
    // היה בסדר ה-Tab, והלוח היה נסגר בפני מי שמנווט במקלדת.
    if (cursor.slice(0, 7) !== month.slice(0, 7)) {
      cursor = weeks.flat().find(iso => iso.slice(0, 7) === month.slice(0, 7) && !blocked(iso)) || cursor;
    }

    node.replaceChildren(
      el('div', { class: 'cal-head' }, [
        navButton(-1, 'chevronRight', 'החודש הקודם'),
        el('div', { class: 'cal-month', 'aria-live': 'polite', text: fmtMonth(month) }),
        navButton(1, 'chevronLeft', 'החודש הבא'),
      ]),
      // כל שורה בלוח פותחת ביום א׳, ולכן השורה הראשונה היא גם מקור שמות הימים
      el('div', { class: 'cal-week', 'aria-hidden': 'true' },
        weeks[0].map(iso => el('span', { text: NARROW.format(at(iso)) }))),
      el('div', { class: 'cal-grid' },
        weeks.map(week => el('div', { class: 'cal-row' }, week.map(day)))),
      el('div', { class: 'cal-status' }, [
        el('span', { 'aria-live': 'polite', text: rangeStatus(range) }),
        range.startDate
          ? el('button', {
              type: 'button', class: 'link-btn', text: 'נקה',
              onClick: () => { range = { startDate: '', endDate: '' }; render(); },
            })
          : null,
      ]),
    );

    if (focusCursor) node.querySelector(`[data-iso="${cursor}"]`)?.focus();
  }

  render();
  return { node, read: () => ({ ...range }) };
}
