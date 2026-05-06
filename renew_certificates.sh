#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$SCRIPT_DIR"
COMPOSE_CMD="docker-compose"
CLIENT_SERVICE="client"
CLIENT_CERT_DIR="$REPO_ROOT/sky-pirates/client/certs"
SKYPIRATES_LIVE="/etc/letsencrypt/live/skypirates.ca"
BUSHWILL_LIVE="/etc/letsencrypt/live/bushwill.ca"

if ! command -v "$COMPOSE_CMD" >/dev/null 2>&1; then
  echo "docker-compose is required but not installed." >&2
  exit 1
fi

if ! command -v certbot >/dev/null 2>&1; then
  echo "certbot is required but not installed." >&2
  exit 1
fi

if [[ ! -d "$CLIENT_CERT_DIR" ]]; then
  echo "Client certificate directory not found: $CLIENT_CERT_DIR" >&2
  exit 1
fi

if [[ ! -e "$SKYPIRATES_LIVE/fullchain.pem" || ! -e "$SKYPIRATES_LIVE/privkey.pem" ]]; then
  echo "Missing skypirates Let's Encrypt files in $SKYPIRATES_LIVE" >&2
  exit 1
fi

if [[ ! -e "$BUSHWILL_LIVE/fullchain.pem" || ! -e "$BUSHWILL_LIVE/privkey.pem" ]]; then
  echo "Missing bushwill Let's Encrypt files in $BUSHWILL_LIVE" >&2
  exit 1
fi

client_stopped=0
repo_owner_group="$(stat -c '%U:%G' "$REPO_ROOT")"

cleanup() {
  if [[ "$client_stopped" -eq 1 ]]; then
    "$COMPOSE_CMD" up -d --build "$CLIENT_SERVICE" >/dev/null
  fi
}

trap cleanup EXIT

if [[ -n "$($COMPOSE_CMD ps -q "$CLIENT_SERVICE" 2>/dev/null || true)" ]]; then
  echo "Stopping $CLIENT_SERVICE so certbot can bind port 80..."
  "$COMPOSE_CMD" stop "$CLIENT_SERVICE"
  client_stopped=1
fi

if ss -ltn | awk 'NR > 1 {print $4}' | grep -Eq ':(80|443)$'; then
  echo "Ports 80 or 443 are still in use after stopping $CLIENT_SERVICE." >&2
  echo "Stop the process holding the port and rerun this script." >&2
  exit 1
fi

echo "Renewing certificates..."
sudo certbot renew --force-renewal --allow-subset-of-names --no-random-sleep-on-renew

echo "Copying renewed certificates into the client build context..."
sudo cp "$SKYPIRATES_LIVE/fullchain.pem" "$CLIENT_CERT_DIR/fullchain.pem"
sudo cp "$SKYPIRATES_LIVE/privkey.pem" "$CLIENT_CERT_DIR/privkey.pem"
sudo cp "$BUSHWILL_LIVE/fullchain.pem" "$CLIENT_CERT_DIR/bushwill_fullchain.pem"
sudo cp "$BUSHWILL_LIVE/privkey.pem" "$CLIENT_CERT_DIR/bushwill_privkey.pem"
sudo chown "$repo_owner_group" \
  "$CLIENT_CERT_DIR/fullchain.pem" \
  "$CLIENT_CERT_DIR/privkey.pem" \
  "$CLIENT_CERT_DIR/bushwill_fullchain.pem" \
  "$CLIENT_CERT_DIR/bushwill_privkey.pem"

echo "Rebuilding and starting $CLIENT_SERVICE..."
"$COMPOSE_CMD" up -d --build "$CLIENT_SERVICE"
client_stopped=0

echo "Certificate renewal complete."