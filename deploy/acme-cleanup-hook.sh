#!/usr/bin/env bash
set -euo pipefail
: "${CERTBOT_TOKEN:?CERTBOT_TOKEN is required}"
NGINX_CONTAINER="${MINIDRAMA_HTTP_NGINX_CONTAINER:-${MINIDRAMA_NGINX_CONTAINER:-lens-rhyme-nginx-1}}"
docker exec "$NGINX_CONTAINER" rm -f "/var/www/minidrama-acme/.well-known/acme-challenge/$CERTBOT_TOKEN"
