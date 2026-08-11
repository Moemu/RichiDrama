#!/usr/bin/env bash
# Restore a backup created by backup-data.sh. This intentionally requires an
# explicit confirmation because it replaces the live database and media files.
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/data/apps/LocalMiniDrama}"
DATA_DIR="${MINIDRAMA_DATA_DIR:-/data/minidrama-data}"
ARCHIVE="${1:-}"
[[ "${ARCHIVE}" && "${2:-}" == "--confirm" ]] || { echo "Usage: $0 /absolute/path/minidrama-data-YYYYMMDDTHHMMSSZ.tar.gz --confirm" >&2; exit 2; }
[[ "${DATA_DIR}" = /* && "${ARCHIVE}" = /* && -f "${ARCHIVE}" ]] || { echo "Data directory and archive must be existing absolute paths." >&2; exit 2; }
[[ "$(realpath -m "${DATA_DIR}")" != "/" && "$(realpath -m "${DATA_DIR}")" != "$(realpath -m "${PROJECT_DIR}")" ]] || { echo "Refusing an unsafe data directory: ${DATA_DIR}" >&2; exit 2; }

docker compose -f "${PROJECT_DIR}/docker-compose.yml" stop app
mkdir -p "${DATA_DIR}"
find "${DATA_DIR}" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
tar -C "${DATA_DIR}" -xzf "${ARCHIVE}"
docker compose -f "${PROJECT_DIR}/docker-compose.yml" up -d app
echo "Restore completed from: ${ARCHIVE}"
