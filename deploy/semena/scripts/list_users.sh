#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/.."
docker compose exec -T auth python /app/auth_server.py list
