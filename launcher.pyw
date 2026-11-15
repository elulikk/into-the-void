# Lanzador sin ventana de consola: levanta el servidor local (si no está corriendo)
# y abre el juego en el navegador. Lo usa el acceso directo del escritorio.
import http.server
import os
import socket
import socketserver
import webbrowser

PORT = 8080
URL = f"http://localhost:{PORT}"
os.chdir(os.path.dirname(os.path.abspath(__file__)))


def port_in_use():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(("127.0.0.1", PORT)) == 0


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *args):
        pass


NoCache.extensions_map[".js"] = "text/javascript"

if port_in_use():
    webbrowser.open(URL)
else:
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", PORT), NoCache) as httpd:
        webbrowser.open(URL)
        httpd.serve_forever()
