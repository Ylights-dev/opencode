#!/usr/bin/env python3
"""Small, auditable API-key boundary for the employee-facing Ollama endpoint."""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
from contextlib import closing
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


EMAIL_RE = re.compile(r"^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+$")


def database_path() -> str:
    return os.environ.get("AUTH_DB", "/data/auth.db")


def pepper() -> bytes:
    value = os.environ.get("AUTH_PEPPER", "")
    if len(value) < 32:
        raise RuntimeError("AUTH_PEPPER must contain at least 32 characters")
    return value.encode("utf-8")


def token_hash(token: str) -> str:
    return hmac.new(pepper(), token.encode("utf-8"), hashlib.sha256).hexdigest()


def connect() -> sqlite3.Connection:
    connection = sqlite3.connect(database_path(), timeout=10)
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            email TEXT PRIMARY KEY,
            key_hash TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL,
            revoked_at TEXT
        )
        """
    )
    return connection


def normalize_email(value: str) -> str:
    email = value.strip().lower()
    if not EMAIL_RE.fullmatch(email):
        raise ValueError("invalid employee email")
    return email


def create_user(email_value: str) -> dict[str, str]:
    email = normalize_email(email_value)
    token = "sk-sem-" + secrets.token_urlsafe(32)
    now = dt.datetime.now(dt.UTC).isoformat()
    with closing(connect()) as db:
        with db:
            db.execute(
                """
                INSERT INTO users(email, key_hash, created_at, revoked_at)
                VALUES (?, ?, ?, NULL)
                ON CONFLICT(email) DO UPDATE SET
                  key_hash = excluded.key_hash,
                  created_at = excluded.created_at,
                  revoked_at = NULL
                """,
                (email, token_hash(token), now),
            )
    return {"email": email, "key": token, "created_at": now}


def revoke_user(email_value: str) -> bool:
    email = normalize_email(email_value)
    now = dt.datetime.now(dt.UTC).isoformat()
    with closing(connect()) as db:
        with db:
            cursor = db.execute(
                "UPDATE users SET revoked_at = ? WHERE email = ? AND revoked_at IS NULL",
                (now, email),
            )
    return cursor.rowcount == 1


def authenticate(token: str) -> str | None:
    if not token.startswith("sk-sem-"):
        return None
    digest = token_hash(token)
    with closing(connect()) as db:
        row = db.execute(
            "SELECT email, key_hash FROM users WHERE key_hash = ? AND revoked_at IS NULL",
            (digest,),
        ).fetchone()
    if row and hmac.compare_digest(row[1], digest):
        return str(row[0])
    return None


class AuthHandler(BaseHTTPRequestHandler):
    server_version = "SemenaAuth/1.0"

    def do_GET(self) -> None:
        if self.path == "/health":
            self.send_response(HTTPStatus.OK)
            self.end_headers()
            self.wfile.write(b"ok")
            return
        if self.path != "/auth":
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        authorization = self.headers.get("Authorization", "")
        scheme, _, token = authorization.partition(" ")
        email = authenticate(token) if scheme.lower() == "bearer" else None
        if not email:
            self.send_response(HTTPStatus.UNAUTHORIZED)
            self.send_header("WWW-Authenticate", "Bearer")
            self.end_headers()
            return
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("X-Employee-Email", email)
        self.end_headers()

    def log_message(self, format_string: str, *args: object) -> None:
        return


def main() -> int:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    serve = subparsers.add_parser("serve")
    serve.add_argument("--host", default="0.0.0.0")
    serve.add_argument("--port", type=int, default=8080)
    create = subparsers.add_parser("create")
    create.add_argument("email")
    revoke = subparsers.add_parser("revoke")
    revoke.add_argument("email")
    subparsers.add_parser("list")
    args = parser.parse_args()

    if args.command == "serve":
        connect().close()
        ThreadingHTTPServer((args.host, args.port), AuthHandler).serve_forever()
    elif args.command == "create":
        print(json.dumps(create_user(args.email), ensure_ascii=False))
    elif args.command == "revoke":
        print(json.dumps({"email": args.email, "revoked": revoke_user(args.email)}))
    elif args.command == "list":
        with closing(connect()) as db:
            rows = db.execute(
                "SELECT email, created_at, revoked_at FROM users ORDER BY email"
            ).fetchall()
        fields = ("email", "created_at", "revoked_at")
        print(json.dumps([dict(zip(fields, row)) for row in rows]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
