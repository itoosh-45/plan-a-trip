"""Local-only browser fixture serving the actual worker with controllable versions."""
from pathlib import Path
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
ROOT=Path(__file__).resolve().parents[1]
class Fixture(SimpleHTTPRequestHandler):
    version='1'
    def __init__(self,*args,**kwargs):super().__init__(*args,directory=str(ROOT),**kwargs)
    def log_message(self,*args):pass
    def do_POST(self):
        if self.path.startswith('/__test/version/'):
            Fixture.version=self.path.rsplit('/',1)[1];self.send_response(204);self.end_headers()
        else:self.send_error(404)
    def do_GET(self):
        if self.path=='/sw.js':
            text=(ROOT/'sw.js').read_text(encoding='utf-8')
            text=text.replace('trip-planner-shell-20261004-preview-1','trip-planner-shell-update-test-'+Fixture.version)
            if Fixture.version=='broken':text=text.replace("const SHELL = [","const SHELL = ['./missing-update-file',")
            data=text.encode();self.send_response(200);self.send_header('Content-Type','application/javascript');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
        else:super().do_GET()
if __name__=='__main__':ThreadingHTTPServer(('127.0.0.1',8126),Fixture).serve_forever()
