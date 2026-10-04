import { el, sheet, icon, toast, confirmDanger, card } from '../ui.js';
import { noTripCard } from './no-trip.js';
import * as itinerary from '../itinerary.js';
import * as store from '../maps/store.js';
import * as packs from '../maps/packages.js';
import { createMap } from '../maps/render.js';
import { searchPlaces, resolveLink } from '../maps/search.js';

const TYPES = { flight:'שדה תעופה',lodging:'מלון / דירה',attraction:'פעילות',restaurant:'מסעדה',other:'מקום אישי' };
let chosenDate = '';
let chosenPackage = '';
let chosenBasemap = 'streets';

function field(label, node) { return el('div',{class:'field-row'},[el('label',{class:'field-label',text:label}),node]); }
function input(value='', type='text') { return el('input',{class:'field',type,value}); }

async function placeSheet(tripId, point, afterSave) {
  const items = await itinerary.listItems(tripId);
  const existing = !!point.id;
  const title=input(point.title || ''), address=input(point.address || ''), notes=el('textarea',{class:'field',rows:3},[point.notes || '']);
  const date=input(point.date || chosenDate,'date');
  const lat=input(point.lat,'number'), lng=input(point.lng,'number');
  lat.step=lng.step='any';
  const order=input(point.order ?? (await store.listPlaces(tripId)).length,'number'); order.min='0';order.step='1';
  const type=el('select',{class:'field'},Object.entries(TYPES).map(([key,label])=>el('option',{value:key,selected:point.type===key,text:label})));
  const linked=el('select',{class:'field'},[el('option',{value:'',text:'ללא שיוך'}),...items.map(i=>el('option',{value:i.id,selected:i.id===point.itemId,text:`${i.date} · ${i.title}`}))]);
  const role=el('select',{class:'field'},[el('option',{value:'',text:'ללא'}),el('option',{value:'departure',selected:point.role==='departure',text:'המראה'}),el('option',{value:'arrival',selected:point.role==='arrival',text:'נחיתה'})]);
  linked.addEventListener('change',()=>{const item=items.find(i=>i.id===linked.value);if(item){if(!title.value)title.value=item.title;if(!date.value)date.value=item.date;if(TYPES[item.type])type.value=item.type;}});
  const save=el('button',{class:'btn btn-primary btn-block',text:'שמור מקום',onClick:async()=>{
    save.disabled=true;
    try {
      if(linked.value && !items.some(i=>i.id===linked.value))throw new Error('הפריט אינו שייך לטיול');
      const n=Number(order.value);if(!Number.isSafeInteger(n)||n<0)throw new Error('סדר הביקור חייב להיות מספר שלם וחיובי או אפס');
      if(lat.value.trim()===''||lng.value.trim()==='')throw new Error('בחרו מיקום במפה');
      await store.savePlace({...point,tripId,title:title.value,address:address.value,notes:notes.value,date:date.value,type:type.value,itemId:linked.value||null,role:role.value||null,order:n,lat:Number(lat.value),lng:Number(lng.value)});
      dialog.close();await afterSave();toast('המקום נשמר בטלפון','success');
    } catch(error){toast(error.message,'error');}finally{save.disabled=false;}
  }});
  const actions=[save];
  if(existing)actions.push(el('button',{class:'btn btn-danger',html:icon('trash'),'aria-label':'מחק מקום',onClick:async()=>{
    if(await confirmDanger({title:'למחוק את המקום?',body:point.title,confirmLabel:'מחק'})){
      try{await store.deletePlace(point.id);dialog.close();await afterSave();}catch(error){toast(error.message,'error');}
    }
  }}));
  const dialog=sheet({title:existing?'פרטי המקום':'מקום חדש',body:el('div',{},[
    field('שם המקום',title),field('סוג',type),field('כתובת',address),field('הערות',notes),field('תאריך ביקור',date),
    field('שיוך לתכנון',linked),field('המראה / נחיתה',role),field('סדר הביקור',order),
    el('details',{class:'map-coordinates'},[el('summary',{text:'מיקום מדויק'}),field('קו רוחב',lat),field('קו אורך',lng)]),
  ]),actions});
}

function openSearch(tripId, afterSave, pickCenter) {
  const query=input(); query.placeholder='שם מקום, כתובת או קישור Google Maps';
  const results=el('div',{class:'map-search-results',role:'status'});
  let timer, request, sequence=0;
  const display=candidates=>{
    results.replaceChildren(...candidates.map(c=>el('button',{class:'map-search-result',onClick:()=>{dialog.close();placeSheet(tripId,c,afterSave).catch(e=>toast(e.message,'error'));}},[
      el('strong',{text:c.title}),el('span',{class:'sub',text:c.address||''}),
    ])));
    if(!candidates.length)results.textContent='לא נמצאו תוצאות. אפשר לבחור מקום במפה';
  };
  const search=async()=>{
    const value=query.value.trim(), mySequence=++sequence;
    request?.abort();request=new AbortController();
    if(value.length<2){results.replaceChildren();return;}
    results.textContent='מחפש…';
    try{
      if(/^https:\/\//.test(value)){
        const parsed=await resolveLink(value);
        if(mySequence!==sequence||!dialog.panel.isConnected)return;
        if(parsed.coordinates){display([{...parsed.coordinates,title:'מקום מהקישור',address:''}]);return;}
        if(!parsed.query)throw new Error('הקישור מציג אזור בלבד. חפשו מקום או בחרו נקודה במפה');
        display(await searchPlaces(parsed.query,{signal:request.signal}));
      }else{
        const found=await searchPlaces(value,{signal:request.signal});
        if(mySequence===sequence&&dialog.panel.isConnected)display(found);
      }
    }catch(error){if(error.name!=='AbortError'&&mySequence===sequence&&dialog.panel.isConnected)results.textContent=error.message;}
  };
  query.addEventListener('input',()=>{clearTimeout(timer);request?.abort();sequence++;timer=setTimeout(search,350);});
  const dialog=sheet({title:'הוספת מקום',body:el('div',{},[query,results,
    el('p',{class:'sub',text:'אפשר גם ללחוץ לחיצה ממושכת על המפה. חיפוש כתובות דורש אינטרנט.'}),
    el('button',{class:'btn btn-tertiary btn-block',text:'בחר במרכז המפה',onClick:()=>{dialog.close();pickCenter();}}),
  ])});
  query.focus();
}

async function openPackages(onChanged) {
  const [catalog, saved]=await Promise.all([packs.catalog(),store.listPackages()]);
  const rows=el('div',{class:'map-download-list'});
  const countries = new Map();
  const alphabetical = (a,b) => a.localeCompare(b, 'he');
  for (const pack of catalog) {
    const country = pack.country || pack.name;
    if (!countries.has(country)) countries.set(country, []);
    countries.get(country).push(pack);
  }
  const groups = [];
  const render=()=>{
    rows.replaceChildren();
    for (const [country, countryPacks] of [...countries].sort(([a],[b])=>alphabetical(a,b))) {
      const details = el('details', { class: 'map-country' });
      const content = el('div', { class: 'map-country-packages' });
      details.append(el('summary', { class: 'map-country-heading' }, [
        el('span', { class: 'grow', text: country }),
        el('span', { class: 'sub', text: `${countryPacks.length} חבילות` }),
        el('span', { html: icon('chevronDown') }),
      ]), content);
      groups.push({ country, details });
      rows.append(details);
      for(const pack of countryPacks.sort((a,b)=>(a.kind==='country'?0:1)-(b.kind==='country'?0:1)||alphabetical(a.name,b.name))){
      const local=saved.find(p=>p.id===pack.id);
      const status=el('span',{class:'sub',role:'status',text:packs.activeDownloads.has(pack.id)?'ההורדה ממשיכה ברקע':local?.state==='ready'?'מוכן לאופליין':local?.state==='partial'?'הורדה חלקית — ניתן להמשיך':'טרם הורד'});
      const progress=el('progress',{max:1,value:local?.state==='ready'?1:(local?.received||0)/pack.bytes,'aria-label':`הורדת ${pack.name}`});
      let abort;
      const download=el('button',{class:'btn btn-secondary',text:packs.activeDownloads.has(pack.id)?'בטל':local?.state==='ready'?'הורד שוב':'הורד',onClick:async()=>{
        if(abort){abort.abort();return;}
        if(packs.activeDownloads.has(pack.id)){packs.cancelDownload(pack.id);status.textContent='ההורדה נעצרת';download.textContent='המשך הורדה';return;}
        if(!navigator.onLine){toast('התחברו לאינטרנט כדי להוריד מפה','warning');return;}
        abort=new AbortController();download.textContent='בטל';remove.disabled=true;
        try{
          const ready=await packs.downloadPackage(pack,{signal:abort.signal,onProgress:p=>{progress.value=p;status.textContent=`מוריד ${Math.round(p*100)}%`;}});
          const index=saved.findIndex(p=>p.id===pack.id);if(index>=0)saved[index]=ready;else saved.push(ready);
          status.textContent='מוכן לאופליין';await onChanged();
        }catch(error){status.textContent=error.name==='AbortError'?'ההורדה נעצרה — ניתן להמשיך':error.message;}
        finally{abort=null;download.textContent='הורד';remove.disabled=false;}
      }});
      const remove=el('button',{class:'btn btn-danger',html:icon('trash'),'aria-label':`מחק הורדה של ${pack.name}`,onClick:async()=>{
        if(packs.activeDownloads.has(pack.id)){toast('עצרו את ההורדה לפני המחיקה','warning');return;}
        try{await store.deletePackage(pack.id);const index=saved.findIndex(p=>p.id===pack.id);if(index>=0)saved.splice(index,1);progress.value=0;status.textContent='ההורדה נמחקה. המקומות האישיים נשמרו';await onChanged();}
        catch(error){toast(error.message,'error');}
      }});
      content.append(el('article',{class:'map-download-row'},[
        el('div',{class:'map-download-heading'},[el('strong',{text:pack.name}),el('span',{class:'num sub',text:packs.formatBytes(pack.bytes)})]),
        status,progress,el('div',{class:'map-download-actions'},[download,remove]),
      ]));
      }
    }
    if(!catalog.length)rows.textContent='חבילות המפה עדיין בהכנה';
  };
  const search = input();
  search.type = 'search';
  search.placeholder = 'חיפוש מדינה';
  search.setAttribute('aria-label', 'חיפוש מדינה');
  const empty = el('p', { class: 'sub', role: 'status', hidden: true, text: 'לא נמצאה מדינה בשם הזה' });
  search.addEventListener('input', () => {
    const query = search.value.trim().normalize('NFKC').toLocaleLowerCase('he');
    let matches = 0;
    for (const group of groups) {
      const match = group.country.normalize('NFKC').toLocaleLowerCase('he').includes(query);
      group.details.hidden = !match;
      if (match) matches++;
    }
    empty.hidden = matches > 0;
  });
  render();
  sheet({title:'מפות להורדה',body:el('div',{},[el('p',{class:'sub',text:'בחרו מדינה ופתחו את רשימת הערים והאזורים שלה. השאירו את האפליקציה פתוחה עד לסיום ההורדה. אפשר למחוק מפות אחרי הטיול; הנקודות האישיות נשארות.'}),search,empty,rows])});
}

export async function mount(host, tripId) {
  if(!tripId){host.append(noTripCard('פתחו טיול כדי לתכנן את המקומות שלכם במפה.'));return;}
  let places=await store.listPlaces(tripId);
  const wrapper=el('section',{class:'map-page'});
  const mapHost=el('div',{class:'map-canvas','aria-label':'מפת הטיול'});
  const coverage=el('div',{class:'map-coverage',role:'status',text:'הורידו מפה כדי לצפות ברחובות ובמקומות אופליין'});
  const date=el('select',{class:'field','aria-label':'בחירת יום במפה'});
  const packageChoice=el('select',{class:'field','aria-label':'בחירת אזור מפה'});
  if(!navigator.onLine)chosenBasemap='streets';
  const basemapChoice=el('select',{class:'field map-basemap-choice','aria-label':'סוג מפה'},[
    el('option',{value:'streets',text:'רחובות · אופליין אחרי הורדה'}),
    el('option',{value:'satellite',text:'תמונת לוויין · אונליין'}),
    el('option',{value:'hybrid',text:'לוויין ושמות מקומות · אונליין'}),
    el('option',{value:'terrain',text:'תבליט וטופוגרפיה · אונליין'}),
  ]);
  basemapChoice.value=chosenBasemap;
  const list=el('div',{class:'map-place-list'});
  let renderer, frame, disposed=false, fullscreen=false, mapRevision=0;
  const filtered=()=>chosenDate?places.filter(p=>p.date===chosenDate):places;
  function renderList(){
    list.replaceChildren(...filtered().map((place,index)=>el('button',{class:'map-place-row',onClick:()=>placeSheet(tripId,place,reloadPlaces).catch(e=>toast(e.message,'error'))},[
      el('span',{class:'map-place-number num',text:String(index+1)}),el('span',{class:'map-place-copy'},[
        el('strong',{text:place.title}),
        el('span',{class:'sub',text:[TYPES[place.type],place.address].filter(Boolean).join(' · ')}),
        place.date ? el('time',{class:'map-place-date',datetime:place.date,text:place.date}) : null,
      ]),el('span',{html:icon(place.type||'other')}),
    ])));
    if(!places.length)list.append(el('p',{class:'sub',text:'סמנו את שדה התעופה, מקום הלינה וכל מקום שתרצו לבקר בו. לחיצה ממושכת על המפה מוסיפה נקודה.'}));
    else if(!filtered().length)list.append(el('p',{class:'sub',text:'אין מקומות ביום שנבחר'}));
  }
  function renderDates(){
    const dates=[...new Set(places.map(p=>p.date).filter(Boolean))].sort();
    if(chosenDate&&!dates.includes(chosenDate))chosenDate='';
    date.replaceChildren(el('option',{value:'',text:'כל הטיול'}),...dates.map(d=>el('option',{value:d,selected:d===chosenDate,text:d})));
  }
  async function reloadPlaces(){if(disposed)return;places=await store.listPlaces(tripId);renderDates();renderList();renderer?.updatePlaces(filtered());}
  const showPlace=point=>placeSheet(tripId,point,reloadPlaces).catch(e=>toast(e.message,'error'));
  async function restartMap(preserveCamera=false){
    if(disposed)return;
    const revision=++mapRevision;
    const [saved, available]=await Promise.all([store.listPackages(),packs.catalog()]);
    const ready=saved.filter(p=>p.state==='ready');
    if(disposed||revision!==mapRevision)return;
    for(const option of basemapChoice.options)option.disabled=option.value!=='streets'&&!navigator.onLine;
    if(!navigator.onLine&&chosenBasemap!=='streets'){chosenBasemap='streets';basemapChoice.value='streets';toast('ללא אינטרנט מוצגת מפת הרחובות שהורדה');}
    const choices=available.filter(p=>navigator.onLine||ready.some(r=>r.id===p.id));
    if(!ready.length&&!chosenPackage&&navigator.onLine)chosenPackage='thailand';
    packageChoice.replaceChildren(el('option',{value:'',text:'כל המפות שהורדו'}),...choices.map(p=>el('option',{value:p.id,selected:p.id===chosenPackage,text:`${p.name}${ready.some(r=>r.id===p.id)?'':' · אונליין'}`})));
    if(chosenPackage&&!choices.some(p=>p.id===chosenPackage)){chosenPackage='';packageChoice.value='';}
    const selected=chosenPackage?(ready.find(p=>p.id===chosenPackage)||choices.find(p=>p.id===chosenPackage)):null;
    const camera=preserveCamera?renderer?.camera():undefined;
    renderer?.destroy(); renderer=null;
    try{
      renderer=createMap(mapHost,{packages:selected?[selected]:ready,places:filtered(),basemap:chosenBasemap,camera,onPlace:showPlace,onPick:showPlace,onCoverage:(covers,local)=>{
        coverage.hidden=covers&&local;
        if(chosenBasemap!=='streets'){
          coverage.textContent=chosenBasemap==='terrain'?'מפת תבליט אונליין — אינה כלולה בהורדה': 'תמונת לוויין אונליין · רזולוציה כ־10 מטר · אינה כלולה בהורדה';
          return;
        }
        coverage.textContent=covers&&!local?'צפייה אונליין — הורידו את המפה לשימוש ללא אינטרנט':ready.length?'האזור הזה אינו בחבילות שהורדו':'הורידו מפה כדי לצפות ברחובות ובמקומות אופליין';
      },onError:message=>{coverage.hidden=false;coverage.textContent=message;}});
      if(places.length&&!camera)renderer.fitPlaces();
    }catch(error){coverage.hidden=false;coverage.textContent=error.message;}
  }
  const networkChanged=()=>restartMap(true).catch(error=>toast(error.message,'error'));
  window.addEventListener('online',networkChanged);window.addEventListener('offline',networkChanged);
  date.addEventListener('change',()=>{chosenDate=date.value;renderList();renderer?.updatePlaces(filtered());renderer?.fitPlaces();});
  packageChoice.addEventListener('change',()=>{chosenPackage=packageChoice.value;restartMap().catch(e=>toast(e.message,'error'));});
  basemapChoice.addEventListener('change',()=>{chosenBasemap=basemapChoice.value;restartMap(true).catch(e=>toast(e.message,'error'));});
  const full=el('button',{class:'icon-btn','aria-label':'פתח מפה במסך מלא',html:icon('expand'),onClick:()=>{
    fullscreen=!fullscreen;wrapper.classList.toggle('is-fullscreen',fullscreen);document.body.classList.toggle('map-fullscreen-open',fullscreen);
    full.innerHTML=icon(fullscreen?'close':'expand');full.setAttribute('aria-label',fullscreen?'צא ממסך מלא':'פתח מפה במסך מלא');renderer?.resize();
  }});
  const key=e=>{if(e.key==='Escape'&&fullscreen)full.click();};document.addEventListener('keydown',key);
  const downloads=el('button',{class:'btn btn-tertiary',html:`${icon('download')}<span>הורדת מפות</span>`,onClick:()=>openPackages(restartMap).catch(e=>toast(e.message,'error'))});
  wrapper.append(el('div',{class:'map-toolbar'},[el('h2',{class:'screen-title',text:'המפה שלי'}),full]),el('div',{class:'map-selectors'},[date,packageChoice,basemapChoice]),
    el('div',{class:'map-viewport'},[mapHost,coverage]),
    el('div',{class:'map-actions'},[el('button',{class:'btn btn-primary',html:`${icon('plus')}<span>הוסף מקום</span>`,onClick:()=>openSearch(tripId,reloadPlaces,()=>renderer?.pickCenter())}),downloads,
      el('button',{class:'icon-btn','aria-label':'הצג את כל המקומות',html:icon('fit'),onClick:()=>renderer?.fitPlaces()})]),
    el('p',{class:'sub map-route-note',text:'הקו מציג את סדר הביקור שתכננת, ללא ניווט או מעקב מיקום.'}),list);
  renderDates();renderList();host.append(wrapper);
  frame=requestAnimationFrame(()=>restartMap().catch(e=>{coverage.textContent=e.message;}));
  return ()=>{disposed=true;cancelAnimationFrame(frame);renderer?.destroy();document.removeEventListener('keydown',key);window.removeEventListener('online',networkChanged);window.removeEventListener('offline',networkChanged);document.body.classList.remove('map-fullscreen-open');};
}
