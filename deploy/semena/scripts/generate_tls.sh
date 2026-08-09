#!/usr/bin/env sh
set -eu

TLS_DIR=${1:-./tls}
mkdir -p "$TLS_DIR"

if [ ! -f "$TLS_DIR/ca.key" ]; then
  openssl genrsa -out "$TLS_DIR/ca.key" 4096
  openssl req -x509 -new -nodes -key "$TLS_DIR/ca.key" -sha256 -days 3650 \
    -subj "/CN=Semena OpenCode Internal CA" \
    -addext "basicConstraints=critical,CA:TRUE" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" \
    -addext "subjectKeyIdentifier=hash" \
    -out "$TLS_DIR/semena-opencode-ca.crt"
fi

openssl genrsa -out "$TLS_DIR/server.key" 3072
openssl req -new -key "$TLS_DIR/server.key" -subj "/CN=10.1.50.101" -out "$TLS_DIR/server.csr"
printf '%s\n' \
  'authorityKeyIdentifier=keyid,issuer' \
  'basicConstraints=CA:FALSE' \
  'keyUsage=digitalSignature,keyEncipherment' \
  'extendedKeyUsage=serverAuth' \
  'subjectAltName=IP:10.1.50.101,DNS:semena-opencode.local' > "$TLS_DIR/server.ext"
openssl x509 -req -in "$TLS_DIR/server.csr" -CA "$TLS_DIR/semena-opencode-ca.crt" \
  -CAkey "$TLS_DIR/ca.key" -CAcreateserial -out "$TLS_DIR/server.crt" \
  -days 825 -sha256 -extfile "$TLS_DIR/server.ext"
chmod 600 "$TLS_DIR"/*.key
