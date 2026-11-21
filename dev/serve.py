#!/usr/bin/env python3
"""Local server with the same security headers as production (deploy/Caddyfile).

Usage: python3 dev/serve.py [port]   then open http://localhost:8800/dilemma/

The site is served under /dilemma/ like in production, so relative paths get
tested too. A CSP violation shows up in the browser console exactly as it would live.
"""
import http.server
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PREFIX = "/dilemma"
CSP = ("default-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; "
       "form-action 'self'; frame-ancestors 'none'")


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript"}

    def translate_path(self, path):
        path = path.split("?", 1)[0].split("#", 1)[0]
        if path.startswith(PREFIX):
            path = path[len(PREFIX):] or "/"
        else:
            path = "/__nope__"
        return http.server.SimpleHTTPRequestHandler.translate_path(self, path)

    def do_GET(self):
        if self.path == PREFIX:
            self.send_response(301)
            self.send_header("Location", PREFIX + "/")
            self.end_headers()
            return
        super().do_GET()

    def end_headers(self):
        self.send_header("Content-Security-Policy", CSP)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8800
    os.chdir(ROOT)
    print(f"http://localhost:{port}{PREFIX}/")
    http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
