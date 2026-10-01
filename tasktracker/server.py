"""Local web server (127.0.0.1 only) + app-window launcher."""
import base64
import json
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import importers, office
from .storage import Store

APP_ID = "daily-task-tracker"
PREFERRED_PORT = 8765
IDLE_EXIT_SECONDS = 180  # exit once the window has been closed this long


def resource_dir():
    if hasattr(sys, "_MEIPASS"):  # PyInstaller bundle
        return os.path.join(sys._MEIPASS, "tasktracker", "web")
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")


def data_dir():
    if os.environ.get("TASKTRACKER_DATA"):
        return os.environ["TASKTRACKER_DATA"]
    exe_dir = os.path.dirname(sys.executable if getattr(sys, "frozen", False) else os.path.dirname(os.path.abspath(__file__)))
    path = os.path.join(exe_dir, "TaskTracker Data")
    try:
        os.makedirs(path, exist_ok=True)
        open(os.path.join(path, ".write_test"), "w").close()
        os.remove(os.path.join(path, ".write_test"))
        return path
    except OSError:
        return os.path.join(os.path.expanduser("~"), "Documents", "TaskTracker Data")


MIME = {".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".ico": "image/x-icon"}


class App:
    def __init__(self):
        self.store = Store(data_dir())
        self.last_beat = time.time()
        self.web = resource_dir()


def make_handler(app):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _send(self, code, body, ctype="application/json; charset=utf-8"):
            if not isinstance(body, (bytes, bytearray)):
                body = json.dumps(body, ensure_ascii=False).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def _host_ok(self):
            host = (self.headers.get("Host") or "").split(":")[0]
            return host in ("127.0.0.1", "localhost")

        def _body(self):
            n = int(self.headers.get("Content-Length") or 0)
            return json.loads(self.rfile.read(n) or b"{}") if n else {}

        def do_GET(self):
            if not self._host_ok():
                return self._send(403, {"error": "forbidden"})
            p = self.path.split("?")[0]
            if p == "/api/ping":
                return self._send(200, {"app": APP_ID})
            if p == "/api/state":
                st = app.store.state()
                st["data_dir"] = app.store.dir
                st["platform"] = sys.platform
                return self._send(200, st)
            if p == "/api/sharepoint/folders":
                return self._send(200, {"folders": office.sharepoint_folders()})
            name = "index.html" if p in ("/", "") else p.lstrip("/")
            full = os.path.normpath(os.path.join(app.web, name))
            if not full.startswith(os.path.normpath(app.web)) or not os.path.isfile(full):
                return self._send(404, {"error": "not found"})
            with open(full, "rb") as f:
                return self._send(200, f.read(), MIME.get(os.path.splitext(full)[1], "application/octet-stream"))

        def do_POST(self):
            if not self._host_ok():
                return self._send(403, {"error": "forbidden"})
            p = self.path.split("?")[0]
            try:
                b = self._body()
                if p == "/api/heartbeat":
                    app.last_beat = time.time()
                    return self._send(200, {"ok": True})
                if p == "/api/tasks":
                    return self._send(200, app.store.create(b))
                if p == "/api/tasks/bulk":
                    created, skipped = app.store.bulk_create(b.get("tasks", []))
                    return self._send(200, {"created": len(created), "skipped": skipped})
                if p == "/api/meta":
                    return self._send(200, app.store.set_meta(b))
                lst = b.get("list", "")
                if p == "/api/import/file":
                    data = base64.b64decode(b["content_b64"])
                    tasks, warn = importers.parse_file(b["filename"], data, lst)
                    return self._send(200, {"tasks": tasks, "warnings": warn})
                if p == "/api/import/folder":
                    tasks, warn = importers.parse_folder(b.get("path", "").strip().strip('"'), b.get("recursive", True), lst)
                    return self._send(200, {"tasks": tasks, "warnings": warn})
                if p == "/api/import/outlook":
                    tasks, warn = office.import_outlook(b.get("days", 14), b.get("tasks", True),
                                                        b.get("flagged", True), b.get("calendar", True), lst)
                    return self._send(200, {"tasks": tasks, "warnings": warn})
                if p == "/api/import/onenote":
                    tasks, warn = office.import_onenote(b.get("days", 30), b.get("include_done", False), lst)
                    return self._send(200, {"tasks": tasks, "warnings": warn})
                if p == "/api/pick-folder":
                    return self._send(200, {"path": office.pick_folder()})
                if p == "/api/open-data":
                    _open_path(app.store.dir)
                    return self._send(200, {"ok": True})
                return self._send(404, {"error": "not found"})
            except office.OfficeError as e:
                return self._send(400, {"error": str(e)})
            except Exception as e:
                return self._send(400, {"error": f"{type(e).__name__}: {e}"})

        def do_PUT(self):
            if not self._host_ok():
                return self._send(403, {"error": "forbidden"})
            if self.path.startswith("/api/tasks/"):
                t = app.store.update(self.path.rsplit("/", 1)[1], self._body())
                return self._send(200 if t else 404, t or {"error": "not found"})
            return self._send(404, {"error": "not found"})

        def do_DELETE(self):
            if not self._host_ok():
                return self._send(403, {"error": "forbidden"})
            if self.path.startswith("/api/tasks/"):
                ok = app.store.delete(self.path.rsplit("/", 1)[1])
                return self._send(200 if ok else 404, {"ok": ok})
            return self._send(404, {"error": "not found"})

    return Handler


def _open_path(path):
    if sys.platform.startswith("win"):
        os.startfile(path)  # noqa
    elif sys.platform == "darwin":
        subprocess.Popen(["open", path])
    else:
        subprocess.Popen(["xdg-open", path])


def _already_running(port):
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/ping", timeout=1) as r:
            return json.loads(r.read()).get("app") == APP_ID
    except Exception:
        return False


def _free_port():
    for port in [PREFERRED_PORT] + list(range(PREFERRED_PORT + 1, PREFERRED_PORT + 20)):
        with socket.socket() as s:
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def open_window(url):
    """Open as a standalone app window (Edge/Chrome --app), else default browser."""
    candidates = []
    if sys.platform.startswith("win"):
        for env in ("PROGRAMFILES(X86)", "PROGRAMFILES", "LOCALAPPDATA"):
            base = os.environ.get(env)
            if base:
                candidates += [os.path.join(base, "Microsoft", "Edge", "Application", "msedge.exe"),
                               os.path.join(base, "Google", "Chrome", "Application", "chrome.exe")]
    else:
        candidates += [shutil.which(x) or "" for x in ("microsoft-edge", "google-chrome", "chromium")]
    for exe in candidates:
        if exe and os.path.isfile(exe):
            try:
                subprocess.Popen([exe, f"--app={url}", "--window-size=1440,900"])
                return
            except OSError:
                continue
    webbrowser.open(url)


def main(open_ui=True):
    if _already_running(PREFERRED_PORT):
        if open_ui:
            open_window(f"http://127.0.0.1:{PREFERRED_PORT}/")
        return
    app = App()
    port = int(os.environ.get("TASKTRACKER_PORT") or _free_port())
    httpd = ThreadingHTTPServer(("127.0.0.1", port), make_handler(app))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{port}/"
    print(f"Daily Task Tracker running at {url}  (data: {app.store.dir})", flush=True)
    if open_ui:
        open_window(url)
    app.last_beat = time.time() + 60  # grace period while the window opens
    try:
        while True:
            time.sleep(5)
            if open_ui and time.time() - app.last_beat > IDLE_EXIT_SECONDS:
                break
    except KeyboardInterrupt:
        pass
    httpd.shutdown()
