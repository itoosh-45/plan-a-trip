import * as db from './db.js';
import { round2 } from './budget.js';

export async function activeWallet(tripId) {
  const rows = await db.all(db.STORES.wallets, tripId);
  return rows.find(w => w.status === 'open') || null;
}

export async function listWallets(tripId) {
  const rows = await db.all(db.STORES.wallets, tripId);
  return rows.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

export async function open(tripId, currency) {
  const existing = await activeWallet(tripId);
  if (existing) throw new Error('כבר קיים ארנק פתוח לטיול הזה. יש לסגור אותו קודם.');
  return db.put(db.STORES.wallets, { tripId, currency: (currency || 'ILS').toUpperCase(), status: 'open' });
}

export async function balance(tripId, walletId) {
  const txs = (await db.all(db.STORES.walletTx, tripId)).filter(t => t.walletId === walletId);
  const total = txs.reduce((sum, t) => sum + (t.type === 'withdraw' ? t.amount : -t.amount), 0);
  return round2(total);
}

export async function transactions(tripId, walletId) {
  const txs = (await db.all(db.STORES.walletTx, tripId)).filter(t => t.walletId === walletId);
  return txs.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function assertPositive(amount, label) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${label} חייב להיות גדול מאפס`);
  return n;
}

export async function withdraw(tripId, walletId, amount, note) {
  const n = assertPositive(amount, 'סכום המשיכה');
  return db.put(db.STORES.walletTx, {
    tripId, walletId, type: 'withdraw', amount: round2(n), note: note || '',
    date: new Date().toISOString().slice(0, 10),
  });
}

export async function spend(tripId, walletId, amount, note) {
  const n = assertPositive(amount, 'סכום ההוצאה');
  return db.put(db.STORES.walletTx, {
    tripId, walletId, type: 'spend', amount: round2(n), note: note || '',
    date: new Date().toISOString().slice(0, 10),
  });
}

/** סוגר את הארנק הפעיל עם יתרת סגירה, ופותח ארנק חדש במטבע הבא (למשל, מעבר גבול). */
export async function closeAndOpen(tripId, remaining, newCurrency) {
  const wallet = await activeWallet(tripId);
  if (!wallet) throw new Error('אין ארנק פתוח לסגירה');
  await db.put(db.STORES.wallets, {
    ...wallet, status: 'closed', closedAt: new Date().toISOString(),
    closingBalance: round2(Number(remaining) || 0),
  });
  return open(tripId, newCurrency);
}
