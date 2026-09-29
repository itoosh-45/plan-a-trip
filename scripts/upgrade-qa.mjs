import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const base = 'http://127.0.0.1:8124';
const oldRoot = process.env.OLD_ROOT;
assert.ok(oldRoot, 'OLD_ROOT is required');

async function serve(cwd) {
  const child = spawn('python3', ['dev-server.py', '8124'], { cwd, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(base)).ok) return child; } catch { /* starting */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  child.kill();
  throw new Error(`Server did not start in ${cwd}`);
}

let server;
let browser;
try {
  server = await serve(oldRoot);
  browser = await chromium.launch();
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  await page.goto(base);
  await page.locator('#nav button').first().waitFor();

  const before = await page.evaluate(async () => {
    const db = await import('./js/db.js');
    const trips = await import('./js/trips.js');
    const it = await import('./js/itinerary.js');
    const expenses = await import('./js/expenses.js');
    const prep = await import('./js/prep.js');
    const rates = await import('./js/rates.js');

    const a = await trips.createTrip({
      name: 'ישן עם יעדים', currency: 'THB', totalBudget: 1000,
      startDate: '2027-02-16', endDate: '2027-02-20',
    });
    const general = await it.generalSegment(a.id);
    await it.saveSegment(a.id, {
      city: 'גודאורי', startDate: '2027-02-16', endDate: '2027-02-18', allocation: 500,
    });
    await rates.setManualRate('THB', 0.12);
    await expenses.saveExpense(a.id, {
      kind: 'expense', amount: 100, currency: 'THB', segmentId: general.id, note: 'הוצאה ישנה כללית',
    });
    await prep.saveTask(a.id, {
      title: 'משימה ישנה כללית', stage: 'before', category: prep.OTHER, segmentId: general.id,
    });
    await it.quickAddItem(a.id, { date: '2027-02-19', title: 'פריט ישן כללי', segmentId: general.id });

    const b = await trips.createTrip({ name: 'טיול שני', currency: 'ILS' });
    await expenses.saveExpense(b.id, {
      kind: 'expense', amount: 50, currency: 'ILS', segmentId: (await it.generalSegment(b.id)).id,
    });
    localStorage.setItem('activeTripId', a.id);
    const stores = {};
    for (const name of Object.values(db.STORES).filter(n => n !== 'settings')) {
      stores[name] = (await db.all(name)).sort((x, y) =>
        String(x.id || x.pair).localeCompare(String(y.id || y.pair)));
    }
    return { stores, activeTripId: localStorage.getItem('activeTripId'), generalId: general.id };
  });

  server.kill();
  await new Promise(resolve => server.once('exit', resolve));
  server = await serve(process.cwd());
  await page.reload();
  await page.locator('#nav button').first().waitFor();

  const after = await page.evaluate(async () => {
    const db = await import('./js/db.js');
    const stores = {};
    for (const name of Object.values(db.STORES).filter(n => n !== 'settings')) {
      stores[name] = (await db.all(name)).sort((x, y) =>
        String(x.id || x.pair).localeCompare(String(y.id || y.pair)));
    }
    return { stores, activeTripId: localStorage.getItem('activeTripId') };
  });

  assert.deepEqual(after.stores, before.stores, 'Old trip data changed after upgrade');
  assert.equal(after.activeTripId, before.activeTripId);
  assert.equal(after.stores.segments.filter(s => s.id === before.generalId).length, 1);
  console.log('Upgrade QA: two trips, IDs, destinations, tasks, items, expenses, budgets, FX and active trip preserved');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server?.kill();
}
