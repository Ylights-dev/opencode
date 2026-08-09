#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/.."
nft delete table inet semena_opencode_guard 2>/dev/null || true
nft -f ./firewall.nft

