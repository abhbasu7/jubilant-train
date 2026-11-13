"""Local site server with cached public data feeds. Run with python server.py."""

import argparse
import json
import os
from datetime import date
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock
from time import time
from urllib.error import URLError
from urllib.request import Request, urlopen
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
FEEDS = {
    "/api/blocks": ("https://mempool.space/api/blocks", 60),
    "/api/etf-flows": ("https://www.tftc.io/bitcoin-etf-flows/data.json", 900),
}
PUBLIC_FILES = {
    "/index.html", "/price.html", "/etfs.html", "/styles.css",
    "/app.js", "/price.js", "/etfs.js", "/theme.js",
}
LOCKS = {route: Lock() for route in FEEDS}
CACHE = {}


def validate_feed(route, payload):
    if route == "/api/blocks":
        block = payload[0]
        if not isinstance(block["height"], int) or not isinstance(block["timestamp"], int):
            raise ValueError("Invalid block data")
        return
    if payload["units"] != "USD" or not payload["days"]:
        raise ValueError("Invalid flow data")
    seen = set()
    for row in payload["days"]:
        day = row["date"]
        if date.fromisoformat(day).isoformat() != day or day in seen:
            raise ValueError("Invalid flow date")
        seen.add(day)
        for value in [row["netFlowUsd"], *(row.get("perEtfUsd") or {}).values()]:
            if value is not None and (type(value) not in (int, float) or not float("-inf") < value < float("inf")):
                raise ValueError("Invalid flow amount")


def get_feed(route):
    url, ttl = FEEDS[route]
    cache_path = ROOT / ".cache" / (route.rsplit("/", 1)[1] + ".json")
    with LOCKS[route]:
        cached = CACHE.get(route)
        if cached is None:
            try:
                cached = json.loads(cache_path.read_text(encoding="utf-8"))
                validate_feed(route, cached["payload"])
                if not 0 < cached["checked_at"] <= time():
                    raise ValueError("Invalid cache timestamp")
                CACHE[route] = cached
            except (OSError, ValueError, KeyError, TypeError, IndexError, AttributeError):
                cached = None
        if cached and time() - cached["checked_at"] < ttl:
            return cached, False
        try:
            request = Request(url, headers={"User-Agent": "iseebtc/1.0", "Accept": "application/json"})
            with urlopen(request, timeout=15) as response:
                raw = response.read(10_000_001)
            if len(raw) > 10_000_000:
                raise ValueError("Feed too large")
            payload = json.loads(raw)
            validate_feed(route, payload)
            cached = {"checked_at": time(), "payload": payload}
            CACHE[route] = cached
            try:
                cache_path.parent.mkdir(exist_ok=True)
                temporary = cache_path.with_suffix(".tmp")
                temporary.write_text(json.dumps(cached, allow_nan=False), encoding="utf-8")
                os.replace(temporary, cache_path)
            except OSError:
                pass  # Keep serving the in-memory response when disk caching fails.
            return cached, False
        except (URLError, OSError, ValueError, KeyError, TypeError, IndexError, AttributeError):
            if cached:
                return cached, True
            raise ValueError("Public data source unavailable") from None


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        # A background preview may inherit an unread console pipe.
        pass

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        route = urlsplit(self.path).path
        if route in FEEDS:
            try:
                result, stale = get_feed(route)
            except ValueError:
                self.send_error(502, "Public data source unavailable")
                return
            body = json.dumps(result["payload"], allow_nan=False).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Data-Stale", str(stale).lower())
            self.send_header("X-Data-Checked-At", str(int(result["checked_at"] * 1000)))
            self.end_headers()
            self.wfile.write(body)
        elif route == "/" or route in PUBLIC_FILES:
            super().do_GET()
        else:
            self.send_error(404)

    def do_HEAD(self):
        route = urlsplit(self.path).path
        if route == "/" or route in PUBLIC_FILES:
            super().do_HEAD()
        else:
            self.send_error(404)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("port", nargs="?", type=int, default=3101)
    args = parser.parse_args()
    print(f"Local preview at http://127.0.0.1:{args.port}/", flush=True)
    print("Press Ctrl+C to stop.", flush=True)
    with ThreadingHTTPServer(("127.0.0.1", args.port), Handler) as server:
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
