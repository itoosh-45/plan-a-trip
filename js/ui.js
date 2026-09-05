import { ICONS } from './icons.js';
import { symbol as currencySymbol } from './currencies.js';

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
export function fmtMoney(amount, currency = 'ILS') {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return '—';
  const digits = Math.abs(amount) >= 100 ? 0 : 2;
  const key = `${currency}|${digits}`;
  if (!MONEY.has(key)) {
    MONEY.set(key, new Intl.NumberFormat('he-IL', {
      style: 'currency', currency, maximumFractionDigits: digits, minimumFractionDigits: 0,
    }));
  }
  return MONEY.get(key).format(amount);
}

export function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'short' })
    .format(new Date(Date.UTC(y, m - 1, d)));
}

export function fmtDateRange(fromIso, toIso) {
  if (!fromIso) return '';
  if (!toIso || fromIso === toIso) return fmtDate(fromIso);
  return `${fmtDate(fromIso)} – ${fmtDate(toIso)}`;
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

/**
 * שדה סכום עם דרופדאון מטבע לצדו. מוחזר יחד עם read() כדי שאף מסך לא יצטרך
 * לדעת איך השדה בנוי — זו הצורה היחידה של הזנת סכום באפליקציה.
 */
export function amountField({ amount = '', currency = 'ILS', currencies = ['ILS'] } = {}) {
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

  return {
    node: el('div', { style: 'display:flex; gap:8px' }, [value, pick]),
    input: value,
    read: () => ({
      amount: value.value === '' ? undefined : Number(value.value),
      currency: pick.value,
    }),
  };
}

/** המרה לשקלים בטקסט משני. מטבע שהוא כבר שקל אינו מקבל המרה. */
export function ilsNote(amount, currency, rateToILS) {
  if (!amount || !currency || currency === 'ILS' || !rateToILS) return null;
  return el('div', { class: 'sub num', text: `≈ ${fmtMoney(amount * rateToILS, 'ILS')}` });
}
