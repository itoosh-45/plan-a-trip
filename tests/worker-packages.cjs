const assert=require('node:assert/strict');
(async()=>{
  const worker=(await import('../worker/index.js')).default;
  const calls=[];global.fetch=async(url,options)=>{calls.push({url:String(url),options});return Response.json({state:'ready'});};
  const assets={fetch:async()=>new Response('asset')};
  let response=await worker.fetch(new Request('https://app.test/api/prepare-map-package',{method:'POST',body:'{"id":"world-mlt"}'}),{ASSETS:assets});
  assert.equal(response.status,503);assert.equal(calls.length,0);
  const env={ASSETS:assets,MAP_PACKAGE_SERVICE:'https://trusted-builder.test'};
  response=await worker.fetch(new Request('https://app.test/api/prepare-map-package',{method:'POST',body:'x'.repeat(257)}),env);
  assert.equal(response.status,400);assert.equal(calls.length,0);
  response=await worker.fetch(new Request('https://app.test/api/prepare-map-package',{method:'POST',body:'{"id":"world-mlt"}'}),env);
  assert.equal(response.status,200);assert.equal(calls[0].url,'https://trusted-builder.test/api/prepare-map-package');
  await worker.fetch(new Request('https://app.test/map-packages/world-mlt/20261003/0000.bin'),env);
  assert.equal(calls[1].url,'https://trusted-builder.test/map-packages/world-mlt/20261003/0000.bin');
  response=await worker.fetch(new Request('https://app.test/map-packages/bangkok/20261003/0000.bin'),env);
  assert.equal(await response.text(),'asset');assert.equal(calls.length,2);
  console.log('Worker validates preparation size and forwards world archives to the configured builder: passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
