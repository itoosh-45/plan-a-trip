const {chromium}=require('C:/Users/USER/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();
  await page.request.post('http://127.0.0.1:8126/__test/version/1');
  await page.goto('http://127.0.0.1:8126');await page.waitForLoadState('networkidle');
  await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  const tripId=await page.evaluate(async()=>{
    const trips=await import('./js/trips.js'),prep=await import('./js/prep.js'),maps=await import('./js/maps/store.js');
    const trip=await trips.createTrip({name:'update-sentinel'});
    await prep.saveTask(trip.id,{title:'חולצות',quantity:5});
    await maps.savePlace({tripId:trip.id,title:'map-update-sentinel',lat:1,lng:1});
    await maps.putPackage({id:'sentinel',state:'ready'});await maps.putChunk('sentinel',0,new Blob(['kept']));
    await caches.open('unrelated-sentinel-cache');return trip.id;
  });
  await page.request.post('http://127.0.0.1:8126/__test/version/2');
  const state=await page.evaluate(async()=>(await import('./js/updates.js')).checkForUpdate());
  if(state!=='available')throw new Error('New version was not detected: '+state);
  const loaded=page.waitForEvent('load');await page.evaluate(async()=>(await import('./js/updates.js')).applyUpdate());await loaded;
  const retained=await page.evaluate(async tripId=>{
    const prep=await import('./js/prep.js'),maps=await import('./js/maps/store.js');
    return {quantity:(await prep.listTasks(tripId))[0].quantity,places:(await maps.listPlaces(tripId)).length,chunk:await (await maps.getChunk('sentinel',0)).text(),unrelated:await caches.has('unrelated-sentinel-cache')};
  },tripId);
  console.log('update retained:',JSON.stringify(retained));
  if(JSON.stringify(retained)!==JSON.stringify({quantity:5,places:1,chunk:'kept',unrelated:true}))throw new Error('Update lost stored data');
  await page.request.post('http://127.0.0.1:8126/__test/version/broken');
  await page.evaluate(async()=>{try{await (await import('./js/updates.js')).checkForUpdate();}catch{}});
  await page.waitForTimeout(1000);
  const keys=await page.evaluate(()=>caches.keys());
  if(keys.includes('trip-planner-shell-update-test-broken'))throw new Error('Partial update cache was retained');
  if(!keys.includes('trip-planner-shell-update-test-2'))throw new Error('Previous good shell was deleted');
  await page.context().setOffline(true);await page.reload();await page.waitForSelector('#nav button');
  console.log('failed-update offline shell: retained');await browser.close();
})().catch(error=>{console.error(error);process.exitCode=1;});
