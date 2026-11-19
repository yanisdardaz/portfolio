"""Faux site local qui reproduit les techniques des pages piégées."""
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PAGES = {
    "/ok": (200, {"Content-Type": "text/html; charset=utf-8"}, "<html><title>Menu du jour</title><p>Bienvenue</p></html>"),
    "/r1": (301, {"Location": "/r2"}, ""),
    "/r2": (302, {"Location": "/r3"}, ""),
    "/r3": (307, {"Location": "/ok"}, ""),
    "/meta": (200, {"Content-Type": "text/html"}, '<html><head><meta http-equiv="refresh" content="0; url=/login"></head></html>'),
    "/meta2": (200, {"Content-Type": "text/html"}, "<meta content='3;URL=\"/ok\"' http-equiv='Refresh'>"),
    "/js": (200, {"Content-Type": "text/html"}, '<script>window.location.href = "/login";</script>'),
    "/js2": (200, {"Content-Type": "text/html"}, "<script>location.replace('/ok')</script>"),
    "/login": (200, {"Content-Type": "text/html"}, '<title>Payer votre amende</title><form><input name=u><input type="password" name=p></form>'),
    "/loop": (302, {"Location": "/loop2"}, ""),
    "/loop2": (302, {"Location": "/loop"}, ""),
    "/apk": (200, {"Content-Type": "application/vnd.android.package-archive"}, "PK..."),
    "/attach": (200, {"Content-Type": "text/html", "Content-Disposition": 'attachment; filename="facture.exe"'}, "MZ"),
    "/404": (404, {"Content-Type": "text/html"}, "introuvable"),
    "/js-scheme": (302, {"Location": "javascript:alert(1)"}, ""),
}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        path = self.path.split("?")[0]
        if path.startswith("/chain/"):
            n = int(path.split("/")[2])
            status, headers, body = (302, {"Location": f"/chain/{n - 1}"}, "") if n > 0 else PAGES["/ok"]
        else:
            status, headers, body = PAGES.get(path, PAGES["/404"])
        data = body.encode()
        self.send_response(status)
        for k, v in headers.items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def start():
    srv = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f"http://127.0.0.1:{srv.server_address[1]}"


if __name__ == "__main__":  # python -m tests.fake_site 8765 (tests de bout en bout)
    import sys
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
