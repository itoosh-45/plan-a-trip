const {chromium}=require('C:/Users/USER/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
(async()=>{
  const browser=await chromium.launch({headless:true,channel:'chrome',args:['--enable-unsafe-swiftshader']});
  try {
    const context=await browser.newContext({viewport:{width:390,height:844}});
    const page=await context.newPage(),errors=[],remoteTiles=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('Failed to load resource'))errors.push(m.text());});
    page.on('request',r=>{if(r.url().startsWith('https://tiles.maps.eox.at/'))remoteTiles.push(r.url());});
    await page.goto('http://127.0.0.1:8125');
    const tripId=await page.evaluate(async()=>{
      const maps=await import('./js/maps/store.js'),packages=await import('./js/maps/packages.js'),trips=await import('./js/trips.js'),app=await import('./js/app.js');
      const trip=await trips.createTrip({name:'בדיקת לוויין אופליין',startDate:'2026-11-01',endDate:'2026-11-10'});
      await maps.savePlace({tripId:trip.id,title:'מלון לבדיקה',lat:13.7563,lng:100.5018,type:'lodging',date:'2026-11-01',notes:'מידע שנשמר במפה'});
      const catalog=await packages.catalog();
      await packages.downloadPackage(catalog.find(p=>p.id==='bangkok-satellite'));
      await packages.downloadPackage(catalog.find(p=>p.id==='bangkok'));
      app.setActiveTrip(trip.id);app.navigate('map');await navigator.serviceWorker.ready;return trip.id;
    });
    await page.waitForSelector('.map-pin');
    await context.setOffline(true);
    await page.reload();await page.getByRole('button',{name:'מפה',exact:true}).click();
    await page.waitForSelector('.map-pin');
    await page.getByRole('button',{name:'בחר סוג מפה',exact:true}).click();await page.getByRole('combobox',{name:'סוג מפה',exact:true}).selectOption('satellite');
    await page.waitForSelector('.map-pin');await page.waitForTimeout(2000);
    assert.match(await page.locator('.map-coverage').textContent(),/לוויין מהטלפון/);
    assert.equal(remoteTiles.length,0,'Downloaded imagery must never request remote tiles');
    fs.mkdirSync('scratch/screenshots',{recursive:true});
    await page.screenshot({path:'scratch/screenshots/map-satellite-offline.png'});
    await page.getByRole('button',{name:'פתח מפה במסך מלא',exact:true}).click();
    await page.screenshot({path:'scratch/screenshots/map-satellite-offline-fullscreen.png'});
    await page.getByRole('button',{name:'צא ממסך מלא',exact:true}).click();
    await page.getByRole('button',{name:'בחר סוג מפה',exact:true}).click();await page.getByRole('combobox',{name:'סוג מפה',exact:true}).selectOption('hybrid');
    await page.waitForSelector('.map-pin');await page.waitForTimeout(1000);
    assert.equal(await page.locator('.map-pin').count(),1);
    assert.match(await page.locator('.map-coverage').textContent(),/לוויין מהטלפון/);
    assert.equal(remoteTiles.length,0);
    await page.getByRole('button',{name:'מלון לבדיקה',exact:true}).click();
    assert.equal(await page.locator('textarea').inputValue(),'מידע שנשמר במפה');
    await page.getByRole('button',{name:'סגור',exact:true}).click();
    await page.evaluate(async tripId=>{
      const maps=await import('./js/maps/store.js');
      const before=(await maps.listPlaces(tripId)).length;
      await maps.deletePackage('bangkok-satellite');
      if(await maps.getChunk('bangkok-satellite',0))throw new Error('Satellite chunks remained after deletion');
      if(!(await maps.getPackage('bangkok')))throw new Error('Deleting satellite also deleted streets');
      if((await maps.listPlaces(tripId)).length!==before)throw new Error('Deleting satellite deleted personal places');
    },tripId);
    assert.deepEqual(errors,[]);
    console.log('offline satellite + hybrid, fullscreen, no external tile requests, separate deletion: passed');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
