#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import ssl
import sys
import urllib.error
import urllib.request


def request(url: str, ca: str, key: str | None = None, payload: dict | None = None):
    headers = {"Content-Type": "application/json"}
    if key:
        headers["Authorization"] = f"Bearer {key}"
    req = urllib.request.Request(
        url,
        data=None if payload is None else json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="GET" if payload is None else "POST",
    )
    context = ssl.create_default_context(cafile=ca)
    return urllib.request.urlopen(req, context=context, timeout=300)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="https://10.1.50.101:8443")
    parser.add_argument("--ca", default="client/semena-opencode-ca.crt")
    parser.add_argument("--key", required=True)
    args = parser.parse_args()

    with request(f"{args.base_url}/health", args.ca) as response:
        assert response.status == 200

    try:
        request(
            f"{args.base_url}/v1/models",
            args.ca,
            key="sk-invalid-key-for-negative-test",
        )
    except urllib.error.HTTPError as exc:
        assert exc.code in (401, 403), exc.code
    else:
        raise AssertionError("invalid API key was accepted")

    with request(f"{args.base_url}/v1/models", args.ca, key=args.key) as response:
        models = json.load(response)
        assert any(item["id"] == "gemma4:12b" for item in models["data"])

    payload = {
        "model": "gemma4:12b",
        "messages": [{"role": "user", "content": "Reply with exactly: OK"}],
        "temperature": 0,
        "max_tokens": 128,
        "reasoning_effort": "none",
    }
    with request(
        f"{args.base_url}/v1/chat/completions", args.ca, key=args.key, payload=payload
    ) as response:
        body = json.load(response)
        text = body["choices"][0]["message"]["content"].strip().upper()
        assert text == "OK", repr(body)

    print("gateway smoke test passed")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (AssertionError, urllib.error.URLError) as exc:
        print(f"gateway smoke test failed: {exc!r}", file=sys.stderr)
        raise SystemExit(1)
