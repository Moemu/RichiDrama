#!/usr/bin/env bash
set -euo pipefail
: "${CERTBOT_TOKEN:?CERTBOT_TOKEN is required}"
: "${CERTBOT_VALIDATION:?CERTBOT_VALIDATION is required}"
NGINX_CONTAINER="${MINIDRAMA_HTTP_NGINX_CONTAINER:-${MINIDRAMA_NGINX_CONTAINER:-lens-rhyme-nginx-1}}"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
printf '%s' "$CERTBOT_VALIDATION" > "$tmp"
chmod 644 "$tmp"
docker exec "$NGINX_CONTAINER" mkdir -p /var/www/minidrama-acme/.well-known/acme-challenge
docker cp "$tmp" "$NGINX_CONTAINER:/var/www/minidrama-acme/.well-known/acme-challenge/$CERTBOT_TOKEN"
docker exec "$NGINX_CONTAINER" chmod 644 "/var/www/minidrama-acme/.well-known/acme-challenge/$CERTBOT_TOKEN"
