#!/usr/bin/env bash
# Create a consistent, restorable copy of the SQLite database and local media.
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/data/apps/LocalMiniDrama}"
DATA_DIR="${MINIDRAMA_DATA_DIR:-/data/minidrama-data}"
BACKUP_DIR="${MINIDRAMA_BACKUP_DIR:-/data/minidrama-backups}"
QUIET=false
[[ "${1:-}" == "--quiet" ]] && QUIET=true

[[ "${DATA_DIR}" = /* && "${BACKUP_DIR}" = /* ]] || { echo "Data and backup directories must be absolute paths." >&2; exit 1; }
mkdir -p "${DATA_DIR}" "${BACKUP_DIR}"

DB_FILE="${DATA_DIR}/drama_generator.db"
if [[ ! -f "${DB_FILE}" ]]; then
  ${QUIET} || echo "No existing database; skipping backup."
  exit 0
fi

# If the application is running, checkpoint WAL first so the archive contains a
# self-contained database file. A failed checkpoint must abort deployment.
if docker compose -f "${PROJECT_DIR}/docker-compose.yml" ps -q app 2>/dev/null | grep -q .; then
  docker compose -f "${PROJECT_DIR}/docker-compose.yml" exec -T app node -e "const Database=require('better-sqlite3'); const db=new Database('/app/backend-node/data/drama_generator.db'); db.pragma('wal_checkpoint(TRUNCATE)'); db.close();"
fi

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ARCHIVE="${BACKUP_DIR}/minidrama-data-${STAMP}.tar.gz"
tar -C "${DATA_DIR}" -czf "${ARCHIVE}" .
find "${BACKUP_DIR}" -maxdepth 1 -type f -name 'minidrama-data-*.tar.gz' -printf '%T@ %p\n' | sort -nr | tail -n +15 | cut -d' ' -f2- | xargs -r rm -f --
${QUIET} || echo "Backup created: ${ARCHIVE}"
