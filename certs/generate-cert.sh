#!/usr/bin/env bash
# Generates a self-signed TLS cert/key for the local (laptop-hosted) deployment.
# Re-run whenever the SAN list needs to change - e.g. your public IP rotates
# (most home ISPs aren't static; see the Dynamic DNS note in README.md).
#
# Usage:
#   ./certs/generate-cert.sh
#   SAN="DNS:localhost,IP:127.0.0.1,IP:192.168.1.50" ./certs/generate-cert.sh
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CERT_DIR="$REPO_ROOT/certs"
mkdir -p "$CERT_DIR"

SAN="${SAN:-DNS:localhost,IP:127.0.0.1,IP:192.168.1.16,IP:176.228.138.251}"

openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout "$CERT_DIR/key.pem" \
  -out "$CERT_DIR/cert.pem" \
  -days 825 \
  -subj "/CN=norway-route-app.local" \
  -addext "subjectAltName=$SAN"

echo ""
echo "Generated $CERT_DIR/cert.pem and $CERT_DIR/key.pem (valid 825 days)."
echo "SAN: $SAN"
echo ""
echo "This is self-signed, so browsers will show a security warning on first"
echo "visit (no trusted authority vouches for it) - that's expected. Proceed"
echo "past the warning once; there's no way to silence it without a CA-issued"
echo "certificate (e.g. Let's Encrypt), which needs a real domain name."
