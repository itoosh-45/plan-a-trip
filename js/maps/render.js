import { getLocalSource, getRemoteSource } from './packages.js';

const archives = new Map();
let installed = false;
export function createMap(container, { packages, satellitePackages = [], places, basemap = 'streets', camera, onPlace, onPick, onCoverage, onError }) {
  const gl = window.maplibregl, pm = window.pmtiles;
  if (!gl || !pm) throw new Error('רכיבי המפה אינם זמינים. פתחו את האפליקציה שוב עם אינטרנט');
  if (!installed) {
    gl.addProtocol('tripmap', async (params, abort) => {
      const match = params.url.match(/^tripmap:\/\/([^/]+)\/(\d+)\/(\d+)\/(\d+)$/);
      if (!match) throw new Error('כתובת מפה אינה תקינה');
      const archive = archives.get(match[1]);
      if (!archive) return { data: new Uint8Array() };
      const tile = await archive.getZxy(Number(match[2]), Number(match[3]), Number(match[4]), abort.signal);
      return { data: tile ? new Uint8Array(tile.data) : new Uint8Array() };
    });
    installed = true;
  }
  const colors = getComputedStyle(document.documentElement);
  const color = name => colors.getPropertyValue(name).trim();
  const sources = {}, layers = [{ id: 'background', type: 'background', paint: { 'background-color': color('--map-land') } }];
  const raster = basemap !== 'streets';
  const localImagery = basemap !== 'terrain' && satellitePackages.length > 0;
  if (raster && navigator.onLine) {
    const terrain = basemap === 'terrain';
    const layer = terrain ? 'terrain-light_3857' : 's2cloudless-2024_3857';
    sources.imagery = { type:'raster', tileSize:256, maxzoom:13,
      tiles:[`https://tiles.maps.eox.at/wmts/1.0.0/${layer}/default/g/{z}/{y}/{x}.jpg`],
      attribution:terrain
        ? 'Data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors and <a href="https://maps.eox.at/#data">others</a> · Rendering © <a href="https://maps.eox.at/">EOX::Maps</a>'
        : '<a href="https://cloudless.eox.at/">EOxCloudless</a> by <a href="https://eox.at/">EOX IT Services GmbH</a> (Contains modified Copernicus Sentinel data 2024) · <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/">CC BY-NC-SA 4.0</a>',
    };
    layers.push({id:'imagery',type:'raster',source:'imagery',layout:{visibility:localImagery?'none':'visible'},paint:{'raster-fade-duration':0}});
  }
  if (raster && localImagery) {
    // Overview regions first, then city detail. Raster maxzoom lets MapLibre
    // overzoom parent imagery correctly instead of stretching the wrong tile.
    for (const pack of [...satellitePackages].sort((a,b)=>a.maxZoom-b.maxZoom)) {
      archives.set(pack.id,new pm.PMTiles(getLocalSource(pack)));
      sources[pack.id]={type:'raster',tileSize:256,tiles:[`tripmap://${pack.id}/{z}/{x}/{y}`],bounds:pack.bounds,minzoom:pack.minZoom,maxzoom:pack.maxZoom,
        attribution:'<a href="https://cloudless.eox.at/">EOxCloudless</a> by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2024) · <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/">CC BY-NC-SA 4.0</a>'};
      layers.push({id:`${pack.id}-imagery`,type:'raster',source:pack.id,paint:{'raster-fade-duration':0}});
    }
  }
  // Broad regions first; detailed cities draw above them. Archives remain immutable.
  const sorted = (basemap === 'satellite' ? [] : [...packages]).sort((a,b) => (b.bounds[2]-b.bounds[0])*(b.bounds[3]-b.bounds[1]) - (a.bounds[2]-a.bounds[0])*(a.bounds[3]-a.bounds[1]));
  for (const pack of sorted) {
    archives.set(pack.id, new pm.PMTiles(pack.state === 'ready' ? getLocalSource(pack) : getRemoteSource(pack)));
    sources[pack.id] = { type: 'vector', tiles: [`tripmap://${pack.id}/{z}/{x}/{y}`], bounds: pack.bounds, minzoom:pack.minZoom, maxzoom:pack.maxZoom, attribution:'© OpenStreetMap · Protomaps' };
    const add = (suffix, type, sourceLayer, paint, layout, minzoom = 0) => layers.push({ id: `${pack.id}-${suffix}`, type, source:pack.id, 'source-layer':sourceLayer, paint, ...(layout ? {layout} : {}), minzoom });
    if (!raster) {
    add('earth', 'fill', 'earth', {'fill-color':color('--map-land')});
    add('landuse', 'fill', 'landuse', {'fill-color':color('--map-green'), 'fill-opacity':0.45});
    add('water', 'fill', 'water', {'fill-color':color('--map-water')});
    add('buildings','fill','buildings', {'fill-color':color('--map-building'), 'fill-opacity':0.7}, null,14);
    add('roads-casing','line','roads', {'line-color':color('--map-road-edge'),'line-width':['interpolate',['linear'],['zoom'],7,1,15,5]});
    add('roads','line','roads', {'line-color':color('--map-road'),'line-width':['interpolate',['linear'],['zoom'],7,0.7,15,3]});
    }
    add('boundaries','line','boundaries', {'line-color':color('--map-boundary'),'line-width':1,'line-dasharray':[3,3]});
    const labels = { 'text-field':['coalesce',['get','name:en'],['get','name']], 'text-font':['Arial'], 'text-size':12, 'text-max-width':8 };
    const ink = {'text-color':color('--color-text'),'text-halo-color':color('--map-land'),'text-halo-width':1.5};
    // No glyph URL: MapLibre 5.11+ renders local fonts, including offline system scripts.
    add('places','symbol','places', ink, labels,3);
    add('pois','symbol','pois', ink, {...labels,'text-size':11},14);
    add('street-labels','symbol','roads', ink, {...labels,'symbol-placement':'line','text-size':10},14);
  }
  sources.route = { type:'geojson', data:{type:'FeatureCollection',features:[]} };
  layers.push({id:'planned-route', type:'line',source:'route',paint:{'line-color':color('--color-highlight'),'line-width':3,'line-dasharray':[1.5,2]}});
  const preferred=packages[0]||satellitePackages[0];
  const center = places.length ? [places[0].lng,places[0].lat] : preferred ? [(preferred.bounds[0]+preferred.bounds[2])/2,(preferred.bounds[1]+preferred.bounds[3])/2] : [100.5,13.75];
  const map = new gl.Map({container,style:{version:8,sources,layers},center,zoom:preferred?6:3,...camera, attributionControl:false, renderWorldCopies:false});
  map.addControl(new gl.NavigationControl({showCompass:false}), 'top-left');
  map.addControl(new gl.AttributionControl({compact:!raster}), 'bottom-left');
  let markers = [], currentPlaces = places, pickTimer, downPoint;
  function updatePlaces(next) {
    currentPlaces = next;
    markers.forEach(m=>m.remove()); markers=[];
    next.forEach((place,index) => {
      const button = document.createElement('button');
      button.className = `map-pin map-pin-${place.type || 'other'}`;
      button.textContent = String(index+1); button.setAttribute('aria-label',place.title);
      button.addEventListener('click',()=>onPlace(place));
      markers.push(new gl.Marker({element:button}).setLngLat([place.lng,place.lat]).addTo(map));
    });
    const data = next.length > 1 ? {type:'Feature',properties:{},geometry:{type:'LineString',coordinates:next.map(p=>[p.lng,p.lat])}} : {type:'FeatureCollection',features:[]};
    if (map.isStyleLoaded()) map.getSource('route')?.setData(data);
    else map.once('load',()=>map.getSource('route')?.setData(data));
  }
  map.on('load',()=>{updatePlaces(currentPlaces); coverage();});
  map.on('error', event => onError?.(event.error?.message || 'המפה לא נטענה. נסו להוריד אותה מחדש'));
  function coverage() {
    const bounds = map.getBounds(), zoom=map.getZoom();
    const corners = [[bounds.getWest(),bounds.getSouth()],[bounds.getWest(),bounds.getNorth()],[bounds.getEast(),bounds.getSouth()],[bounds.getEast(),bounds.getNorth()]];
    const covers = (p,point)=>point[0]>=p.bounds[0]&&point[0]<=p.bounds[2]&&point[1]>=p.bounds[1]&&point[1]<=p.bounds[3]&&zoom<=p.maxZoom+3;
    if (raster) {
      const imageryCovers=(p,point)=>point[0]>=p.bounds[0]&&point[0]<=p.bounds[2]&&point[1]>=p.bounds[1]&&point[1]<=p.bounds[3];
      const local=localImagery&&corners.every(point=>satellitePackages.some(p=>imageryCovers(p,point)));
      const detail=local&&corners.every(point=>satellitePackages.some(p=>imageryCovers(p,point)&&zoom<=p.maxZoom));
      if(map.getLayer('imagery')){
        const visibility=local?'none':'visible';
        if(map.getLayoutProperty('imagery','visibility')!==visibility)map.setLayoutProperty('imagery','visibility',visibility);
      }
      const labelsLocal=corners.every(point=>packages.some(p=>p.state==='ready'&&covers(p,point)));
      onCoverage(local||navigator.onLine,local,detail,labelsLocal);
      return;
    }
    onCoverage(corners.every(point=>packages.some(p=>covers(p,point))), corners.every(point=>packages.some(p=>p.state==='ready'&&covers(p,point))));
  }
  map.on('moveend',coverage);
  const canvas = map.getCanvas();
  const cancel = () => { clearTimeout(pickTimer); pickTimer=null; };
  const down = e => { if(e.button && e.button!==0)return; downPoint={x:e.clientX,y:e.clientY}; cancel(); const rect=canvas.getBoundingClientRect(); const lngLat=map.unproject([e.clientX-rect.left,e.clientY-rect.top]); pickTimer=setTimeout(()=>onPick(lngLat),650); };
  const move = e => { if(downPoint && Math.hypot(e.clientX-downPoint.x,e.clientY-downPoint.y)>8)cancel(); };
  canvas.addEventListener('pointerdown',down); canvas.addEventListener('pointermove',move); canvas.addEventListener('pointerup',cancel); canvas.addEventListener('pointercancel',cancel);
  const observer = new ResizeObserver(()=>map.resize()); observer.observe(container);
  return {
    updatePlaces,
    fitPlaces() { if(currentPlaces.length) {
      const bounds = new gl.LngLatBounds();currentPlaces.forEach(p=>bounds.extend([p.lng,p.lat]));
      const covering=satellitePackages.filter(pack=>currentPlaces.every(p=>p.lng>=pack.bounds[0]&&p.lng<=pack.bounds[2]&&p.lat>=pack.bounds[1]&&p.lat<=pack.bounds[3]));
      const maxZoom=raster&&basemap!=='terrain'?(covering.length?Math.max(...covering.map(p=>p.maxZoom)):13):14;
      map.fitBounds(bounds,{padding:60,maxZoom,duration:0});
    } },
    pickCenter() { onPick(map.getCenter()); },
    resize() { map.resize(); },
    camera() { return {center:map.getCenter().toArray(),zoom:map.getZoom(),bearing:map.getBearing(),pitch:map.getPitch()}; },
    destroy() { cancel();observer.disconnect();map.remove(); },
  };
}
