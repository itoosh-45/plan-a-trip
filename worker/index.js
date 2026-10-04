const allowedHosts = new Set(['maps.app.goo.gl','goo.gl','www.google.com','google.com','maps.google.com']);
const hits = new Map();
function json(data,status=200) { return Response.json(data,{status,headers:{'Cache-Control':'no-store'}}); }
export function validMapURL(raw) {
  try { const url=new URL(raw); return url.protocol==='https:' && !url.username && !url.password && (!url.port || url.port==='443') && allowedHosts.has(url.hostname) ? url : null; }
  catch {return null;}
}
export default {
  async fetch(request, env) {
    const url=new URL(request.url);
    if(!url.pathname.startsWith('/api/'))return env.ASSETS.fetch(request);
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
