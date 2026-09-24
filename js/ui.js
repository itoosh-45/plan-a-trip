import { ICONS } from './icons.js';
import { symbol as currencySymbol, displayFor } from './currencies.js';

export function icon(name, cls = '') {
  const body = ICONS[name] || ICONS.other;
  return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none"
    stroke="currentColor" stroke-width="1.8" stroke-linecap="round"
    stroke-linejoin="round" aria-hidden="true" class="${cls}">${body}</svg>`;
}

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined || c === false) continue;
    node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

export function card(children, cls = '') {
  return el('div', { class: `card ${cls}`.trim() }, children);
}

export function sheet({ title, body, actions = [] }) {
  const backdrop = el('div', { class: 'sheet-backdrop' });
  const close = () => backdrop.remove();

  const panel = el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, [
    el('div', { class: 'sheet-head' }, [
      el('h2', { class: 'sheet-title', text: title }),
      el('button', { class: 'icon-btn', 'aria-label': 'סגור', html: icon('close'), onClick: close }),
    ]),
    body,
    actions.length
      ? el('div', { class: 'field-row', style: 'display:flex; gap:8px' }, actions)
      : null,
  ]);

  backdrop.append(panel);
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
  document.body.append(backdrop);
  return { close, panel };
}

/**
 * שדות חובה.
 *
 * באפליקציה הזו כמעט הכול רשות — טיול נוצר משם בלבד, וכל השאר אפשר להשלים
 * אחר כך. כדי שזה יהיה גלוי ולא סוד, יש בדיוק סימן אחד: כוכבית אדומה קטנה
 * ליד התווית של שדה חובה. הסימן לא בא לבד — requiredNote הוא המקרא שלו,
 * והוא גם כפתור: לחיצה עליו מדליקה את שדות החובה עצמם.
 */
export function requiredStar() {
  return el('span', { class: 'req', role: 'img', 'aria-label': 'שדה חובה', text: '*' });
}

export function fieldLabel(text, { required = false } = {}) {
  return el('label', { class: 'field-label' }, [text, required ? requiredStar() : null]);
}

/** תווית מעל פקד. required מסמן את השורה, את התווית ואת הפקד עצמו. */
export function fieldRow(label, node, { required = false } = {}) {
  if (required && ['INPUT', 'SELECT', 'TEXTAREA'].includes(node.tagName)) {
    node.setAttribute('aria-required', 'true');
  }
  return el('div', { class: 'field-row', 'data-required': required ? '' : null }, [
    fieldLabel(label, { required }),
    node,
  ]);
}

const isEmptyRow = row => {
  const control = row.querySelector('input, select, textarea');
  if (control) return !String(control.value).trim();
  // פקד שאינו שדה טקסט — לוח התאריכים — מדווח על עצמו
  return Boolean(row.querySelector('[data-empty]'));
};

/**
 * מדליק לרגע את שדות החובה שבטופס. onlyEmpty מצמצם לאלה שבאמת חסרים, וזה
 * מה שנקרא אחרי שמירה שנכשלה: הודעת השגיאה אומרת מה חסר, וההבהוב אומר איפה.
 */
export function flashRequired(from, { onlyEmpty = false } = {}) {
  const scope = from?.closest?.('.sheet') || from || document;
  const rows = [...scope.querySelectorAll('[data-required]')]
    .filter(row => !onlyEmpty || isEmptyRow(row));
  for (const row of rows) {
    row.classList.remove('req-flash');
    void row.offsetWidth;   // בלי זה אנימציה שרצה כרגע לא מתחילה מחדש
    row.classList.add('req-flash');
    setTimeout(() => row.classList.remove('req-flash'), 1600);
  }
  return rows.length;
}

/** המקרא של הכוכבית. לחיצה עליו מראה בדיוק אילו שדות בטופס הם חובה. */
export function requiredNote(text) {
  const note = el('button', {
    type: 'button', class: 'req-note',
    onClick: () => flashRequired(note),
  }, [requiredStar(), el('span', { text })]);
  return note;
}

export function toast(msg, kind = '') {
  const host = document.getElementById('toasts');
  const node = el('div', { class: `toast ${kind}`.trim(), text: msg, role: 'status' });
  host.append(node);
  setTimeout(() => node.remove(), 3500);
}

/**
 * אישור לפעולה בעלת השלכות. confirmClass מאפשר לפעולה שאינה הרסנית — כמו
 * הארכת טיול — לקבל כפתור ראשי במקום כפתור אדום, בלי טופס אישור שני.
 */
export function confirmDanger({ title, body, confirmLabel = 'מחק', confirmClass = 'btn-danger' }) {
  return new Promise(resolve => {
    let settled = false;
    const finish = v => { if (!settled) { settled = true; s.close(); resolve(v); } };
    const s = sheet({
      title,
      body: el('p', { class: 'dim', text: body }),
      actions: [
        el('button', { class: 'btn btn-tertiary btn-block', text: 'ביטול', onClick: () => finish(false) }),
        el('button', { class: `btn ${confirmClass} btn-block`, text: confirmLabel, onClick: () => finish(true) }),
      ],
    });
  });
}

const MONEY = new Map();
/** אגורות מוצגות רק בסכומים קטנים. בסכום גדול הן רעש. */
function moneyFormat(amount, currency) {
  const digits = Math.abs(amount) >= 100 ? 0 : 2;
  const key = `${currency}|${digits}`;
  if (!MONEY.has(key)) {
    MONEY.set(key, new Intl.NumberFormat('he-IL', {
      style: 'currency', currency, currencyDisplay: displayFor(currency),
      maximumFractionDigits: digits, minimumFractionDigits: 0,
    }));
  }
  return MONEY.get(key);
}

const isAmount = a => a !== null && a !== undefined && !Number.isNaN(a);

export function fmtMoney(amount, currency = 'ILS') {
  if (!isAmount(amount)) return '—';
  return moneyFormat(amount, currency).format(amount);
}

/**
 * אותו סכום בדיוק, כ-HTML, עם תו המטבע עטוף ב-.cur כדי שיוצג קטן מהספרות.
 * Intl מחזיר כאן רק ספרות, מפרידים וסימן מטבע, ולכן אין מה לברוח ממנו.
 */
export function fmtMoneyHtml(amount, currency = 'ILS') {
  if (!isAmount(amount)) return '—';
  return moneyFormat(amount, currency).formatToParts(amount)
    .map(p => (p.type === 'currency' ? `<span class="cur">${p.value}</span>` : p.value))
    .join('');
}

export function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'short', timeZone: 'UTC' })
    .format(new Date(Date.UTC(y, m - 1, d)));
}

export function fmtDateRange(fromIso, toIso) {
  if (!fromIso) return '';
  if (!toIso || fromIso === toIso) return fmtDate(fromIso);
  return `${fmtDate(fromIso)} – ${fmtDate(toIso)}`;
}

/**
 * שם היום בעברית. Intl מחזיר כאן בדיוק "יום א׳" עד "יום ו׳" ו"שבת",
 * ולכן אין טבלת שמות ידנית שאפשר לשכוח לתחזק.
 */
const WEEKDAY_FMT = new Intl.DateTimeFormat('he-IL', { weekday: 'short', timeZone: 'UTC' });
const MONTH_FMT = new Intl.DateTimeFormat('he-IL', { month: 'long', year: 'numeric', timeZone: 'UTC' });

const atUTC = iso => new Date(`${iso}T00:00:00Z`);

export function fmtWeekday(iso) {
  return iso ? WEEKDAY_FMT.format(atUTC(iso)) : '';
}

/** "יום א׳ · 12 בספט׳" — התווית של יום ברשימת התכנון. */
export function fmtDayLabel(iso) {
  return iso ? `${fmtWeekday(iso)} · ${fmtDate(iso)}` : '';
}

export function fmtMonth(iso) {
  return iso ? MONTH_FMT.format(atUTC(iso)) : '';
}

/** יום א׳ הוא תחילת השבוע. מחזיר את התאריך של יום א׳ של אותו שבוע. */
export function startOfWeek(iso) {
  if (!iso) return '';
  const d = atUTC(iso);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}

/** "יום אחד" / "יומיים" / "3 ימים" — עברית תקנית בכותרת קבוצה. */
export function fmtDays(count) {
  if (count === 1) return 'יום אחד';
  if (count === 2) return 'יומיים';
  return `${count} ימים`;
}

export function nightsBetween(fromIso, toIso) {
  if (!fromIso || !toIso) return 0;
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  return Math.max(0, Math.round((b - a) / 86400000));
}

export function datesBetween(fromIso, toIso) {
  const out = [];
  if (!fromIso || !toIso) return out;
  let t = Date.parse(`${fromIso}T00:00:00Z`);
  const end = Date.parse(`${toIso}T00:00:00Z`);
  while (t <= end) {
    out.push(new Date(t).toISOString().slice(0, 10));
    t += 86400000;
  }
  return out;
}

const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * המרה בין שני מטבעות דרך השקל, לפי שערים מול השקל. אין שער לאחד מהם —
 * מוחזר null, ולעולם לא 1:1: המרה שקרית גרועה מהיעדר המרה.
 */
export function convertAmount(amount, fromRate, toRate) {
  const n = Number(amount);
  if (!Number.isFinite(n) || !fromRate || !toRate) return null;
  return round2((n * fromRate) / toRate);
}

/**
 * שדה סכום עם דרופדאון מטבע לצדו. מוחזר יחד עם read() כדי שאף מסך לא יצטרך
 * לדעת איך השדה בנוי — זו הצורה היחידה של הזנת סכום באפליקציה.
 *
 * convertTo הוא מטבע היעד, בדרך כלל מטבע הטיול. כשנבחר מטבע אחר — למשל שקל
 * בטיול שמתנהל בבאהט — השדה מראה בזמן אמת כמה זה במטבע היעד ולפי איזה שער,
 * ומציע להמיר בלחיצה אחת. השער הוא השער השמור האמיתי; מטבע שאין לו שער אומר
 * זאת במקום לנחש.
 *
 * fx הוא מפת שערים מול השקל ({ THB: 0.1167 }), כפי ש-rates.rateMap מחזיר.
 */
export function amountField({
  amount = '', currency = 'ILS', currencies = ['ILS'], convertTo = null, fx = {},
} = {}) {
  const value = el('input', {
    class: 'field', type: 'number', inputmode: 'decimal', step: '0.01',
    value: amount === null || amount === undefined ? '' : amount, 'aria-label': 'סכום',
  });
  const list = currencies.includes(currency) ? currencies : [currency, ...currencies];
  const pick = el('select', {
    class: 'field', style: 'max-width:110px', 'aria-label': 'מטבע',
  }, list.map(c => el('option', {
    value: c, selected: c === currency, text: `${currencySymbol(c)} · ${c}`,
  })));

  const target = (convertTo || '').toUpperCase();
  const rateOf = code => (code === 'ILS' ? (fx.ILS ?? 1) : fx[code] ?? null);
  const inTarget = (n, from = pick.value) => convertAmount(n, rateOf(from), rateOf(target));

  const text = el('span');
  const convertBtn = el('button', {
    type: 'button', class: 'link-btn', text: `המרה ל-${currencySymbol(target) || target}`,
    onClick: () => {
      const converted = inTarget(value.value);
      if (converted === null) return;
      value.value = converted;
      pick.value = target;
      update();
    },
  });
  const note = el('div', { class: 'amount-conv' }, [text, convertBtn]);

  /** שורת ההמרה נדלקת רק כשיש באמת המרה להראות — מטבע היעד עצמו שקט. */
  function update() {
    const from = pick.value;
    if (!target || from === target) { note.hidden = true; return; }
    note.hidden = false;

    const rate = inTarget(1, from);
    if (rate === null) {
      text.textContent = `אין שער שמור ל-${from} — לא ניתן להמיר ל-${target}. אפשר להזין שער בהגדרות.`;
      convertBtn.hidden = true;
      return;
    }

    const typed = value.value === '' ? null : inTarget(value.value, from);
    text.textContent = typed === null
      ? `1 ${currencySymbol(from)} = ${rate} ${currencySymbol(target)} — לפי השער השמור`
      : `≈ ${fmtMoney(typed, target)} · 1 ${currencySymbol(from)} = ${rate} ${currencySymbol(target)}`;
    convertBtn.hidden = typed === null;
  }

  value.addEventListener('input', update);
  pick.addEventListener('change', update);
  update();

  return {
    node: el('div', {}, [
      el('div', { style: 'display:flex; gap:8px' }, [value, pick]),
      note,
    ]),
    input: value,
    read: () => ({
      amount: value.value === '' ? undefined : Number(value.value),
      currency: pick.value,
    }),
    /**
     * הסכום במטבע מבוקש — לשדות שנשמרים כמספר במטבע הטיול ואין להם מטבע
     * משלהם. null פירושו שאין שער ולכן אין המרה.
     */
    readIn: (code = target) => {
      if (value.value === '') return undefined;
      const to = (code || '').toUpperCase();
      const n = Number(value.value);
      if (!to || pick.value === to) return n;
      return convertAmount(n, rateOf(pick.value), rateOf(to));
    },
  };
}

/**
 * שווי הסכום בשקלים, כטקסט. מטבע שהוא כבר שקל אינו מקבל המרה, וגם לא סכום
 * ריק או מטבע שאין לו שער — הערה שקרית גרועה מהיעדר הערה.
 */
export function ilsText(amount, currency, rateToILS) {
  if (!amount || !currency || currency === 'ILS' || !rateToILS) return '';
  return `≈ ${fmtMoney(amount * rateToILS, 'ILS')}`;
}

/** אותה המרה, כשורה משנית מתחת לסכום. */
export function ilsNote(amount, currency, rateToILS) {
  const text = ilsText(amount, currency, rateToILS);
  return text ? el('div', { class: 'sub num ils', text }) : null;
}

/**
 * שורת המרה לזוג סכומים שמוצג כ"X מתוך Y" — הערה אחת לשניהם, במקום שתי
 * שורות שאומרות את אותו הדבר.
 */
export function ilsPairNote(amount, of, currency, rateToILS) {
  const a = ilsText(amount, currency, rateToILS);
  if (!a) return null;
  const b = ilsText(of, currency, rateToILS);
  // שני מספרים ומילה עברית ביניהם: כל מספר בתוך .num משלו, והסדר נקבע
  // לפי כיוון העברית של השורה — לא לפי בידי בתוך מחרוזת מעורבת אחת.
  return el('div', { class: 'sub ils' }, b
    ? [el('span', { class: 'num', text: a }), ' מתוך ', el('span', { class: 'num', text: b.replace('≈ ', '') })]
    : [el('span', { class: 'num', text: a })]);
}
