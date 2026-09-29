#!/usr/bin/env bash
# Create either a release-safe SQLite snapshot or a full local-media archive.
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/data/apps/LocalMiniDrama}"
DATA_DIR="${MINIDRAMA_DATA_DIR:-/data/minidrama-data}"
BACKUP_DIR="${MINIDRAMA_BACKUP_DIR:-/data/minidrama-backups}"
APP_CONTAINER="${MINIDRAMA_PROD_CONTAINER:-local-minidrama}"
COMPOSE_FILE="${PROJECT_DIR}/docker-compose.yml"
CONTAINER_DATA_DIR='/app/backend-node/data'
CONTAINER_DB="${CONTAINER_DATA_DIR}/drama_generator.db"
STAGING_DIRNAME='.backup-staging'
MODE="full"
QUIET=false
ALLOW_UNVERIFIED=false
say() { [[ "${QUIET}" == true ]] || printf '%s\n' "$*"; }
usage() { echo "Usage: $0 [--release|--full] [--quiet] [--allow-unverified-database]" >&2; }
for arg in "$@"; do
  case "${arg}" in
    --quiet) QUIET=true ;;
    --full) MODE="full" ;;
    --release) MODE="release" ;;
    --allow-unverified-database) ALLOW_UNVERIFIED=true ;;
    *) usage; exit 2 ;;
  esac
done

[[ "${DATA_DIR}" = /* && "${BACKUP_DIR}" = /* ]] || { echo "Data and backup directories must be absolute paths." >&2; exit 1; }
mkdir -p "${DATA_DIR}" "${BACKUP_DIR}"

DB_FILE="${DATA_DIR}/drama_generator.db"
if [[ ! -f "${DB_FILE}" ]]; then
  say "No existing database; skipping backup."
  exit 0
fi

# Resolve how to run node inside the live application. Production starts the
# container with `docker run`, so a Compose-only guard skipped the SQLite
# checkpoint on every nightly run and archived a database together with its
# write-ahead log instead of one consistent snapshot.
#
# The probe must be conclusive. If the Docker daemon itself cannot be reached,
# an archive of the database files might be a torn copy of a live database, and
# promoting it would replace the last trustworthy recovery point.
RUNTIME_KIND=''
DOCKER_REACHABLE=false
if docker info >/dev/null 2>&1; then
  DOCKER_REACHABLE=true
  if docker inspect "${APP_CONTAINER}" >/dev/null 2>&1; then
    RUNTIME_KIND='docker'
  elif docker compose -f "${COMPOSE_FILE}" ps -q app 2>/dev/null | grep -q .; then
    RUNTIME_KIND='compose'
  fi
fi
app_is_running() { [[ -n "${RUNTIME_KIND}" ]]; }
app_node() {
  local script="$1"
  shift
  local overrides=()
  local pair
  for pair in "$@"; do
    overrides+=(-e "${pair}")
  done
  # `-T` only exists on `docker compose exec`; `docker exec` rejects it as an
  # unknown flag and exits 125, which took the whole nightly run down.
  if [[ "${RUNTIME_KIND}" == docker ]]; then
    docker exec "${overrides[@]}" "${APP_CONTAINER}" node -e "${script}"
  else
    docker compose -f "${COMPOSE_FILE}" exec -T "${overrides[@]}" app node -e "${script}"
  fi
}

has_zstd() { command -v zstd >/dev/null 2>&1; }
archive_suffix() { if has_zstd; then printf 'zst'; else printf 'gz'; fi; }
archive_stream() {
  if [[ "$1" == *.tar.zst ]]; then
    zstd -dc -q -- "$1"
  else
    gzip -dc -- "$1"
  fi
}
archive_listing() { archive_stream "$1" | tar -tf -; }

# better-sqlite3's backup API yields a transactional online snapshot. The target
# is a path inside the container mount because that is the only location the
# application container can write to; the caller reads the same file from the
# host side.
create_sqlite_snapshot() {
  local container_target="$1" host_target="$2"
  mkdir -p "$(dirname "${host_target}")"
  app_node 'const Database=require("better-sqlite3");(async()=>{const db=new Database(process.env.SNAPSHOT_SOURCE,{readonly:true});await db.backup(process.env.SNAPSHOT_TARGET);db.close();})().catch(e=>{console.error(e);process.exit(1);});' \
    "SNAPSHOT_SOURCE=${CONTAINER_DB}" "SNAPSHOT_TARGET=${container_target}"
}

verify_sqlite_snapshot() {
  app_node 'const Database=require("better-sqlite3");const db=new Database(process.env.SNAPSHOT_TARGET,{readonly:true});const row=db.pragma("integrity_check",{simple:true});db.close();if(row!=="ok")process.exit(1);' \
    "SNAPSHOT_TARGET=$1"
}

count_unsynced_media() {
  app_node 'const Database=require("better-sqlite3");const db=new Database(process.env.SNAPSHOT_SOURCE,{readonly:true});const row=db.prepare("SELECT COUNT(*) AS count FROM media_archive_records WHERE archive_status NOT IN (?,?)").get("oss_synced","local_pruned");console.log(row.count);db.close();' \
    "SNAPSHOT_SOURCE=${CONTAINER_DB}"
}

# A media finalisation may replace or remove a file while the tree is walked.
# Those are the only diagnostics that still describe a usable archive; anything
# else, and any complaint about the staged database, means bytes are missing.
TOLERABLE_TAR_DIAGNOSTICS='file changed as we read it|File removed before we read it|Cannot stat: No such file or directory|Cannot open: No such file or directory'

# GNU tar returns 1 when an input file was replaced during the run and, on some
# builds, only reports vanished files as warnings with status 0. The exit status
# is therefore not the control: the diagnostics are.
run_tar() {
  local archive="$1"
  shift
  local compressor=(gzip -6)
  if has_zstd; then
    compressor=(zstd -T0 -3 -q)
  fi
  local diagnostics="${archive}.diagnostics"
  local statuses=()
  rm -f -- "${archive}" "${diagnostics}"
  set +e
  "${@}" 2> "${diagnostics}" | "${compressor[@]}" > "${archive}"
  statuses=("${PIPESTATUS[@]}")
  set -e
  if [[ "${statuses[0]}" -ge 2 || "${statuses[1]}" -ne 0 ]]; then
    cat -- "${diagnostics}" >&2
    rm -f -- "${archive}" "${diagnostics}"
    echo "Backup aborted: tar status ${statuses[0]}, compressor status ${statuses[1]}." >&2
    return 1
  fi
  if grep -vE "${TOLERABLE_TAR_DIAGNOSTICS}" -- "${diagnostics}" | grep -q '[^[:space:]]' ||
    grep -q 'drama_generator\.db' -- "${diagnostics}"; then
    cat -- "${diagnostics}" >&2
    rm -f -- "${archive}" "${diagnostics}"
    echo 'Backup aborted: tar reported a file the archive is allowed to be missing.' >&2
    return 1
  fi
  if [[ -s "${diagnostics}" ]]; then
    # Tolerated races still mean bytes are missing from this archive, so they
    # are reported instead of being thrown away.
    echo "Backup proceeded after $(wc -l < "${diagnostics}") media race diagnostic(s):" >&2
    sed -n '1,20p' -- "${diagnostics}" >&2
  fi
  rm -f -- "${diagnostics}"
  [[ -s "${archive}" ]] || { rm -f -- "${archive}"; echo "Backup archive is empty." >&2; return 1; }
  if has_zstd; then
    zstd -q -t -- "${archive}"
    zstd -dc -q -- "${archive}" | tar -tf - >/dev/null
  else
    gzip -t -- "${archive}"
    gzip -dc -- "${archive}" | tar -tf - >/dev/null
  fi
}

# Confirms that the archived database really is a SQLite file before an existing
# recovery point is allowed to be deleted.
verify_archived_database() {
  local archive="$1" member listing
  listing="$(archive_listing "${archive}")"
  member="$(printf '%s\n' "${listing}" | grep -E '(^|/)drama_generator\.db$' | head -n1)"
  [[ -n "${member}" ]] || { echo "The archive contains no database file: ${archive}" >&2; return 1; }
  local check_file
  check_file="$(mktemp)"
  archive_stream "${archive}" | tar -xOf - "${member}" > "${check_file}"
  if [[ "$(head -c 15 "${check_file}")" != 'SQLite format 3' ]]; then
    rm -f -- "${check_file}"
    echo "The archived database is not a SQLite file: ${archive}" >&2
    return 1
  fi
  rm -f -- "${check_file}"
}

prune_archives() {
  local prefix="$1" keep="$2" directory="$3"
  [[ "${keep}" =~ ^[1-9][0-9]*$ ]] || { echo "${prefix} retention count must be a positive integer." >&2; return 1; }
  find "${directory}" -maxdepth 1 -type f \( -name "${prefix}*.tar.gz" -o -name "${prefix}*.tar.zst" \) \
    -printf '%T@ %p\n' | sort -nr | tail -n +$((keep + 1)) | cut -d' ' -f2- | xargs -r rm -f --
}

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
CONTAINER_STAGE="${CONTAINER_DATA_DIR}/${STAGING_DIRNAME}/${STAMP}"
HOST_STAGE="${DATA_DIR}/${STAGING_DIRNAME}/${STAMP}"

# The staged snapshot only has to outlive this process. The parent is removed
# when no other backup is staging a snapshot at the same time.
cleanup_stage() {
  rm -rf -- "${HOST_STAGE}"
  rmdir "${DATA_DIR}/${STAGING_DIRNAME}" 2>/dev/null || true
}

# A release must never become the only recovery point for media that has not
# reached OSS. Completed media is mirrored by the application; refusing a
# deployment while that invariant is false is safer than silently skipping it.
if [[ "${MODE}" == "release" ]]; then
  if ! app_is_running; then
    echo "Cannot verify OSS archive ledger; deployment backup refused." >&2
    exit 1
  fi
  RELEASE_DIR="${BACKUP_DIR}/releases"
  mkdir -p "${RELEASE_DIR}" "${HOST_STAGE}"
  trap cleanup_stage EXIT

  UNSYNCED="$(count_unsynced_media 2>/dev/null || true)"
  [[ "${UNSYNCED}" =~ ^[0-9]+$ ]] || { echo "Cannot verify OSS archive ledger; deployment backup refused." >&2; exit 1; }
  [[ "${UNSYNCED}" == "0" ]] || { echo "${UNSYNCED} media item(s) are not OSS-synced; deployment backup refused." >&2; exit 1; }

  create_sqlite_snapshot "${CONTAINER_STAGE}/drama_generator.db" "${HOST_STAGE}/drama_generator.db"
  verify_sqlite_snapshot "${CONTAINER_STAGE}/drama_generator.db"
  printf 'created_at=%s\nkind=release_sqlite_snapshot\noss_unsynced_media=0\n' "${STAMP}" > "${HOST_STAGE}/manifest.txt"
  ARCHIVE="${RELEASE_DIR}/minidrama-release-${STAMP}.tar.$(archive_suffix)"
  run_tar "${ARCHIVE}" tar -cf - -C "${HOST_STAGE}" .
  prune_archives 'minidrama-release-' "${RELEASE_BACKUP_RETAIN_COUNT:-30}" "${RELEASE_DIR}"
  say "Release snapshot created: ${ARCHIVE}"
  exit 0
fi

# Deployment scratch directories live inside the data mount. A staged snapshot
# left behind by a crashed release would otherwise ride along in every later
# archive, so the same bytes would be backed up again and again.
TAR_OPTS=(tar -cf - --ignore-failed-read
  --warning=no-file-changed --warning=no-file-removed
  --exclude="./${STAGING_DIRNAME}" --exclude='./.deploy-snapshots'
  --exclude='./.release-backup-staging' --exclude='./.manual-backups')
TAR_MEMBERS=(-C "${DATA_DIR}" .)
SNAPSHOT_VERIFIED=false

if app_is_running; then
  mkdir -p "${HOST_STAGE}"
  trap cleanup_stage EXIT
  create_sqlite_snapshot "${CONTAINER_STAGE}/drama_generator.db" "${HOST_STAGE}/drama_generator.db"
  verify_sqlite_snapshot "${CONTAINER_STAGE}/drama_generator.db"
  # The live database file and its WAL/SHM partners are replaced by the verified
  # snapshot, so the archive carries one transactionally consistent copy instead
  # of a database plus a second partial copy of the same pages. Every exclusion
  # is declared before the member list so it also applies to the walked tree.
  TAR_OPTS+=(--exclude='./drama_generator.db' --exclude='*.db-wal' --exclude='*.db-shm')
  TAR_MEMBERS+=(-C "${HOST_STAGE}" drama_generator.db)
  SNAPSHOT_VERIFIED=true
elif [[ "${DOCKER_REACHABLE}" == true ]]; then
  # The daemon answers and no RichiDrama container exists, so nothing can be
  # writing the database: the files, write-ahead log included, are static.
  echo "No RichiDrama container is running; archiving the idle database files." >&2
else
  if [[ "${ALLOW_UNVERIFIED}" != true ]]; then
    echo "Docker is unreachable, so it cannot be verified that the database is idle. Refusing to archive; pass --allow-unverified-database to override." >&2
    exit 1
  fi
  echo "Docker is unreachable; archiving database files that no run can certify." >&2
fi

ARCHIVE="${BACKUP_DIR}/minidrama-data-${STAMP}.tar.$(archive_suffix)"
# Video and image workers keep writing under the media directory while a backup
# is taken, so the media tree is read with the diagnostics classified above.
run_tar "${ARCHIVE}" "${TAR_OPTS[@]}" "${TAR_MEMBERS[@]}"
if [[ "${SNAPSHOT_VERIFIED}" != true ]]; then
  if ! verify_archived_database "${ARCHIVE}"; then
    # A new archive that cannot be certified must not stay in the backup
    # directory: the next successful run would count it against retention and
    # push out the last trustworthy recovery point.
    rm -f -- "${ARCHIVE}"
    echo "Backup discarded: the archived database did not pass verification." >&2
    exit 1
  fi
fi
FULL_BACKUP_RETAIN_COUNT="${FULL_BACKUP_RETAIN_COUNT:-14}"
if [[ "${DOCKER_REACHABLE}" == true ]]; then
  prune_archives 'minidrama-data-' "${FULL_BACKUP_RETAIN_COUNT}" "${BACKUP_DIR}"
else
  echo "Keeping every previous archive: this run could not certify its own database copy." >&2
fi
say "Backup created: ${ARCHIVE}"
