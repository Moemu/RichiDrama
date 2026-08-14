#!/usr/bin/env bash
# Create either a release-safe SQLite checkpoint or a full local-media archive.
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/data/apps/LocalMiniDrama}"
DATA_DIR="${MINIDRAMA_DATA_DIR:-/data/minidrama-data}"
BACKUP_DIR="${MINIDRAMA_BACKUP_DIR:-/data/minidrama-backups}"
QUIET=false
MODE="full"
for arg in "$@"; do
  case "${arg}" in
    --quiet) QUIET=true ;;
    --full) MODE="full" ;;
    --release) MODE="release" ;;
    *) echo "Usage: $0 [--release|--full] [--quiet]" >&2; exit 2 ;;
  esac
done

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

# A release must never become the only recovery point for media that has not
# reached OSS. Completed media is mirrored by the application; refusing a
# deployment while that invariant is false is safer than silently skipping it.
if [[ "${MODE}" == "release" ]]; then
  RELEASE_DIR="${BACKUP_DIR}/releases"
  STAGE_DIR="${DATA_DIR}/.release-backup-staging/${STAMP}"
  mkdir -p "${RELEASE_DIR}" "${STAGE_DIR}"
  cleanup_stage() { rm -rf -- "${STAGE_DIR}"; }
  trap cleanup_stage EXIT

  UNSYNCED=$(docker compose -f "${PROJECT_DIR}/docker-compose.yml" exec -T app node -e 'const Database=require("better-sqlite3"); const db=new Database("/app/backend-node/data/drama_generator.db",{readonly:true}); const quote=String.fromCharCode(39); const row=db.prepare("SELECT COUNT(*) AS count FROM media_archive_records WHERE archive_status NOT IN ("+quote+"oss_synced"+quote+","+quote+"local_pruned"+quote+")").get(); console.log(row.count); db.close();' 2>/dev/null || true)
  [[ "${UNSYNCED}" =~ ^[0-9]+$ ]] || { echo "Cannot verify OSS archive ledger; deployment backup refused." >&2; exit 1; }
  [[ "${UNSYNCED}" == "0" ]] || { echo "${UNSYNCED} media item(s) are not OSS-synced; deployment backup refused." >&2; exit 1; }

  # better-sqlite3's backup API obtains a consistent online snapshot without
  # copying the 4+ GB local hot replica for every source-code release.
  docker compose -f "${PROJECT_DIR}/docker-compose.yml" exec -T \
    -e RELEASE_DB_TARGET="/app/backend-node/data/.release-backup-staging/${STAMP}/drama_generator.db" \
    app node -e 'const Database=require("better-sqlite3"); (async()=>{const db=new Database("/app/backend-node/data/drama_generator.db",{readonly:true}); await db.backup(process.env.RELEASE_DB_TARGET); db.close();})().catch(e=>{console.error(e);process.exit(1);});'
  docker compose -f "${PROJECT_DIR}/docker-compose.yml" exec -T \
    -e RELEASE_DB_TARGET="/app/backend-node/data/.release-backup-staging/${STAMP}/drama_generator.db" \
    app node -e 'const Database=require("better-sqlite3"); const db=new Database(process.env.RELEASE_DB_TARGET,{readonly:true}); const row=db.pragma("integrity_check",{simple:true}); db.close(); if(row!=="ok") process.exit(1);'
  printf 'created_at=%s\nkind=release_sqlite_snapshot\noss_unsynced_media=0\n' "${STAMP}" > "${STAGE_DIR}/manifest.txt"
  ARCHIVE="${RELEASE_DIR}/minidrama-release-${STAMP}.tar.gz"
  tar -C "${STAGE_DIR}" -czf "${ARCHIVE}" .
  [[ -s "${ARCHIVE}" ]] || { rm -f -- "${ARCHIVE}"; echo "Release archive is empty." >&2; exit 1; }
  tar -tzf "${ARCHIVE}" >/dev/null
  find "${RELEASE_DIR}" -maxdepth 1 -type f -name 'minidrama-release-*.tar.gz' -printf '%T@ %p\n' | sort -nr | tail -n +31 | cut -d' ' -f2- | xargs -r rm -f --
  ${QUIET} || echo "Release snapshot created: ${ARCHIVE}"
  exit 0
fi

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
FULL_BACKUP_RETAIN_COUNT="${FULL_BACKUP_RETAIN_COUNT:-14}"
[[ "${FULL_BACKUP_RETAIN_COUNT}" =~ ^[1-9][0-9]*$ ]] || { echo "FULL_BACKUP_RETAIN_COUNT must be a positive integer." >&2; exit 1; }
find "${BACKUP_DIR}" -maxdepth 1 -type f -name 'minidrama-data-*.tar.gz' -printf '%T@ %p\n' | sort -nr | tail -n +$((FULL_BACKUP_RETAIN_COUNT + 1)) | cut -d' ' -f2- | xargs -r rm -f --
${QUIET} || echo "Backup created: ${ARCHIVE}"
