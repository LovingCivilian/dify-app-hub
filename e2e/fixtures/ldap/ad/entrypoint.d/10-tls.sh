#!/bin/sh
# smblds runs every executable /entrypoint.d/* on every start, after provisioning and before samba starts.
# Samba refuses a TLS key not owned by its euid with mode exactly 0600 (CVE-2013-4476 check in
# source4/lib/tls/tls_tstream.c), so the key is copied in, never bind-mounted at the target path.
set -eu
tls_dir=/var/lib/samba/private/tls
mkdir -p "$tls_dir"
install -m 0600 -o root -g root /e2e-tls/server.key "$tls_dir/e2e-key.pem"
install -m 0644 -o root -g root /e2e-tls/server.crt "$tls_dir/e2e-cert.pem"
install -m 0644 -o root -g root /e2e-tls/ca.crt "$tls_dir/e2e-ca.pem"
# Same sed construct as the image's entrypoint.sh; guarded because this script runs on every start (issue #27).
if ! grep -q 'tls certfile = tls/e2e-cert.pem' /etc/samba/smb.conf; then
  sed -e '/^\[global\]/a\\ttls enabled = yes\n\ttls keyfile = tls/e2e-key.pem\n\ttls certfile = tls/e2e-cert.pem\n\ttls cafile = tls/e2e-ca.pem' \
      -i /etc/samba/smb.conf
fi
