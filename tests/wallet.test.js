import { suite, assertEqual, assertThrows } from './harness.js';
import * as db from '../js/db.js';
import * as trips from '../js/trips.js';
import * as wallet from '../js/wallet.js';

async function freshTrip() {
  await db.wipe();
  return trips.createTrip({ name: 'ארנק', homeCurrency: 'ILS' });
}

export default async function () {
  const s = suite('ארנק מזומן');
  await db.useTestDatabase();

  s.test('open יוצר ארנק פעיל, ולא ניתן לפתוח שני ארנקים פעילים', async () => {
    const t = await freshTrip();
    const w = await wallet.open(t.id, 'jpy');
    assertEqual(w.currency, 'JPY');
    assertEqual((await wallet.activeWallet(t.id)).id, w.id);
    await assertThrows(() => wallet.open(t.id, 'EUR'), 'נפתח ארנק שני בלי לסגור');
  });

  s.test('withdraw ו-spend מחשבים יתרה נכונה', async () => {
    const t = await freshTrip();
    const w = await wallet.open(t.id, 'JPY');
    await wallet.withdraw(t.id, w.id, 10000);
    await wallet.spend(t.id, w.id, 3500);
    await wallet.spend(t.id, w.id, 1200.5);
    assertEqual(await wallet.balance(t.id, w.id), 5299.5);
  });

  s.test('withdraw ו-spend דוחים סכום אפס ושלילי', async () => {
    const t = await freshTrip();
    const w = await wallet.open(t.id, 'ILS');
    await assertThrows(() => wallet.withdraw(t.id, w.id, 0), 'משיכת אפס עברה');
    await assertThrows(() => wallet.withdraw(t.id, w.id, -50), 'משיכה שלילית עברה');
    await assertThrows(() => wallet.spend(t.id, w.id, 0), 'הוצאת אפס עברה');
  });

  s.test('closeAndOpen סוגר את הארנק הישן עם יתרת סגירה ופותח חדש במטבע אחר', async () => {
    const t = await freshTrip();
    const first = await wallet.open(t.id, 'EUR');
    await wallet.withdraw(t.id, first.id, 200);
    await wallet.spend(t.id, first.id, 150);

    const second = await wallet.closeAndOpen(t.id, 50, 'GEL');

    const closed = await db.get(db.STORES.wallets, first.id);
    assertEqual([closed.status, closed.closingBalance], ['closed', 50]);
    assertEqual(second.currency, 'GEL');
    assertEqual((await wallet.activeWallet(t.id)).id, second.id);
  });

  s.test('closeAndOpen בלי ארנק פתוח נכשל בעברית', async () => {
    const t = await freshTrip();
    await assertThrows(() => wallet.closeAndOpen(t.id, 0, 'ILS'), 'נסגר ארנק שלא היה קיים');
  });

  s.test('שני טיולים עם ארנקים אינם מתערבבים', async () => {
    await db.wipe();
    const a = await trips.createTrip({ name: 'א', homeCurrency: 'ILS' });
    const b = await trips.createTrip({ name: 'ב', homeCurrency: 'ILS' });
    const wa = await wallet.open(a.id, 'ILS');
    const wb = await wallet.open(b.id, 'EUR');
    await wallet.withdraw(a.id, wa.id, 100);
    await wallet.withdraw(b.id, wb.id, 50);
    assertEqual(await wallet.balance(a.id, wa.id), 100);
    assertEqual(await wallet.balance(b.id, wb.id), 50);
  });

  await s.done();
}
