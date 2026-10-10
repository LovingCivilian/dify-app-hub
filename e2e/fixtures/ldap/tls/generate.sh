#!/bin/sh
# Regenerates the e2e and test:ldap TLS fixtures: a test CA (its key is discarded, as python-ldap's
# Lib/slapdtest/certs/gencerts.sh does) and one server certificate for both test directories (ADR-0029 decision h).
# Test-only: .dockerignore keeps e2e/ out of the image. Needs the openssl CLI (3.0 or later).
set -eu
cd "$(dirname "$0")"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

cat >"$tmp/ca.cnf" <<'EOF'
[req]
distinguished_name = dn
prompt = no
x509_extensions = v3_ca
[dn]
CN = dify-app-hub e2e LDAP test CA
[v3_ca]
basicConstraints = critical,CA:TRUE
keyUsage = critical,keyCertSign,cRLSign
subjectKeyIdentifier = hash
EOF

cat >"$tmp/server.cnf" <<'EOF'
[req]
distinguished_name = dn
prompt = no
[dn]
CN = localhost
EOF

cat >"$tmp/server.ext" <<'EOF'
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature,keyEncipherment
extendedKeyUsage = serverAuth
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid
subjectAltName = DNS:localhost,IP:127.0.0.1,IP:::1,DNS:ldap-ad,DNS:ldap-openldap
EOF

openssl req -x509 -config "$tmp/ca.cnf" -newkey rsa:2048 -noenc -sha256 -days 36500 \
  -keyout "$tmp/ca.key" -out ca.crt
openssl req -new -config "$tmp/server.cnf" -newkey rsa:2048 -noenc -sha256 \
  -keyout server.key -out "$tmp/server.csr"
openssl x509 -req -in "$tmp/server.csr" -CA ca.crt -CAkey "$tmp/ca.key" -set_serial 2 \
  -days 36500 -sha256 -extfile "$tmp/server.ext" -out server.crt
# 0644 on purpose: osixia's slapd runs as uid 911 and must read the key; the Samba seed copies it in at 0600 root.
chmod 0644 ca.crt server.crt server.key
openssl verify -CAfile ca.crt -verify_hostname localhost server.crt
openssl verify -CAfile ca.crt -verify_ip 127.0.0.1 server.crt
