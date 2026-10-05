"""Create a deployable asset-only preview with a cache version derived from its contents."""
import hashlib, re, shutil
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
DEST=ROOT/'scratch/preview-dist'
worker=(ROOT/'sw.js').read_text(encoding='utf-8')
shell=re.search(r'const SHELL = \[([\s\S]*?)\];',worker).group(1)
paths=[p[2:] for p in re.findall(r"'([^']+)'",shell) if p!='./']
paths += ['sw.js','robots.txt']
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
print('Prepared asset-only preview:',DEST)
print('Version:',version)
