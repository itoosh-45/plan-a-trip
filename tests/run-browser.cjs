const { chromium } = require('C:/Users/USER/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async () => {
  const browser = await chromium.launch({headless:true,channel:'chrome'});
  const page = await browser.newPage({viewport:{width:390,height:844}});
  page.on('pageerror', e => console.error('PAGE ERROR:', e.message));
  await page.goto('http://127.0.0.1:8124/test.html');
  await page.waitForFunction(() => document.querySelector('#grand').textContent.includes('סה"כ:'), {timeout:90000});
  console.log(await page.locator('#grand').textContent());
  for (const fail of await page.locator('.bad:not(.total)').allTextContents()) console.error(fail);
  const totals = await page.evaluate(() => window.__testTotals);
  await browser.close();
  process.exitCode = totals.fail ? 1 : 0;
})().catch(e=>{console.error(e);process.exitCode=1;});
