import { suite, assertEqual, assertTrue, assertThrows } from './harness.js';
import * as maps from '../js/maps/store.js';
import * as db from '../js/db.js';
import * as trips from '../js/trips.js';
import * as backup from '../js/backup.js';
import { getLocalSource, downloadPackage } from '../js/maps/packages.js';
import { parseGoogleMapsLink } from '../js/maps/search.js';

export default async function() {
  const s=suite('מפות ושמירה מופרדת');
  await db.useTestDatabase();await maps.useTestDatabase();await maps.clearPlaces();
  s.test('נקודות אינן נכנסות לגיבוי מלא או גיבוי טיול',async()=>{
    await db.wipe();const trip=await trips.createTrip({name:'מפה',currency:'ILS'});
    await maps.savePlace({tripId:trip.id,title:'map-only-sentinel',lat:31.78,lng:35.22});
    for(const result of [await backup.buildBackup(),await backup.buildBackup(trip.id)]) {
      assertTrue(!result.json.includes('map-only-sentinel'));
      assertTrue(!result.json.includes('trip-planner-maps'));
    }
  });
  s.test('מחיקת טיול אינה מוחקת נקודות של טיול אחר',async()=>{
    const a=await trips.createTrip({name:'A'}),b=await trips.createTrip({name:'B'});
    await maps.savePlace({tripId:a.id,title:'A',lat:1,lng:1});
    await maps.savePlace({tripId:b.id,title:'B',lat:2,lng:2});
    await trips.removeTrip(a.id);assertEqual((await maps.listPlaces(a.id)).length,0);assertEqual((await maps.listPlaces(b.id)).length,1);
  });
  s.test('קורא הארכיון קורא מעבר לגבול מקטע ומזהה מקטע חסר',async()=>{
    const meta={id:'range-test',version:'test',bytes:8,chunks:[{index:0,bytes:4},{index:1,bytes:4}]};
    await maps.putChunk(meta.id,0,new Blob([new Uint8Array([0,1,2,3])]));
    await maps.putChunk(meta.id,1,new Blob([new Uint8Array([4,5,6,7])]));
    const source=getLocalSource(meta);
    assertEqual([...new Uint8Array((await source.getBytes(2,5)).data)],[2,3,4,5,6]);
    assertEqual([...new Uint8Array((await source.getBytes(7,1)).data)],[7]);
    await maps.deletePackage(meta.id);await assertThrows(()=>source.getBytes(0,1));
  });
  s.test('הורדה פגומה או שבוטלה לעולם אינה מוכנה לאופליין',async()=>{
    const original=window.fetch;
    try {
      window.fetch=async()=>new Response(new Uint8Array([1,2,3,4]));
      const meta={id:'broken-download',version:'test',bytes:4,chunks:[{index:0,bytes:4,sha256:'incorrect',url:'./fixture'}]};
      await assertThrows(()=>downloadPackage(meta));assertEqual((await maps.getPackage(meta.id)).state,'partial');
      const abort=new AbortController();abort.abort();
      await assertThrows(()=>downloadPackage({...meta,id:'cancelled-download'},{signal:abort.signal}));
      assertEqual((await maps.getPackage('cancelled-download')).state,'partial');
    }finally{window.fetch=original;}
  });
  s.test('הורדה מאומתת מוכנה ויכולה להיקרא בלי רשת',async()=>{
    const original=window.fetch;
    const data=new Uint8Array([2,4,6,8]);const digest=await crypto.subtle.digest('SHA-256',data);
    const hash=[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
    const meta={id:'good-download',version:'test',bytes:4,chunks:[{index:0,bytes:4,sha256:hash,url:'./fixture'}]};
    try {window.fetch=async()=>new Response(data);await downloadPackage(meta);window.fetch=()=>{throw new Error('offline');};
      assertEqual((await maps.getPackage(meta.id)).state,'ready');assertEqual([...new Uint8Array((await getLocalSource(meta).getBytes(0,4)).data)],[2,4,6,8]);
    }finally{window.fetch=original;}
  });
  s.test('קישור מרכז תצוגה אינו נקודה מדויקת וקישור זר נדחה',async()=>{
    assertEqual(parseGoogleMapsLink('https://www.google.com/maps?query=31.78,35.22'),{coordinates:{lat:31.78,lng:35.22}});
    assertTrue(parseGoogleMapsLink('https://www.google.com/maps/@31.78,35.22,12z').needsManualSelection);
    await assertThrows(()=>parseGoogleMapsLink('https://example.com/maps?query=1,2'));
    await assertThrows(()=>parseGoogleMapsLink('http://google.com/maps?query=1,2'));
  });
  s.test('שחזור לא תקין שומר נקודות ושחזור תקין מנקה תכנון בלבד',async()=>{
    const trip=await trips.createTrip({name:'restore-map'});
    await maps.savePlace({tripId:trip.id,title:'restore-place',lat:3,lng:3});
    await maps.putPackage({id:'retained-archive',state:'ready'});
    await assertThrows(()=>backup.restore({stores:{unknown:[]}}));assertEqual((await maps.listPlaces(trip.id)).length,1);
    const dump=await db.exportAll();await backup.restore(dump);
    assertEqual((await maps.listPlaces(trip.id)).length,0);assertEqual((await maps.getPackage('retained-archive')).state,'ready');
  });
  s.test('מיקום לא תקין נדחה בלי כתיבה',async()=>{
    for(const [lat,lng]of [[NaN,1],[86,1],[1,181]])await assertThrows(()=>maps.savePlace({tripId:'test',title:'bad',lat,lng}));
  });
  s.test('שחזור עם מזהה פגום או רשומה לא ניתנת לשמירה משאיר את הנתונים',async()=>{
    await db.wipe();const trip=await trips.createTrip({name:'retained-on-import-error'});
    await assertThrows(()=>db.importAll({stores:{trips:[{id:{bad:true},name:'bad'}]}},'replace'));
    assertEqual((await db.all(db.STORES.trips))[0].id,trip.id);
    await assertThrows(()=>db.importAll({stores:{trips:[{id:'valid-id',nonCloneable:()=>{}}]}},'replace'));
    assertEqual((await db.all(db.STORES.trips))[0].id,trip.id);
  });
  await s.done();
}
