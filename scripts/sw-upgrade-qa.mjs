import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const base = 'http://127.0.0.1:8125';
assert.ok(process.env.OLD_ROOT, 'OLD_ROOT is required');

async function serve(cwd) {
  const child = spawn('python3', ['dev-server.py', '8125'], { cwd, stdio: 'ignore' });
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
  server = await serve(process.env.OLD_ROOT);
  browser = await chromium.launch();
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  const page = await context.newPage();
  await page.goto(base);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // The existing release controls the client before the upgrade.
  assert.ok(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL.endsWith('/sw.js')));
  const old = await page.evaluate(async () => {
    const trips = await import('./js/trips.js');
    const trip = await trips.createTrip({ name: 'טיול קיים לפני עדכון', currency: 'ILS' });
    localStorage.setItem('activeTripId', trip.id);
    return trip;
  });
  const oldCaches = await page.evaluate(() => caches.keys());
  assert.ok(oldCaches.some(key => key.startsWith('trip-planner-')));

  server.kill();
  await new Promise(resolve => server.once('exit', resolve));
  server = await serve(process.cwd());

  const load = page.waitForEvent('load', { timeout: 30_000 });
  await page.evaluate(async () => (await navigator.serviceWorker.ready).update());
  await page.waitForFunction(async () => Boolean((await navigator.serviceWorker.getRegistration()).waiting));
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).waiting.postMessage({ type: 'APPLY_UPDATE' }));
  await load; // controllerchange / sw-updated מביאים לטעינה מחדש
  await page.waitForFunction(async () => (await caches.keys()).includes('trip-planner-shell-20261004-preview-1'));
  assert.ok((await page.content()).includes('15 * 60 * 1000'), 'Page did not refresh to new shell');
  const after = await page.evaluate(async () => {
    const trips = await import('./js/trips.js');
    return { trip: await trips.getTrip(localStorage.getItem('activeTripId')), caches: await caches.keys() };
  });
  assert.deepEqual(after.trip, old, 'Trip changed after forced refresh');
  assert.deepEqual(after.caches.filter(k => k.startsWith('trip-planner-')), ['trip-planner-shell-20261004-preview-1']);
  console.log('SW upgrade QA: existing release to offline-map release, explicit activation and page reload, old cache removed and trip preserved');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server?.kill();
}
