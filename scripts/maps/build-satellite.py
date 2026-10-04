"""Build bounded offline Sentinel-2 packages, with a resumable, rate-limited tile cache.

EOX Cloudless 2024: personal/noncommercial use, CC BY-NC-SA 4.0.
https://cloudless.eox.at/documentation/license
Original attribution/license are retained in every archive and catalog entry.
"""
import hashlib, io, json, math, sqlite3, subprocess, time, urllib.error, urllib.request
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'scratch/map-tools'
CACHE = SOURCE / 'satellite-2024-tiles'
TOOL = SOURCE / 'pmtiles.exe'
ATTRIBUTION = 'EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2024) · CC BY-NC-SA 4.0'
LICENSE = 'https://creativecommons.org/licenses/by-nc-sa/4.0/'
TEMPLATE = 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg'
VERSION = 'eox2024-z20261004'

def tiles(bounds, max_zoom):
    west, south, east, north = bounds
    for z in range(max_zoom + 1):
        n = 2 ** z
        x0, x1 = max(0,min(n-1,math.floor((west + 180) / 360 * n))), max(0,min(n-1,math.floor((east + 180) / 360 * n)))
        def y(lat):
            return math.floor((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)
        for x in range(x0, x1 + 1):
            for row in range(y(north), y(south) + 1):
                yield z, x, row

last_request = 0
def fetch_tile(z, x, y):
    global last_request
    path = CACHE / str(z) / str(x) / f'{y}.jpg'
    if path.exists():
        return path.read_bytes()
    for attempt in range(6):
        time.sleep(max(0, .5 - (time.monotonic() - last_request)))
        last_request = time.monotonic()
        try:
            request = urllib.request.Request(TEMPLATE.format(z=z, x=x, y=y), headers={'User-Agent':'PlanATrip-PersonalOfflinePreview/1.0'})
            with urllib.request.urlopen(request, timeout=40) as response:
                data = response.read(2 * 1024 * 1024)
                if response.headers.get_content_type() == 'image/png' and data.startswith(b'\x89PNG'):
                    # EOX returns transparent PNGs for some ocean tiles. Preserve
                    # that empty background consistently in the JPEG archive.
                    with Image.open(io.BytesIO(data)) as image:
                        if max(image.size)>256:raise RuntimeError('Unexpected satellite tile dimensions')
                        rgba=image.convert('RGBA').resize((256,256))
                        background=Image.new('RGB',(256,256),(190,223,232))
                        background.paste(rgba,mask=rgba.getchannel('A'))
                        output=io.BytesIO();background.save(output,format='JPEG',quality=90);data=output.getvalue()
                if not data.startswith(b'\xff\xd8') or not data.endswith(b'\xff\xd9'):
                    raise RuntimeError('Source returned an incomplete or non-JPEG tile')
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            return data
        except urllib.error.HTTPError as error:
            if error.code not in [429, 500, 502, 503, 504]:
                raise
            time.sleep(min(120, max(int(error.headers.get('Retry-After', '0')) if error.headers.get('Retry-After', '').isdigit() else 0, 5 * 2 ** attempt)))
        except (TimeoutError, urllib.error.URLError):
            time.sleep(5 * 2 ** attempt)
    raise RuntimeError('Tile source unavailable; cached tiles can be resumed later')

def build(meta):
    identity = meta['id'] + '-satellite'
    zoom = meta.get('satelliteMaxZoom',13 if meta['kind'] == 'city' else 11 if meta['id'] == 'israel' else 10)
    quality = 'פירוט עירוני' if zoom == 13 else 'סקירת אזור — פחות מפורט בזום קרוב'
    target = SOURCE / (identity + '.pmtiles')
    if target.exists() and subprocess.run([str(TOOL),'verify',str(target)],capture_output=True,timeout=60).returncode:
        target.unlink()
    if not target.exists():
        database = SOURCE / (identity + '.mbtiles')
        if database.exists(): database.unlink()
        with sqlite3.connect(database) as db:
            db.execute('CREATE TABLE metadata (name TEXT, value TEXT)')
            db.execute('CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB, PRIMARY KEY(zoom_level,tile_column,tile_row))')
            metadata = {'name':meta['name']+' — לוויין', 'format':'jpg', 'type':'baselayer', 'bounds':','.join(map(str,meta['bounds'])), 'minzoom':'0', 'maxzoom':str(zoom), 'attribution':ATTRIBUTION, 'license':LICENSE, 'description':quality}
            db.executemany('INSERT INTO metadata VALUES (?,?)',metadata.items())
            needed = list(tiles(meta['bounds'],zoom))
            for index, (z,x,y) in enumerate(needed):
                db.execute('INSERT INTO tiles VALUES (?,?,?,?)', (z,x,2**z-1-y,fetch_tile(z,x,y)))
                if index % 50 == 0: print(identity, f'{index}/{len(needed)}',flush=True)
        subprocess.run([str(TOOL),'convert',str(database),str(target)],check=True,capture_output=True)
    subprocess.run([str(TOOL),'verify',str(target)],check=True,capture_output=True)
    destination = ROOT / 'map-packages' / identity / VERSION
    destination.mkdir(parents=True,exist_ok=True)
    chunks = []
    with target.open('rb') as stream:
        while data := stream.read(4*1024*1024):
            index = len(chunks)
            filename = f'{index:04d}.bin'
            (destination/filename).write_bytes(data)
            chunks.append({'index':index,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'url':f'./map-packages/{identity}/{VERSION}/{filename}'})
    result = {**meta,'id':identity,'name':meta['name']+' — לוויין','baseId':meta['id'],'type':'satellite','version':VERSION,'maxZoom':zoom,'bytes':target.stat().st_size,'chunks':chunks,'attribution':ATTRIBUTION,'license':LICENSE,'quality':quality,'imageryYear':2024,'prepared':True}
    print('READY',identity,result['bytes'],flush=True)
    return result

if __name__ == '__main__':
    catalog_path = ROOT / 'data/map-packages.json'
    catalog = json.loads(catalog_path.read_text(encoding='utf-8'))
    streets = [p for p in catalog['packages'] if p.get('type','streets') == 'streets']
    satellite = [build(p) for p in streets]
    catalog['packages'] = streets + satellite
    temporary = catalog_path.with_suffix('.tmp')
    temporary.write_text(json.dumps(catalog,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    temporary.replace(catalog_path)
