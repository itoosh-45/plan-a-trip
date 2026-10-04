"""Create a deployable asset-only preview with a cache version derived from its contents."""
import hashlib, json, os, re, shutil
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
DEST=ROOT/'scratch/preview-dist'
worker=(ROOT/'sw.js').read_text(encoding='utf-8')
shell=re.search(r'const SHELL = \[([\s\S]*?)\];',worker).group(1)
paths=[p[2:] for p in re.findall(r"'([^']+)'",shell) if p!='./']
paths += ['sw.js','robots.txt','vendor/maplibre-LICENSE.txt','vendor/pmtiles-LICENSE.txt']
digest=hashlib.sha256()
for relative in sorted(set(paths)):
    source=ROOT/relative
    digest.update(relative.encode());digest.update(source.read_bytes())
    destination=DEST/relative;destination.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source,destination)
version=digest.hexdigest()[:16]
worker=re.sub(r"const CACHE = '[^']+';",f"const CACHE = 'trip-planner-shell-{version}';",worker)
(DEST/'sw.js').write_text(worker,encoding='utf-8')
updates=(DEST/'js/updates.js').read_text(encoding='utf-8')
updates=re.sub(r"export const APP_VERSION = '[^']+';",f"export const APP_VERSION = 'preview-{version[:8]}';",updates)
(DEST/'js/updates.js').write_text(updates,encoding='utf-8')
catalog=json.loads((ROOT/'data/map-packages.json').read_text(encoding='utf-8'))
for package in catalog['packages']:
    for chunk in package['chunks']:
        relative=chunk['url'].removeprefix('./');source=(ROOT/relative).resolve()
        if not source.is_relative_to((ROOT/'map-packages').resolve()):raise RuntimeError('Invalid package path')
        if source.stat().st_size!=chunk['bytes']:raise RuntimeError('Missing or incomplete chunk')
        destination=DEST/relative;destination.parent.mkdir(parents=True,exist_ok=True)
        if destination.exists():
            if os.path.samefile(source,destination):continue
            shutil.copy2(source,destination)
        else:
            try:os.link(source,destination)
            except OSError:shutil.copy2(source,destination)
print('Prepared asset-only preview:',DEST)
print('Version:',version)
