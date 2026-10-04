const {chromium}=require('C:/Users/USER/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
(async()=>{
  const browser=await chromium.launch({headless:true,channel:'chrome',args:['--enable-unsafe-swiftshader']});
  try {
    const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('Failed to load resource'))errors.push(m.text());});
    await page.goto('http://127.0.0.1:8125');await page.getByRole('button',{name:'אחר כך',exact:true}).click();
    await page.evaluate(async()=>{
      const trips=await import('./js/trips.js'),maps=await import('./js/maps/store.js'),app=await import('./js/app.js');
      const trip=await trips.createTrip({name:'בדיקת מדינה מהקטלוג העולמי',startDate:'2026-11-01',endDate:'2026-11-10'});
      await maps.savePlace({tripId:trip.id,title:'ולטה',lat:35.8992,lng:14.5141,type:'attraction'});
      app.setActiveTrip(trip.id);app.navigate('map');await navigator.serviceWorker.ready;
    });
    await page.waitForSelector('.map-pin');
    await page.getByRole('button',{name:'הורדת מפות',exact:true}).click();
    await page.waitForSelector('.map-country-heading');
    assert.ok(await page.locator('.map-country').count()>=250);
    await page.getByRole('searchbox',{name:'חיפוש מפות'}).fill('Malta');
    await page.getByRole('combobox',{name:'סוג מפה להורדה'}).selectOption('streets');
    const row=page.locator('.map-country:visible .map-download-row:visible');
    assert.equal(await row.count(),1);
    await row.getByRole('button',{name:'הורד',exact:true}).click();
    await row.getByText('מוכן לאופליין',{exact:true}).waitFor({timeout:60000});
    await page.getByRole('combobox',{name:'סוג מפה להורדה'}).selectOption('satellite');
    assert.equal(await row.count(),1);
    const prepare=row.getByRole('button',{name:'הכן חבילה',exact:true});
    if(await prepare.count()){
      await prepare.click();
      await row.getByText('החבילה מוכנה. בדקו את הגודל ולחצו הורד כדי לשמור בטלפון',{exact:true}).waitFor({timeout:180000});
      assert.equal(await page.evaluate(async()=>!!(await (await import('./js/maps/store.js')).getPackage('world-mlt-satellite'))),false,'Preparation must not download to the phone before size review');
    }
    assert.match(await row.locator('.map-download-heading .num').textContent(),/MB/);
    await row.getByRole('button',{name:'הורד',exact:true}).click();
    await row.getByText('מוכן לאופליין',{exact:true}).waitFor({timeout:60000});
    await page.getByRole('button',{name:'סגור',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('[aria-label="סוג מפה"]')?.value==='satellite');
    await context.setOffline(true);await page.reload();
    await page.getByRole('button',{name:'מפה',exact:true}).click();await page.waitForSelector('.map-pin');
    await page.getByRole('button',{name:'בחר סוג מפה',exact:true}).click();await page.getByRole('combobox',{name:'סוג מפה',exact:true}).selectOption('satellite');
    await page.waitForSelector('.map-pin');await page.waitForTimeout(1500);
    assert.match(await page.locator('.map-coverage').textContent(),/לוויין מהטלפון/);
    await page.screenshot({path:'scratch/screenshots/map-world-malta-offline.png'});
    await page.getByRole('button',{name:'בחר סוג מפה',exact:true}).click();await page.getByRole('combobox',{name:'סוג מפה',exact:true}).selectOption('streets');
    await page.waitForSelector('.map-pin');await page.waitForTimeout(1500);
    await page.screenshot({path:'scratch/screenshots/map-world-malta-streets-offline.png'});
    assert.deepEqual(errors,[]);
    console.log('world country search, street + satellite preparation/download, exact size before download and offline reload: passed');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
