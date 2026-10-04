import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { chromium, webkit } from 'playwright';

const base = 'http://127.0.0.1:8123';
const browserName = process.env.BROWSER || 'chromium';
const server = spawn('python3', ['dev-server.py', '8123'], { stdio: 'ignore' });
let browser;
let page;

async function ready() {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(base)).ok) return; } catch { /* server starting */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Local server did not start');
}

async function noHorizontalOverflow(page, label) {
  const widths = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  assert.ok(widths.document <= widths.viewport + 1,
    `${label}: horizontal overflow ${JSON.stringify(widths)}`);
}

try {
  await ready();
  browser = await ({ chromium, webkit })[browserName].launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  page = await context.newPage();

  await page.goto(`${base}/test.html`);
  await page.locator('#grand').getByText(/עברו, \d+ נכשלו/).waitFor({ timeout: 120_000 });
  const summary = await page.locator('#grand').innerText();
  const failed = await page.locator('.bad:not(.total)').allTextContents();
  console.log(summary);
  if (failed.length) console.error(failed.join('\n'));
  assert.match(summary, /\d+ עברו, 0 נכשלו/);
  assert.ok(Number(summary.match(/(\d+) עברו/)?.[1]) > 100);

  await page.goto(base);
  await mkdir('qa-artifacts', { recursive: true });
  await page.locator('.welcome').getByRole('button', { name: 'יצירת טיול', exact: true }).waitFor();
  await page.waitForTimeout(250); // צילום אחרי אנימציית הכניסה (180ms)
  await page.screenshot({ path: `qa-artifacts/${browserName}-welcome.png` });
  await page.locator('.welcome').getByRole('button', { name: 'יצירת טיול', exact: true }).click();
  await page.locator('.sheet input[type="text"]').first().waitFor();
  assert.equal(await page.locator('.welcome').count(), 0);
  await page.waitForTimeout(250); // צילום אחרי אנימציית ה־sheet (200ms)
  const panelRect = await page.locator('.sheet').boundingBox();
  console.log(`${browserName} wizard bounds: ${JSON.stringify(panelRect)}`);
  assert.ok(panelRect && panelRect.y < 812 && panelRect.y + panelRect.height > 0,
    'Wizard sheet must intersect the viewport when opened');
  await page.screenshot({ path: `qa-artifacts/${browserName}-wizard.png` });
  await page.locator('.sheet input[type="text"]').first().fill('טיול בדיקה');
  await page.getByRole('button', { name: 'צור והמשך' }).click();
  await page.getByRole('button', { name: 'דלג' }).click();
  await page.getByRole('button', { name: 'דלג' }).click();
  await page.getByRole('button', { name: 'סיום' }).click();
  assert.equal(await page.locator('.sheet').count(), 0);
  await page.reload();
  assert.equal(await page.locator('.welcome').count(), 0);
  assert.equal(await page.locator('#nav button').count(), 6);

  const seeded = await page.evaluate(async () => {
    const trips = await import('./js/trips.js');
    const it = await import('./js/itinerary.js');
    const expenses = await import('./js/expenses.js');
    const prep = await import('./js/prep.js');
    const trip = (await trips.listTrips())[0];
    const general = await it.generalSegment(trip.id);
    await trips.updateTrip({ ...trip, startDate: '2027-02-16', endDate: '2027-02-20' });
    await expenses.saveExpense(trip.id, {
      amount: 100, currency: 'ILS', kind: 'expense', segmentId: general.id, note: 'הוצאה כללית',
    });
    await prep.saveTask(trip.id, {
      title: 'משימה ארוכה במיוחד לבדיקת גלישת שורה במסך צר', stage: 'before',
      category: prep.OTHER, urgency: 'normal', segmentId: general.id,
    });
    return { tripId: trip.id, generalId: general.id };
  });

  for (const width of [320, 375, 430]) {
    await page.setViewportSize({ width, height: 812 });
    await page.reload();
    await page.getByText('משימה ארוכה במיוחד לבדיקת גלישת שורה במסך צר').waitFor();
    await noHorizontalOverflow(page, `prep ${width}`);
    assert.equal(await page.locator('.task .title').first().evaluate(e => getComputedStyle(e).fontSize), '16px');
    if (width === 320 || width === 430) {
      await page.screenshot({ path: `qa-artifacts/${browserName}-prep-${width}.png` });
    }
  }

  // ״כללי״ נשאר רשומה קיימת אך מוצג תחת היעד היחיד.
  await page.evaluate(async () => {
    const it = await import('./js/itinerary.js');
    const trips = await import('./js/trips.js');
    const trip = (await trips.listTrips())[0];
    await it.saveSegment(trip.id, {
      city: 'גודאורי', startDate: '2027-02-16', endDate: '2027-02-18', currency: 'ILS',
    });
  });
  await page.reload();
  await page.locator('#nav button[data-key="expenses"]').click();
  await page.getByText('הוצאה כללית').waitFor();
  assert.equal(await page.locator('#screen .chip').filter({ hasText: 'כללי' }).count(), 0);
  await page.locator('#nav button[data-key="plan"]').click();
  await page.getByRole('button', { name: 'לפי יעדים' }).click();
  assert.equal(await page.locator('#screen .group-head').filter({ hasText: 'כללי' }).count(), 0);

  await page.evaluate(async () => {
    const it = await import('./js/itinerary.js');
    const trips = await import('./js/trips.js');
    const trip = (await trips.listTrips())[0];
    await it.saveSegment(trip.id, {
      city: 'טביליסי', startDate: '2027-02-19', endDate: '2027-02-20', currency: 'ILS',
    });
  });
  await page.reload();
  await page.locator('#nav button[data-key="expenses"]').click();
  await page.locator('#screen .chip').filter({ hasText: 'כללי' }).waitFor();
  const preserved = await page.evaluate(async ({ tripId, generalId }) => {
    const it = await import('./js/itinerary.js');
    const expenses = await import('./js/expenses.js');
    return {
      general: (await it.generalSegment(tripId))?.id,
      expense: (await expenses.list(tripId)).find(e => e.note === 'הוצאה כללית')?.segmentId,
    };
  }, seeded);
  assert.deepEqual(preserved, { general: seeded.generalId, expense: seeded.generalId });

  // WebKit של Playwright מחזיר שגיאה פנימית בטעינה חוזרת דרך Service Worker ללא רשת.
  if (browserName === 'chromium') {
    const offlineContext = await browser.newContext({ viewport: { width: 375, height: 812 }, serviceWorkers: 'allow' });
    const offlinePage = await offlineContext.newPage();
    await offlinePage.goto(base);
    await offlinePage.evaluate(() => navigator.serviceWorker.ready);
    await offlinePage.reload();
    await offlineContext.setOffline(true);
    await offlinePage.reload();
    assert.equal(await offlinePage.locator('#nav button').count(), 6);
    await offlineContext.setOffline(false);
    await offlineContext.close();
  }

  console.log(`Browser QA (${browserName}): suite, onboarding, 320/375/430 widths, destinations and data preservation passed${browserName === 'chromium' ? ', offline passed' : ''}`);
} catch (error) {
  console.error(error);
  if (page) {
    await mkdir('qa-artifacts', { recursive: true });
    await page.screenshot({ path: 'qa-artifacts/failure.png', fullPage: true }).catch(() => {});
  }
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
}
