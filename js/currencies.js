import * as db from './db.js';

export const DEFAULT_CURRENCIES = ['ILS', 'USD', 'EUR', 'GBP', 'THB', 'JPY'];

/** מטבעות שניתן לבחור בהגדרות. רשימה מקוצרת בכוונה — לא כל מטבעות העולם. */
export const NAMES = {
  ILS: 'שקל', USD: 'דולר אמריקאי', EUR: 'אירו', GBP: 'לירה שטרלינג',
  THB: 'באהט תאילנדי', JPY: 'ין יפני', CHF: 'פרנק שוויצרי', AUD: 'דולר אוסטרלי',
  CAD: 'דולר קנדי', TRY: 'לירה טורקית', AED: 'דירהם', INR: 'רופי הודי',
  VND: 'דונג ויאטנמי', IDR: 'רופיה אינדונזית', PHP: 'פסו פיליפיני',
  MXN: 'פסו מקסיקני', CZK: 'קרונה צ׳כית', PLN: 'זלוטי', HUF: 'פורינט',
  SEK: 'קרונה שוודית', NOK: 'קרונה נורווגית', DKK: 'קרונה דנית',
  ZAR: 'ראנד', BRL: 'ריאל ברזילאי', CNY: 'יואן', KRW: 'וון', SGD: 'דולר סינגפורי',
  NZD: 'דולר ניו־זילנדי', RON: 'ליי', GEL: 'לארי', MAD: 'דירהם מרוקאי',
  EGP: 'לירה מצרית', JOD: 'דינר ירדני', LKR: 'רופי סרילנקי', NPR: 'רופי נפאלי',
};

function sign(code, currencyDisplay) {
  const parts = new Intl.NumberFormat('he-IL', { style: 'currency', currency: code, currencyDisplay })
    .formatToParts(0);
  return parts.find(p => p.type === 'currency')?.value || code;
}

const DISPLAY = new Map();
/**
 * איזו צורת סימן Intl יציג עבור המטבע. ברירת המחדל מחזירה את הקוד עצמו
 * למטבעות כמו GEL או PLN, ולכן שם — ורק שם — נופלים ל-narrowSymbol.
 * כך ₾ ו-zł מופיעים, בזמן ש-A$ ו-CA$ נשארים מובחנים במקום להתמזג ל-$ אחד.
 */
export function displayFor(code) {
  if (!DISPLAY.has(code)) DISPLAY.set(code, sign(code, 'symbol') === code ? 'narrowSymbol' : 'symbol');
  return DISPLAY.get(code);
}

/** הסימן של המטבע. איפה שאין שום סימן ייחודי (CHF, AED) חוזר הקוד — וזה הנכון. */
export function symbol(code) {
  return sign(code, displayFor(code));
}

/** התווית המלאה של מטבע. מטבע בלי סימן ייחודי אינו מציג את הקוד פעמיים. */
export function label(code) {
  const sign = symbol(code);
  const name = NAMES[code] || '';
  return sign === code ? `${code} · ${name}`.trim() : `${sign} · ${code} · ${name}`.trim();
}

export async function listActive() {
  const saved = await db.getSetting('currencies', null);
  return saved?.length ? saved : DEFAULT_CURRENCIES;
}

/** השקל תמיד ראשון ותמיד קיים — הוא מטבע ההמרה של כל האפליקציה. */
export async function setActive(codes) {
  const clean = [...codes].map(c => String(c).trim().toUpperCase());
  const bad = clean.filter(c => !/^[A-Z]{3}$/.test(c));
  if (bad.length) throw new Error(`קוד מטבע לא תקין: ${bad.join(', ')}`);
  const list = ['ILS', ...clean.filter(c => c !== 'ILS')];
  await db.setSetting('currencies', list);
  return list;
}
