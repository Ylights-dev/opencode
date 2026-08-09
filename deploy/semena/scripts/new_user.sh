#!/usr/bin/env sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "usage: $0 employee@example.com" >&2
  exit 2
fi

cd "$(dirname "$0")/.."
docker compose exec -T auth python /app/auth_server.py create "$1"
