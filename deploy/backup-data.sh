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
# Video and image workers keep writing under the media directory while a
# deployment backup is taken.  A file that is replaced by an atomic media
# finalization during this window must not cancel an otherwise safe release:
# the SQLite checkpoint above is the transactional database boundary and the
# completed media is also mirrored to OSS.  GNU tar records those races as
# warnings; ignore only unreadable/changing input files, then validate that a
# non-empty archive was still created before continuing.
tar -C "${DATA_DIR}" --ignore-failed-read \
  --warning=no-file-changed --warning=no-file-removed \
  -czf "${ARCHIVE}" .
[[ -s "${ARCHIVE}" ]] || { rm -f -- "${ARCHIVE}"; echo "Backup archive is empty." >&2; exit 1; }
tar -tzf "${ARCHIVE}" >/dev/null
find "${BACKUP_DIR}" -maxdepth 1 -type f -name 'minidrama-data-*.tar.gz' -printf '%T@ %p\n' | sort -nr | tail -n +15 | cut -d' ' -f2- | xargs -r rm -f --
${QUIET} || echo "Backup created: ${ARCHIVE}"
