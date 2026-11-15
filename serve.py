# Servidor estático local sin caché (los módulos ES se recargan siempre).
# Uso: python serve.py  →  http://localhost:8080
import http.server
import socketserver


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


NoCache.extensions_map[".js"] = "text/javascript"

with socketserver.TCPServer(("", 8080), NoCache) as httpd:
    print("Sirviendo en http://localhost:8080")
    httpd.serve_forever()
