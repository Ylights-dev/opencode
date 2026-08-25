#!/usr/bin/env python3
"""Small, auditable API-key boundary for the employee-facing model endpoint."""

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
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


EMAIL_RE = re.compile(r"^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+$")
MAX_REQUEST_BYTES = 8192


class InvalidCredentialsError(Exception):
    pass


class IdentityProviderError(Exception):
    pass


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


def open_webui_signin_url() -> str:
    return os.environ.get(
        "OPEN_WEBUI_SIGNIN_URL",
        "http://host.docker.internal:3000/api/v1/auths/signin",
    )


def verify_open_webui_credentials(
    email_value: str,
    password: str,
    opener=urlopen,
) -> dict[str, str]:
    email = normalize_email(email_value)
    if not isinstance(password, str) or not password or len(password) > 1024:
        raise InvalidCredentialsError
    body = json.dumps({"email": email, "password": password}).encode("utf-8")
    request = Request(
        open_webui_signin_url(),
        data=body,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    try:
        with opener(request, timeout=10) as response:
            payload = json.loads(response.read(MAX_REQUEST_BYTES).decode("utf-8"))
    except HTTPError as error:
        if error.code in (HTTPStatus.BAD_REQUEST, HTTPStatus.UNAUTHORIZED, HTTPStatus.FORBIDDEN):
            raise InvalidCredentialsError from None
        raise IdentityProviderError from error
    except (URLError, TimeoutError, json.JSONDecodeError, UnicodeDecodeError) as error:
        raise IdentityProviderError from error

    try:
        verified_email = normalize_email(str(payload.get("email", "")))
    except ValueError:
        raise IdentityProviderError from None
    role = str(payload.get("role", ""))
    if verified_email != email or role not in ("user", "admin"):
        raise InvalidCredentialsError
    return {
        "email": verified_email,
        "role": role,
        "user_id": str(payload.get("id", "")),
    }


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
    server_version = "SemenaAuth/1.1"

    def send_json(self, status: HTTPStatus, payload: dict[str, object]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

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

    def do_POST(self) -> None:
        if self.path != "/enroll":
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length < 2 or length > MAX_REQUEST_BYTES:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_request"})
            return
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            if not isinstance(payload, dict):
                raise ValueError
            identity = verify_open_webui_credentials(
                str(payload.get("email", "")),
                payload.get("password", ""),
            )
            result = create_user(identity["email"])
        except (ValueError, UnicodeDecodeError, json.JSONDecodeError):
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_request"})
            return
        except InvalidCredentialsError:
            self.send_json(HTTPStatus.UNAUTHORIZED, {"error": "invalid_credentials"})
            return
        except IdentityProviderError:
            self.send_json(
                HTTPStatus.SERVICE_UNAVAILABLE,
                {"error": "identity_provider_unavailable"},
            )
            return
        self.send_json(
            HTTPStatus.CREATED,
            {"email": result["email"], "key": result["key"]},
        )

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
