import * as db from './db.js';

/** כל השערים נשמרים מול שקל. שער מטבע-למטבע נגזר דרך השקל. */
const BASE = 'ILS';
const STALE_MS = 24 * 60 * 60 * 1000;

export function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

const pairKey = currency => `${currency.toUpperCase()}_${BASE}`;

export async function getRate(currency) {
  const cur = (currency || BASE).toUpperCase();
  if (cur === BASE) return { rate: 1, ts: new Date().toISOString(), source: 'identity', stale: false };
  const row = await db.get(db.STORES.fxRates, pairKey(cur));
  if (!row) return null;
  return {
    rate: row.rate, ts: row.ts, source: row.source,
    stale: Date.now() - Date.parse(row.ts) > STALE_MS,
  };
}

export async function setManualRate(currency, rate) {
  const n = Number(rate);
  if (!Number.isFinite(n) || n <= 0) throw new Error('השער חייב להיות מספר גדול מאפס');
  const ts = new Date().toISOString();
  await db.put(db.STORES.fxRates, { pair: pairKey(currency), rate: n, ts, source: 'manual' });
  return { rate: n, ts, source: 'manual', stale: false };
}

/** השדות שנצרבים על רשומה ברגע יצירתה. אחרי הצריבה הם קפואים לנצח. */
export async function stamp(currency) {
  const info = await getRate(currency);
  if (!info) return {};
  return {
    rateToILS: info.rate,
    rateDate: new Date().toISOString().slice(0, 10),
    rateSource: info.source,
  };
}

/** ערך הרשומה בשקלים לפי השער שנצרב עליה. בלי שער — הסכום הגולמי, בלי לקרוס. */
export function toILS(rec) {
  const amount = Number(rec?.amount) || 0;
  return rec?.rateToILS ? round2(amount * rec.rateToILS) : amount;
}

async function fetchFrankfurter(currency) {
  const res = await fetch(`https://api.frankfurter.dev/v1/latest?base=${currency}&symbols=${BASE}`);
  if (!res.ok) throw new Error('frankfurter unavailable');
  const rate = (await res.json())?.rates?.[BASE];
  if (!rate) throw new Error('currency not supported by frankfurter');
  return rate;
}

async function fetchErApi(currency) {
  const res = await fetch(`https://open.er-api.com/v6/latest/${currency}`);
  if (!res.ok) throw new Error('er-api unavailable');
  const rate = (await res.json())?.rates?.[BASE];
  if (!rate) throw new Error('currency not supported by er-api');
  return rate;
}

/** מושך שערים בלי לשמור אותם — כדי שאפשר יהיה להציג לאישור לפני שדורסים ידניים. */
export async function fetchRates(currencies) {
  const out = {};
  for (const raw of currencies) {
    const cur = (raw || '').toUpperCase();
    if (!cur || cur === BASE) continue;
    try {
      out[cur] = { ok: true, rate: await fetchFrankfurter(cur), source: 'frankfurter' };
    } catch {
      try {
        out[cur] = { ok: true, rate: await fetchErApi(cur), source: 'er-api' };
      } catch {
        out[cur] = { ok: false };
      }
    }
  }
  return out;
}

/** שומר שערים שנמשכו ואושרו. */
export async function applyRates(fetched) {
  const ts = new Date().toISOString();
  let saved = 0;
  for (const [cur, r] of Object.entries(fetched)) {
    if (!r.ok) continue;
    await db.put(db.STORES.fxRates, { pair: pairKey(cur), rate: r.rate, ts, source: r.source });
    saved++;
  }
  return saved;
}
