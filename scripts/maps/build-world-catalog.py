"""Create the country/territory index from Natural Earth's public-domain data.

Download ne_10m_admin_0_countries.geojson from the project's official repository
to scratch/map-tools/world-countries.geojson before running this script.
"""
import importlib.util, json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('satellite_builder',ROOT/'scripts/maps/build-satellite.py')
satellite=importlib.util.module_from_spec(spec);spec.loader.exec_module(satellite)

def coordinates(items):
    if len(items)>=2 and isinstance(items[0],(int,float)):yield items[:2]
    else:
        for item in items:yield from coordinates(item)

def build():
    world=json.loads((ROOT/'scratch/map-tools/world-countries.geojson').read_text(encoding='utf-8'))
    result=[]
    for feature in world['features']:
        properties=feature['properties'];code=properties['ADM0_A3'].lower()
        if properties.get('ISO_A2') in ['TH','IL','GE']:continue
        name=properties.get('NAME_HE') or properties['NAME']
        points=list(coordinates(feature['geometry']['coordinates']))
        bounds=[min(x for x,y in points),max(-85,min(y for x,y in points)),max(x for x,y in points),min(85,max(y for x,y in points))]
        if bounds[0]>=bounds[2] or bounds[1]>=bounds[3]:continue
        zooms=[]
        for start,limit in [(10,2000),(12,16000)]:
            zoom=start
            while zoom>4 and sum(1 for _ in satellite.tiles(bounds,zoom))>limit:zoom-=1
            zooms.append(zoom)
        identity='world-'+code
        meta={'id':identity,'name':name,'country':name,'englishName':properties['NAME'],'countryCode':properties.get('ISO_A2_EH'),'kind':'country','bounds':bounds,'minZoom':0,'maxZoom':zooms[1],'satelliteMaxZoom':zooms[0],'type':'streets','prepared':False,'quality':'סקירת מדינה — רמת הפירוט תלויה בגודל האזור','version':'20261003','attribution':'© OpenStreetMap · Protomaps'}
        result.append(meta)
        if code!='ata':result.append({**meta,'id':identity+'-satellite','baseId':identity,'type':'satellite','name':name+' — לוויין','maxZoom':zooms[0],'version':satellite.VERSION,'imageryYear':2024,'quality':'סקירת מדינה — פחות מפורט בזום קרוב','attribution':satellite.ATTRIBUTION,'license':satellite.LICENSE})
    if len({entry['id'] for entry in result})!=len(result):raise RuntimeError('Duplicate catalogue IDs')
    return {'version':1,'source':'Natural Earth, public domain','packages':result}

if __name__=='__main__':
    catalog=build()
    (ROOT/'data/world-map-packages.json').write_text(json.dumps(catalog,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    print(len(catalog['packages']),'world package entries')
