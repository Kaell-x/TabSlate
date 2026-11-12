#!/usr/bin/env python3
"""TabSlate direct-sync snapshot server (Python 3.8+, standard library only).

Serves a single JSON snapshot file that TabSlate browser extensions
(lib/direct-sync.ts) push to and pull from. One snapshot per token — all
devices sharing the token share one dataset.

Endpoints:
    GET  /healthz            -> 200 {"ok": true}
    GET  /snapshot           -> 200 snapshot JSON (ETag + If-None-Match 304)
    PUT  /snapshot           -> store request body as the new snapshot

Auth: Authorization: Bearer <token> (required for GET/PUT /snapshot).

Usage:
    python3 server.py --token my-shared-secret --port 8787

Reach it from another machine over SSH without exposing a port:
    ssh -L 8787:127.0.0.1:8787 user@this-host
then point the extension at http://127.0.0.1:8787 (loopback http is allowed
by the extension's server URL validation).
"""

import argparse
import hashlib
import hmac
import http.server
import json
import os
import sys
import time

MAX_BODY_BYTES = 32 * 1024 * 1024
SNAPSHOT_FORMAT = "tabslate-snapshot"
SNAPSHOT_FORMAT_VERSION = 1


class Config:
    def __init__(self, token: str, data_dir: str):
        self.token = token
        self.data_dir = data_dir
        os.makedirs(data_dir, exist_ok=True)
        self.snapshot_path = os.path.join(data_dir, "snapshot.json")


def json_bytes(payload) -> bytes:
    return json.dumps(payload, ensure_ascii=False).encode("utf-8")


class Handler(http.server.BaseHTTPRequestHandler):
    server_version = "TabSlateSync/1.0"

    # -- helpers ---------------------------------------------------------

    @property
    def config(self) -> Config:
        return self.server.config  # type: ignore[attr-defined]

    def log_message(self, fmt, *args):
        sys.stdout.write("%s %s\n" % (time.strftime("%Y-%m-%d %H:%M:%S"), fmt % args))
        sys.stdout.flush()

    def send_json(self, status: int, payload, etag=None):
        body = json_bytes(payload)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        if etag:
            self.send_header("ETag", '"%s"' % etag)
        self.end_headers()
        self.wfile.write(body)

    def authorized(self) -> bool:
        header = self.headers.get("Authorization", "")
        prefix = "Bearer "
        if not header.startswith(prefix):
            return False
        provided = header[len(prefix):].strip()
        return hmac.compare_digest(provided, self.config.token)

    # -- routes ----------------------------------------------------------

    def do_GET(self):
        path = self.path.split("?", 1)[0].rstrip("/") or "/"
        if path == "/healthz":
            self.send_json(200, {"ok": True})
            return
        if path != "/snapshot":
            self.send_json(404, {"error": "not found"})
            return
        if not self.authorized():
            self.send_json(401, {"error": "unauthorized"})
            return
        if not os.path.exists(self.config.snapshot_path):
            self.send_json(404, {"error": "no snapshot"})
            return
        with open(self.config.snapshot_path, "rb") as fh:
            body = fh.read()
        etag = hashlib.md5(body).hexdigest()
        client_etag = self.headers.get("If-None-Match", "").strip('"')
        if client_etag and hmac.compare_digest(client_etag, etag):
            self.send_response(304)
            self.send_header("ETag", '"%s"' % etag)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("ETag", '"%s"' % etag)
        self.end_headers()
        self.wfile.write(body)

    def do_PUT(self):
        path = self.path.split("?", 1)[0].rstrip("/") or "/"
        if path != "/snapshot":
            self.send_json(404, {"error": "not found"})
            return
        if not self.authorized():
            self.send_json(401, {"error": "unauthorized"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BODY_BYTES:
            self.send_json(400, {"error": "invalid Content-Length"})
            return
        body = self.rfile.read(length)
        try:
            payload = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self.send_json(400, {"error": "body is not valid JSON"})
            return
        if (
            not isinstance(payload, dict)
            or payload.get("format") != SNAPSHOT_FORMAT
            or payload.get("formatVersion") != SNAPSHOT_FORMAT_VERSION
        ):
            self.send_json(400, {"error": "not a tabslate-snapshot v1 payload"})
            return
        etag = hashlib.md5(body).hexdigest()
        tmp_path = self.config.snapshot_path + ".tmp"
        with open(tmp_path, "wb") as fh:
            fh.write(body)
        os.replace(tmp_path, self.config.snapshot_path)
        self.send_json(200, {"ok": True, "etag": etag}, etag=etag)


class Server(http.server.ThreadingHTTPServer):
    def __init__(self, address, config: Config):
        super().__init__(address, Handler)
        self.config = config


def main():
    parser = argparse.ArgumentParser(description="TabSlate direct-sync snapshot server")
    parser.add_argument("--host", default="127.0.0.1", help="bind address (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8787, help="port (default: 8787)")
    parser.add_argument("--token", required=True, help="shared bearer token")
    parser.add_argument("--data-dir", default="./tabslate-sync-data", help="snapshot storage directory")
    args = parser.parse_args()

    config = Config(token=args.token, data_dir=args.data_dir)
    server = Server((args.host, args.port), config)
    print("TabSlate sync server listening on http://%s:%d (data dir: %s)" % (
        args.host, args.port, os.path.abspath(config.data_dir)))
    print("Devices push/pull /snapshot with Authorization: Bearer <token>.")
    sys.stdout.flush()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
