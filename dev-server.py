"""שרת סטטי לפיתוח בלבד. שולח no-store כדי שהדפדפן וה-Service Worker
לא יגישו קבצים ישנים אחרי כל עריכה. לא חלק מהאפליקציה."""
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCache(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        super().end_headers()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
    ThreadingHTTPServer(('127.0.0.1', port), NoCache).serve_forever()
