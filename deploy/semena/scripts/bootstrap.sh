#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/.."
umask 077

if [ ! -f .env ]; then
  auth_pepper="$(openssl rand -hex 32)"
  {
    printf 'AUTH_PEPPER=%s\n' "$auth_pepper"
  } > .env
fi
if ! grep -q '^AUTH_PEPPER=' .env; then
  printf 'AUTH_PEPPER=%s\n' "$(openssl rand -hex 32)" >> .env
fi

mkdir -p ./data
./scripts/generate_tls.sh ./tls
docker compose config --quiet
docker compose pull
docker compose up -d
docker compose ps
