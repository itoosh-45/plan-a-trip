"""Package verified PMTiles archives into bounded, hashed static download chunks."""
import hashlib, json, subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
SOURCE=ROOT/'scratch/map-tools'
OUTPUT=ROOT/'map-packages'
TOOL=SOURCE/'pmtiles.exe'
DEFINITIONS=[
 ('bangkok','בנגקוק','city',[100.3,13.5,100.9,14.1]),
 ('thailand-north','צפון תאילנד','region',[97.3,16.9,101.9,20.5]),
 ('thailand-central','מרכז תאילנד','region',[98.4,12.1,102.1,16.9]),
 ('thailand-northeast','צפון־מזרח תאילנד','region',[101.3,14.1,105.7,18.6]),
 ('thailand-south','דרום תאילנד והאיים','region',[97.3,5.5,102.3,12.1]),
 ('thailand','תאילנד כולה','country',[97.3,5.5,105.7,20.5]),
 ('israel','ישראל','country',[34.2,29.4,35.95,33.4]),
 ('georgia','גאורגיה','country',[39.9,41.0,46.8,43.8]),
]
packages=[]
for identity,name,kind,bounds in DEFINITIONS:
    archive=SOURCE/(identity+'.pmtiles')
    if not archive.exists():raise RuntimeError('Missing real archive: '+identity)
    subprocess.run([str(TOOL),'verify',str(archive)],check=True,capture_output=True)
    destination=OUTPUT/identity/'20261003';destination.mkdir(parents=True,exist_ok=True)
    chunks=[]
    with archive.open('rb') as stream:
        index=0
        while data:=stream.read(4*1024*1024):
            filename=f'{index:04d}.bin';(destination/filename).write_bytes(data)
            chunks.append({'index':index,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'url':f'./map-packages/{identity}/20261003/{filename}'})
            index+=1
    size=archive.stat().st_size
    country='ישראל' if identity=='israel' else 'גאורגיה' if identity=='georgia' else 'תאילנד'
    packages.append({'id':identity,'name':name,'country':country,'kind':kind,'bounds':bounds,'minZoom':0,'maxZoom':15,'version':'20261003','bytes':size,'chunkBytes':4*1024*1024,'chunks':chunks,'attribution':'© OpenStreetMap · Protomaps'})
    print(identity,size,flush=True)
catalog_path=ROOT/'data/map-packages.json'
if catalog_path.exists():
    packages += [p for p in json.loads(catalog_path.read_text(encoding='utf-8'))['packages'] if p.get('type')=='satellite']
catalog_path.write_text(json.dumps({'version':1,'packages':packages},ensure_ascii=False,separators=(',',':')),encoding='utf-8')
