const allowedHosts = new Set(['maps.app.goo.gl','goo.gl','www.google.com','google.com','maps.google.com']);
const hits = new Map();
function json(data,status=200) { return Response.json(data,{status,headers:{'Cache-Control':'no-store'}}); }
async function smallBody(request,limit) {
  const reader=request.body?.getReader();if(!reader)return '';
  const bytes=new Uint8Array(limit);let size=0;
  while(true){
    const {done,value}=await reader.read();if(done)break;
    if(size+value.byteLength>limit){await reader.cancel();return null;}
    bytes.set(value,size);size+=value.byteLength;
  }
  return new TextDecoder().decode(bytes.subarray(0,size));
}
export function validMapURL(raw) {
  try { const url=new URL(raw); return url.protocol==='https:' && !url.username && !url.password && (!url.port || url.port==='443') && allowedHosts.has(url.hostname) ? url : null; }
  catch {return null;}
}
export default {
  async fetch(request, env) {
    const url=new URL(request.url);
    if(env.MAP_PACKAGE_SERVICE&&/^\/map-packages\/world-[a-z0-9-]+\/(?:20261003|eox2024-z20261004)\/\d{4}\.bin$/.test(url.pathname)&&['GET','HEAD'].includes(request.method)){
      return fetch(new URL(url.pathname,env.MAP_PACKAGE_SERVICE),{method:request.method});
    }
    if(!url.pathname.startsWith('/api/')){
      // Cloudflare Static Assets canonicalizes /index.html to /. Safari can later
      // reject that followed redirect when the resulting Response is served by
      // a service worker. Resolve the canonical asset inside the Worker so the
      // browser and SW only ever see a direct 200 response.
      const assetUrl = new URL(request.url);
      if (assetUrl.pathname.endsWith('/index.html')) {
        assetUrl.pathname = assetUrl.pathname.slice(0, -'index.html'.length);
      }
      let response = await env.ASSETS.fetch(new Request(assetUrl, request));
      if (response.redirected) {
        const finalUrl = new URL(response.url);
        if (finalUrl.origin === url.origin) {
          response = await env.ASSETS.fetch(new Request(finalUrl, request));
        }
      }
      const headers = new Headers(response.headers);
      if (url.pathname.endsWith('/sw.js')) headers.set('Cache-Control','no-store, no-cache, must-revalidate');
      return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
    }
    if(['/api/map-packages','/api/map-package','/api/prepare-map-package'].includes(url.pathname)){
      // A persistent package builder is required; a Worker cannot run the CLI.
      // Configure its trusted HTTPS origin separately before production.
      if(!env.MAP_PACKAGE_SERVICE)return json({error:'שרת הכנת המפות לא הוגדר'},503);
      if(url.pathname==='/api/prepare-map-package'&&request.method!=='POST')return json({error:'שיטה אינה נתמכת'},405);
      if(url.pathname!=='/api/prepare-map-package'&&request.method!=='GET')return json({error:'שיטה אינה נתמכת'},405);
      const body=request.method==='POST'?await smallBody(request,256):undefined;
      if(body===null)return json({error:'בקשה ארוכה מדי'},400);
      const target=new URL(url.pathname+url.search,env.MAP_PACKAGE_SERVICE);
      return fetch(target,{method:request.method,headers:{'Content-Type':'application/json'},body});
    }
    const identity=request.headers.get('CF-Connecting-IP')||'anonymous';
    const now=Date.now();const entry=hits.get(identity)||{time:now,count:0};
    if(now-entry.time>60000){entry.time=now;entry.count=0;}entry.count++;hits.set(identity,entry);
    if(hits.size>2000)for(const [key,value] of hits){if(now-value.time>60000)hits.delete(key);}
    if(entry.count>15)return json({error:'חכו מעט לפני חיפוש נוסף'},429);
    try{
      if(url.pathname==='/api/map-search'&&request.method==='GET'){
        const q=(url.searchParams.get('q')||'').trim();if(q.length<2||q.length>160)return json({places:[]});
        const target=new URL('https://photon.komoot.io/api/');target.searchParams.set('q',q);target.searchParams.set('limit','6');target.searchParams.set('lang','en');
        const response=await fetch(target,{signal:AbortSignal.timeout(8000),headers:{'User-Agent':'PlanATripPreview/1.0'}});
        if(!response.ok)return json({error:'החיפוש אינו זמין'},503);
        const data=await response.json();
        return json({places:(data.features||[]).map(f=>({title:f.properties.name||f.properties.street||q,address:[f.properties.street,f.properties.housenumber,f.properties.city,f.properties.country].filter(Boolean).join(', '),lat:f.geometry.coordinates[1],lng:f.geometry.coordinates[0]}))});
      }
      if(url.pathname==='/api/resolve-map-link'&&request.method==='POST'){
        if(Number(request.headers.get('Content-Length')||0)>2048)return json({error:'קישור ארוך מדי'},400);
        const body=await request.text();if(body.length>2048)return json({error:'קישור ארוך מדי'},400);
        let target=validMapURL(JSON.parse(body).url);if(!target)return json({error:'קישור לא מורשה'},400);
        for(let n=0;n<5;n++){
          const response=await fetch(target,{method:'GET',redirect:'manual',signal:AbortSignal.timeout(5000)});
          const redirect=response.headers.get('Location');await response.body?.cancel();
          if(response.status<300||response.status>=400||!redirect)return json({url:target.href});
          target=validMapURL(new URL(redirect,target).href);if(!target)return json({error:'הפניה לא מורשית'},400);
        }
        return json({error:'יותר מדי הפניות'},400);
      }
      return json({error:'לא נמצא'},404);
    }catch{return json({error:'השירות אינו זמין כרגע'},503);}
  },
};
