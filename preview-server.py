"""Separate preview server: exposes application assets only, never the repository."""
import json, sys, time, urllib.request, urllib.parse, urllib.error
from pathlib import Path
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = Path(__file__).resolve().parent
ASSETS = (ROOT / sys.argv[2]).resolve() if len(sys.argv)>2 else ROOT
if not ASSETS.is_relative_to(ROOT): raise RuntimeError('Preview assets must be inside the workspace')
HOSTS = {'maps.app.goo.gl','goo.gl','www.google.com','google.com','maps.google.com'}
FILES = {'index.html','sw.js','manifest.json','robots.txt'}
DIRS = {'js','css','fonts','icons','vendor','data','map-packages'}

def map_url(raw):
    url = urllib.parse.urlsplit(raw)
    return url.scheme == 'https' and url.hostname in HOSTS and not url.username and not url.password and url.port in (None,443)

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl): return None

class Preview(SimpleHTTPRequestHandler):
    hits = {}
    def __init__(self, *args, **kwargs): super().__init__(*args, directory=str(ASSETS), **kwargs)
    def allowed(self):
        raw = urllib.parse.unquote(urllib.parse.urlsplit(self.path).path).lstrip('/')
        if not raw: return True
        parts=Path(raw).parts
        if any(p.startswith('.') or p in ('..',) for p in parts): return False
        return parts[0] in DIRS or (len(parts)==1 and parts[0] in FILES)
    def end_headers(self):
        self.send_header('Cache-Control','no-cache' if self.path.endswith('sw.js') else 'public, max-age=3600')
        self.send_header('X-Content-Type-Options','nosniff')
        super().end_headers()
    def log_message(self, fmt, *args):
        if args and str(args[0]).startswith(('GET /api/','POST /api/')): return
        super().log_message(fmt,*args)
    def answer(self, data, status=200):
        body=json.dumps(data,ensure_ascii=False).encode()
        self.send_response(status);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
    def limited(self):
        key=self.headers.get('CF-Connecting-IP') or self.client_address[0]
        now=time.time(); start,count=self.hits.get(key,(now,0))
        if now-start>60:start,count=now,0
        self.hits[key]=(start,count+1)
        if len(self.hits)>2000:self.hits={k:v for k,v in self.hits.items() if now-v[0]<60}
        if count>=15:self.answer({'error':'חכו מעט לפני חיפוש נוסף'},429);return True
        return False
    def do_HEAD(self):
        if not self.allowed():self.send_error(404);return
        super().do_HEAD()
    def do_GET(self):
        url=urllib.parse.urlsplit(self.path)
        if url.path=='/api/map-search':
            if self.limited():return
            q=urllib.parse.parse_qs(url.query).get('q',[''])[0].strip()
            if not 2<=len(q)<=160:self.answer({'places':[]});return
            try:
                target='https://photon.komoot.io/api/?'+urllib.parse.urlencode({'q':q,'limit':6,'lang':'en'})
                request=urllib.request.Request(target,headers={'User-Agent':'PlanATripPreview/1.0'})
                with urllib.request.urlopen(request,timeout=8) as response:data=json.load(response)
                results=[]
                for feature in data.get('features',[]):
                    p=feature['properties'];lng,lat=feature['geometry']['coordinates']
                    results.append({'title':p.get('name') or p.get('street') or q,'address':', '.join(str(p[k]) for k in ('street','housenumber','city','country') if p.get(k)),'lat':lat,'lng':lng})
                self.answer({'places':results})
            except Exception:self.answer({'error':'החיפוש אינו זמין'},503)
            return
        if not self.allowed():self.send_error(404);return
        # Disable directory browsing and repository access.
        path=Path(self.translate_path(self.path))
        if path.is_dir() and not (path/'index.html').exists():self.send_error(404);return
        super().do_GET()
    def do_POST(self):
        if urllib.parse.urlsplit(self.path).path!='/api/resolve-map-link':self.send_error(404);return
        if self.limited():return
        try:
            length=int(self.headers.get('Content-Length','0'))
            if not 0<length<=2048:self.answer({'error':'קישור אינו תקין'},400);return
            target=json.loads(self.rfile.read(length))['url']
            opener=urllib.request.build_opener(NoRedirect)
            for _ in range(5):
                if not map_url(target):self.answer({'error':'קישור לא מורשה'},400);return
                try:
                    with opener.open(target,timeout=5):self.answer({'url':target});return
                except urllib.error.HTTPError as error:
                    if error.code not in (301,302,303,307,308):self.answer({'url':target});return
                    target=urllib.parse.urljoin(target,error.headers['Location'])
            self.answer({'error':'יותר מדי הפניות'},400)
        except Exception:self.answer({'error':'השירות אינו זמין'},503)

if __name__=='__main__':ThreadingHTTPServer(('127.0.0.1',int(sys.argv[1]) if len(sys.argv)>1 else 8125),Preview).serve_forever()
