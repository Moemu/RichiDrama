#!/usr/bin/env bash
# Restore a backup created by backup-data.sh. This intentionally requires an
# explicit confirmation because it replaces the live database and media files.
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/data/apps/LocalMiniDrama}"
DATA_DIR="${MINIDRAMA_DATA_DIR:-/data/minidrama-data}"
APP_CONTAINER="${MINIDRAMA_PROD_CONTAINER:-local-minidrama}"
ARCHIVE="${1:-}"
CONFIRMED=false
SKIP_DATABASE_CHECK=false
usage() { echo "Usage: $0 /absolute/path/minidrama-data-YYYYMMDDTHHMMSSZ.tar.(zst|gz) --confirm [--skip-database-check]" >&2; }
for flag in "${@:2}"; do
  case "${flag}" in
    --confirm) CONFIRMED=true ;;
    --skip-database-check) SKIP_DATABASE_CHECK=true ;;
    *) usage; exit 2 ;;
  esac
done
[[ -n "${ARCHIVE}" && "${CONFIRMED}" == true ]] || { usage; exit 2; }
[[ "${DATA_DIR}" = /* && "${ARCHIVE}" = /* && -f "${ARCHIVE}" ]] || { echo "Data directory and archive must be existing absolute paths." >&2; exit 2; }
[[ "$(realpath -m "${DATA_DIR}")" != "/" && "$(realpath -m "${DATA_DIR}")" != "$(realpath -m "${PROJECT_DIR}")" ]] || { echo "Refusing an unsafe data directory: ${DATA_DIR}" >&2; exit 2; }

die() { echo "$*" >&2; exit 1; }

# Production runs the container through `docker run`, so stopping only the
# Compose service would leave the live application writing over the restored
# files.
COMPOSE_FILE="${PROJECT_DIR}/docker-compose.yml"
RUNTIME_KIND=''
if docker inspect "${APP_CONTAINER}" >/dev/null 2>&1; then
  RUNTIME_KIND='docker'
elif docker compose -f "${COMPOSE_FILE}" ps -q app 2>/dev/null | grep -q .; then
  RUNTIME_KIND='compose'
else
  echo "No RichiDrama application container is available; restoring into ${DATA_DIR} anyway." >&2
fi
stop_app() {
  case "${RUNTIME_KIND}" in
    docker) docker stop --time 20 "${APP_CONTAINER}" >/dev/null ;;
    compose) docker compose -f "${COMPOSE_FILE}" stop app ;;
  esac
}
start_app() {
  case "${RUNTIME_KIND}" in
    docker) docker start "${APP_CONTAINER}" >/dev/null ;;
    compose) docker compose -f "${COMPOSE_FILE}" up -d app ;;
  esac
}

CONTAINER_CHECK_PATH='/tmp/minidrama-restore-check.db'
INTEGRITY_SCRIPT='const Database=require("better-sqlite3");const db=new Database(process.argv[1],{readonly:true});const row=db.pragma("integrity_check",{simple:true});db.close();process.stdout.write(String(row));process.exit(row==="ok"?0:1);'
host_path() { cygpath -w "$1" 2>/dev/null || printf '%s' "$1"; }
container_copy_in() {
  if [[ "${RUNTIME_KIND}" == docker ]]; then
    docker cp "$1" "${APP_CONTAINER}:$2"
  else
    docker compose -f "${COMPOSE_FILE}" cp "$1" "app:$2"
  fi
}
container_node() {
  if [[ "${RUNTIME_KIND}" == docker ]]; then
    docker exec "${APP_CONTAINER}" node -e "$1" "$2"
  else
    docker compose -f "${COMPOSE_FILE}" exec -T app node -e "$1" "$2"
  fi
}

# A file header alone is not proof that the database is sound, and a restore
# destroys live data. The extracted database is therefore handed to whichever
# SQLite checker is actually available. An empty result means "no checker ran",
# and a checker that failed without printing a verdict means "unreadable".
capture_verdict() {
  local output status
  set +e
  output="$("${@}" 2>&1 | head -n1)"
  status="${PIPESTATUS[0]}"
  set -e
  if [[ -n "${output}" ]]; then
    printf '%s\n' "${output}"
  elif [[ "${status}" -ne 0 ]]; then
    printf 'unreadable (exit %s)\n' "${status}"
  fi
}

database_verdict() {
  local file="$1" verdict=''
  if command -v sqlite3 >/dev/null 2>&1; then
    verdict="$(capture_verdict sqlite3 "file:$(host_path "${file}")?mode=ro" 'PRAGMA integrity_check;')"
  fi
  if [[ -z "${verdict}" ]] && command -v node >/dev/null 2>&1 && [[ -d "${PROJECT_DIR}/backend-node/node_modules/better-sqlite3" ]]; then
    verdict="$(NODE_PATH="${PROJECT_DIR}/backend-node/node_modules" capture_verdict node -e "${INTEGRITY_SCRIPT}" "$(host_path "${file}")")"
  fi
  if [[ -z "${verdict}" && -n "${RUNTIME_KIND}" ]] && container_copy_in "${file}" "${CONTAINER_CHECK_PATH}" >/dev/null 2>&1; then
    verdict="$(capture_verdict container_node "${INTEGRITY_SCRIPT}" "${CONTAINER_CHECK_PATH}")"
    container_node 'require("fs").unlinkSync(process.argv[1])' "${CONTAINER_CHECK_PATH}" >/dev/null 2>&1 || true
  fi
  printf '%s\n' "${verdict}"
}

# Archives are zstandard when the host provides zstd and gzip otherwise, so the
# decompressor is chosen by suffix instead of being hardcoded.
case "${ARCHIVE}" in
  *.tar.zst)
    command -v zstd >/dev/null 2>&1 || die "zstd is required to read ${ARCHIVE}."
    DECOMPRESS=(zstd -dc -q -- "${ARCHIVE}")
    VERIFY=(zstd -q -t -- "${ARCHIVE}")
    ;;
  *.tar.gz) DECOMPRESS=(gzip -dc -- "${ARCHIVE}"); VERIFY=(gzip -t -- "${ARCHIVE}") ;;
  *) die "Unrecognised archive suffix: ${ARCHIVE}" ;;
esac

# Validate the whole archive before anything destructive. The listing reads the
# stream to its end, so a truncated or corrupt archive fails here instead of
# after the live data directory has been removed.
"${VERIFY[@]}" || die "Archive integrity check failed: ${ARCHIVE}"
LISTING="$("${DECOMPRESS[@]}" | tar -tf -)"
DB_MEMBER="$(printf '%s\n' "${LISTING}" | grep -E '(^|/)drama_generator\.db$' | head -n1)"
[[ -n "${DB_MEMBER}" ]] || die "The archive contains no database file: ${ARCHIVE}"
printf '%s\n' "${LISTING}" | grep -qE '(^|/)storage(/|$)' || echo "Warning: the archive contains no storage tree; completed media is expected from OSS." >&2

CHECK_FILE="$(mktemp)"
trap 'rm -f -- "${CHECK_FILE}"' EXIT
"${DECOMPRESS[@]}" | tar -xOf - "${DB_MEMBER}" > "${CHECK_FILE}"
[[ "$(head -c 15 "${CHECK_FILE}")" == 'SQLite format 3' ]] || die "The archived database is not a SQLite file: ${DB_MEMBER}"
VERDICT="$(database_verdict "${CHECK_FILE}")"
if [[ "${SKIP_DATABASE_CHECK}" == true ]]; then
  echo "Skipping the SQLite integrity check as requested." >&2
elif [[ -n "${VERDICT}" ]]; then
  [[ "${VERDICT}" == 'ok' ]] || die "The archived database failed its integrity check: ${VERDICT:0:200}"
else
  echo "Warning: no SQLite checker is available on this host; the archived database was only recognised as a SQLite file." >&2
fi
rm -f -- "${CHECK_FILE}"
trap - EXIT

stop_app
mkdir -p "${DATA_DIR}"
find "${DATA_DIR}" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
"${DECOMPRESS[@]}" | tar -C "${DATA_DIR}" -xf -
[[ -f "${DATA_DIR}/drama_generator.db" ]] || die "Restore did not produce ${DATA_DIR}/drama_generator.db"
start_app
echo "Restore completed from: ${ARCHIVE}"
