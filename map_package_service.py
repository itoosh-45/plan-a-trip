"""Prepare public country archives for the preview. No trip data is accepted.

One bounded job runs at a time. IDs, bounds and sources come from our catalogue,
never from request-provided paths or URLs. Production needs a persistent host.
"""
import hashlib, importlib.util, json, os, shutil, subprocess, threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('satellite_builder',ROOT/'scripts/maps/build-satellite.py')
satellite=importlib.util.module_from_spec(spec);spec.loader.exec_module(satellite)

class PackageService:
    def __init__(self,assets):
        self.assets=assets
        self.catalog={p['id']:p for p in json.loads((ROOT/'data/world-map-packages.json').read_text(encoding='utf-8'))['packages']}
        self.jobs={};self.lock=threading.RLock();self.pool=ThreadPoolExecutor(max_workers=1)
        self.saved=ROOT/'scratch/world-prepared-packages.json'
        if self.saved.exists():
            for meta in json.loads(self.saved.read_text(encoding='utf-8')):
                if meta['id'] in self.catalog and all((assets/part['url'].removeprefix('./')).is_file() for part in meta['chunks']):
                    self.jobs[meta['id']]={'state':'ready','package':meta}
    def ready(self):
        with self.lock:return [j['package'] for j in self.jobs.values() if j['state']=='ready']
    def status(self,identity):
        with self.lock:return self.jobs.get(identity,{'state':'idle'})
    def prepare(self,identity):
        if identity not in self.catalog:raise ValueError('המפה אינה בקטלוג')
        with self.lock:
            current=self.jobs.get(identity)
            if current and current['state'] in ('queued','building','ready'):return current
            if sum(j['state'] in ('queued','building') for j in self.jobs.values())>=3:raise ValueError('שרת ההכנה עסוק. נסו שוב לאחר סיום חבילה')
            self.jobs[identity]={'state':'queued'}
            self.pool.submit(self.build,identity)
            return self.jobs[identity]
    def build(self,identity):
        with self.lock:self.jobs[identity]={'state':'building'}
        try:
            if shutil.disk_usage(ROOT).free<2*1024**3:raise RuntimeError('אין מספיק מקום בשרת להכנת מפה נוספת')
            meta=self.catalog[identity]
            if meta['type']=='satellite':
                base={**meta,'id':meta['baseId'],'name':meta['country']}
                result=satellite.build(base)
            else:
                archive=ROOT/'scratch/map-tools'/f'{identity}.pmtiles'
                if archive.exists() and subprocess.run([str(satellite.TOOL),'verify',str(archive)],capture_output=True,timeout=60).returncode:
                    archive.unlink()  # Retry a failed generated archive, not an unrelated file.
                if not archive.exists():
                    subprocess.run([str(satellite.TOOL),'extract','https://build.protomaps.com/20261003.pmtiles',str(archive),'--bbox='+','.join(map(str,meta['bounds'])),'--maxzoom='+str(meta['maxZoom']),'--download-threads=2'],check=True,capture_output=True,timeout=3600)
                subprocess.run([str(satellite.TOOL),'verify',str(archive)],check=True,capture_output=True,timeout=60)
                destination=ROOT/'map-packages'/identity/meta['version'];destination.mkdir(parents=True,exist_ok=True)
                chunks=[]
                with archive.open('rb') as stream:
                    while data:=stream.read(4*1024*1024):
                        index=len(chunks);filename=f'{index:04d}.bin';(destination/filename).write_bytes(data)
                        chunks.append({'index':index,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'url':f'./map-packages/{identity}/{meta["version"]}/{filename}'})
                result={**meta,'bytes':archive.stat().st_size,'chunks':chunks,'chunkBytes':4*1024*1024,'prepared':True}
            for part in result['chunks']:
                relative=part['url'].removeprefix('./');source=ROOT/relative;destination=self.assets/relative
                destination.parent.mkdir(parents=True,exist_ok=True)
                if source.resolve()!=destination.resolve() and not destination.exists():
                    try:os.link(source,destination)
                    except OSError:shutil.copy2(source,destination)
            with self.lock:
                self.jobs[identity]={'state':'ready','package':result}
                temporary=self.saved.with_suffix('.tmp');temporary.write_text(json.dumps(self.ready(),ensure_ascii=False),encoding='utf-8');temporary.replace(self.saved)
        except Exception as error:
            # Preserve a readable diagnosis without exposing subprocess output.
            message=str(error) if isinstance(error,RuntimeError) else 'הכנת החבילה נכשלה. אפשר לנסות שוב מאוחר יותר'
            with self.lock:self.jobs[identity]={'state':'failed','error':message}
