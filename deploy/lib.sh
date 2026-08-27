#!/usr/bin/env bash
set -euo pipefail

PREVIEW_ROOT="${MINIDRAMA_PREVIEW_ROOT:-/data/minidrama-previews}"
RELEASE_ROOT="${MINIDRAMA_RELEASE_ROOT:-/data/minidrama-releases}"
INCOMING_ROOT="${MINIDRAMA_INCOMING_ROOT:-/data/minidrama-incoming}"
PROD_DATA_DIR="${MINIDRAMA_DATA_DIR:-/data/minidrama-data}"
DEPLOY_LOCK="${MINIDRAMA_DEPLOY_LOCK:-/var/lock/minidrama-deploy.lock}"
PROD_CONTAINER="${MINIDRAMA_PROD_CONTAINER:-local-minidrama}"
HTTP_NGINX_CONTAINER="${MINIDRAMA_HTTP_NGINX_CONTAINER:-${MINIDRAMA_NGINX_CONTAINER:-lens-rhyme-nginx-1}}"
PROD_PROXY_NETWORK="${MINIDRAMA_PROXY_NETWORK:-lens-rhyme_default}"
# shellcheck disable=SC2034 # Used by scripts that source this library.
PREVIEW_NETWORK="${MINIDRAMA_PREVIEW_NETWORK:-minidrama-previews}"
PREVIEW_EDGE_CONTAINER="${MINIDRAMA_PREVIEW_EDGE_CONTAINER:-minidrama-preview-edge}"
PREVIEW_MEDIA_PROXY_CONTAINER="${MINIDRAMA_PREVIEW_MEDIA_PROXY_CONTAINER:-minidrama-preview-media-proxy}"

log() { printf '[%s] %s\n' "$(date '+%F %T')" "$*" >&2; }
fail() { log "ERROR: $*" >&2; exit 1; }

require_root() { [[ "$(id -u)" == "0" ]] || fail 'Run this command as root.'; }

# Production boots must never silently degrade to local storage because an
# environment file went missing alongside a repository refresh. Previews are
# exempt by design: resolve_env_file stays tolerant for other callers.
require_env_file() {
  local file
  file="$(resolve_env_file)"
  [[ -n "$file" ]] || fail \
    'Production environment file not found. Put minidrama.oss.env in /data/minidrama-config (template: deploy/minidrama.oss.env.example).'
  printf '%s\n' "$file"
}

acquire_lock() {
  mkdir -p "$(dirname "$DEPLOY_LOCK")"
  exec 9>"$DEPLOY_LOCK"
  flock -n 9 || fail 'Another RichiDrama deployment operation is running.'
}

validate_sha() { [[ "${1:-}" =~ ^[0-9a-f]{40}$ ]] || fail "Invalid commit SHA: ${1:-<empty>}"; }
validate_pr() { [[ "${1:-}" =~ ^[1-9][0-9]*$ ]] || fail "Invalid PR number: ${1:-<empty>}"; }

resolve_env_file() {
  local candidates=(
    "${MINIDRAMA_ENV_FILE:-}"
    "/data/minidrama-config/minidrama.oss.env"
    "/data/apps/LocalMiniDrama/minidrama.oss.env"
  )
  local candidate
  for candidate in "${candidates[@]}"; do
    if [[ -n "$candidate" && -f "$candidate" ]]; then printf '%s\n' "$candidate"; return; fi
  done
  printf '%s\n' ''
}

require_running_container() {
  local container="$1"
  docker ps --format '{{.Names}}' | grep -Fqx "$container" || fail "Required container is not running: $container"
}

require_container_network() {
  local container="$1" network="$2" networks
  require_running_container "$container"
  docker network inspect "$network" >/dev/null 2>&1 || fail "Docker network does not exist: $network"
  networks="$(docker inspect --format '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' "$container")"
  grep -Fqx "$network" <<<"$networks" || fail "Container $container is not connected to network $network"
}

validate_production_ingress() {
  require_container_network "$HTTP_NGINX_CONTAINER" "$PROD_PROXY_NETWORK"
  docker exec "$HTTP_NGINX_CONTAINER" sh -eu -c '
    default=/etc/nginx/conf.d/default.conf
    stale=/etc/nginx/conf.d/minidrama.conf
    disabled=/etc/nginx/minidrama.conf.disabled
    grep -Eq "server_name[[:space:]]+drama\\.richbest\\.cn;" "$default"
    grep -Eq "proxy_pass[[:space:]]+http://minidrama-app:5679" "$default"
    if [ -f "$stale" ]; then
      mv "$stale" "$disabled"
      if ! nginx -t; then
        mv "$disabled" "$stale"
        exit 1
      fi
    fi
    count="$(nginx -T 2>&1 | grep -Ec "server_name[[:space:]]+drama\\.richbest\\.cn;")"
    [ "$count" -eq 1 ]
    getent hosts minidrama-app >/dev/null
    nginx -t
  ' || fail 'Production Nginx ingress validation failed.'
}

# Read-only variant for preview deploys: same guarantees, but it never moves
# production configuration — migrating legacy files is release-deploy work.
validate_production_ingress_readonly() {
  require_container_network "$HTTP_NGINX_CONTAINER" "$PROD_PROXY_NETWORK"
  docker exec "$HTTP_NGINX_CONTAINER" sh -eu -c '
    grep -Eq "server_name[[:space:]]+drama\\.richbest\\.cn;" /etc/nginx/conf.d/default.conf
    grep -Eq "proxy_pass[[:space:]]+http://minidrama-app:5679" /etc/nginx/conf.d/default.conf
    count="$(nginx -T 2>&1 | grep -Ec "server_name[[:space:]]+drama\\.richbest\\.cn;")"
    [ "$count" -eq 1 ]
    getent hosts minidrama-app >/dev/null
    nginx -t
  ' || fail 'Production Nginx ingress validation failed.'
}

prepare_source() {
  local sha="$1" archive="${INCOMING_ROOT}/${1}.tar.gz" target="${RELEASE_ROOT}/${1}/source" resolved_root resolved_target
  validate_sha "$sha"
  resolved_root="$(realpath -m "$RELEASE_ROOT")"
  resolved_target="$(realpath -m "$target")"
  [[ "$resolved_root" != '/' && "$resolved_target" == "$resolved_root/$sha/source" ]] || fail "Unsafe release path: $resolved_target"
  [[ -f "$archive" ]] || fail "Source archive not found: $archive"
  if tar -tzf "$archive" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
    fail 'Source archive contains an unsafe path.'
  fi
  mkdir -p "${RELEASE_ROOT}/${sha}"
  rm -rf "$target"
  mkdir -p "$target"
  tar -xzf "$archive" -C "$target"
  [[ -f "$target/Dockerfile" && -f "$target/backend-node/package.json" ]] || fail 'Source archive is incomplete.'
  printf '%s\n' "$target"
}

build_image() {
  local sha="$1" source_dir="$2" image="local-minidrama:${1}"
  if ! docker image inspect "$image" >/dev/null 2>&1; then
    log "Building immutable image $image"
    docker build --pull --build-arg "APP_REVISION=$sha" -t "$image" "$source_dir" || \
      fail "Immutable image build failed: $image"
  else
    log "Using existing image $image"
  fi
  printf '%s\n' "$image"
}

build_preview_image() {
  local sha="$1" source_dir="$2" image="local-minidrama:${1}"
  local base_image base_tag="local-minidrama:preview-runtime-base"
  if ! docker image inspect "$image" >/dev/null 2>&1; then
    require_running_container "$PROD_CONTAINER"
    base_image="$(docker inspect --format '{{.Image}}' "$PROD_CONTAINER")"
    [[ "$base_image" =~ ^sha256:[0-9a-f]{64}$ ]] || fail 'Cannot resolve the production image ID.'
    docker image tag "$base_image" "$base_tag"
    log "Building preview image $image from the active production runtime"
    docker build --file "$source_dir/Dockerfile.preview" \
      --build-arg "RUNTIME_BASE_IMAGE=$base_tag" \
      --build-arg "APP_REVISION=$sha" \
      -t "$image" "$source_dir" || fail "Preview image build failed: $image"
  else
    log "Using existing image $image"
  fi
  printf '%s\n' "$image"
}

create_online_snapshot() {
  local output="$1" name
  mkdir -p "$(dirname "$output")"
  rm -f "$output" "${output}-wal" "${output}-shm"
  if [[ ! -f "${PROD_DATA_DIR}/drama_generator.db" ]]; then
    log 'Production database does not exist. The verifier will create an empty database.'
    return
  fi
  docker inspect "$PROD_CONTAINER" >/dev/null 2>&1 || fail "Production container is not available: $PROD_CONTAINER"
  local env_file storage_type
  env_file="$(resolve_env_file)"
  storage_type="$(awk -F= '$1=="MINIDRAMA_STORAGE_TYPE"{gsub(/^[ \t]+|[ \t]+$/, "", $2); print tolower($2); exit}' "$env_file" 2>/dev/null || true)"
  if [[ "$storage_type" == oss ]]; then
    local unsynced
    unsynced="$(docker exec "$PROD_CONTAINER" node -e 'const Database=require("better-sqlite3");const db=new Database("/app/backend-node/data/drama_generator.db",{readonly:true});const exists=db.prepare("SELECT 1 FROM sqlite_master WHERE type=? AND name=?").get("table","media_archive_records");const count=exists?db.prepare("SELECT COUNT(*) count FROM media_archive_records WHERE archive_status NOT IN (?,?)").get("oss_synced","local_pruned").count:0;db.close();process.stdout.write(String(count))' 2>/dev/null || true)"
    [[ "$unsynced" =~ ^[0-9]+$ ]] || fail 'Cannot verify the production OSS archive ledger.'
    [[ "$unsynced" == 0 ]] || fail "$unsynced media records are not OSS-synced."
  fi
  name="snapshot-$(date +%s)-$$.db"
  mkdir -p "${PROD_DATA_DIR}/.deploy-snapshots"
  docker exec -e "SNAPSHOT_TARGET=/app/backend-node/data/.deploy-snapshots/${name}" "$PROD_CONTAINER" \
    node -e 'const Database=require("better-sqlite3");(async()=>{const db=new Database("/app/backend-node/data/drama_generator.db",{readonly:true});await db.backup(process.env.SNAPSHOT_TARGET);db.close()})().catch(e=>{console.error(e);process.exit(1)})'
  mv "${PROD_DATA_DIR}/.deploy-snapshots/${name}" "$output"
  [[ -f "$output" ]] || fail 'SQLite online backup did not create the snapshot.'
}

verify_migrations() {
  local image="$1" data_dir="$2"
  mkdir -p "$data_dir"
  log "Verifying migrations twice against $data_dir"
  docker run --rm --network none \
    --security-opt no-new-privileges --cap-drop ALL \
    -v "${data_dir}:/verify-data" \
    "$image" node tools/verify-migrations.js /verify-data/drama_generator.db
}

wait_container_ready() {
  local container="$1" revision="$2" timeout="${3:-90}" elapsed=0
  while (( elapsed < timeout )); do
    local actual
    actual="$(docker exec "$container" node -e 'require("http").get("http://127.0.0.1:5679/ready",r=>{let b="";r.on("data",c=>b+=c);r.on("end",()=>{try{if(r.statusCode===200)process.stdout.write(JSON.parse(b).revision||"")}catch(_){}})}).on("error",()=>{})' 2>/dev/null || true)"
    [[ "$actual" == "$revision" ]] && return 0
    sleep 3
    elapsed=$((elapsed + 3))
  done
  docker logs --tail 100 "$container" >&2 || true
  return 1
}

run_preflight_app() {
  local image="$1" sha="$2" data_dir="$3"
  local name="minidrama-preflight-${sha:0:12}"
  local env_file env_args=()
  env_file="$(resolve_env_file)"
  [[ -n "$env_file" ]] && env_args+=(--env-file "$env_file")
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker run -d --name "$name" --network none \
    --security-opt no-new-privileges --cap-drop ALL --pids-limit 256 \
    --memory 2g --cpus 1 --read-only --tmpfs /tmp:rw,noexec,nosuid,size=128m \
    "${env_args[@]}" -e NODE_ENV=production -e PORT=5679 -e "APP_REVISION=$sha" \
    -v "${data_dir}:/app/backend-node/data" "$image" >/dev/null
  if ! wait_container_ready "$name" "$sha" 90; then
    docker rm -f "$name" >/dev/null 2>&1 || true
    fail 'Candidate application did not become ready during preflight.'
  fi
  if ! docker exec "$name" node -e 'require("http").get("http://127.0.0.1:5679/",r=>process.exit(r.statusCode===200?0:1)).on("error",()=>process.exit(1))'; then
    docker logs --tail 100 "$name" >&2 || true
    docker rm -f "$name" >/dev/null 2>&1 || true
    fail 'Candidate frontend smoke check failed.'
  fi
  docker rm -f "$name" >/dev/null
}

safe_remove_preview_dir() {
  local pr="$1" target="${PREVIEW_ROOT}/pr-${1}" resolved_root resolved_target
  validate_pr "$pr"
  resolved_root="$(realpath -m "$PREVIEW_ROOT")"
  resolved_target="$(realpath -m "$target")"
  [[ "$resolved_target" == "$resolved_root/pr-$pr" ]] || fail "Unsafe preview path: $resolved_target"
  [[ "$resolved_target" != "$resolved_root" && "$resolved_target" != '/' ]] || fail "Refusing broad removal: $resolved_target"
  rm -rf -- "$resolved_target"
}

remove_preview_resources() {
  local pr="$1"
  validate_pr "$pr"
  # Detach the OverlayFS media view while mounts are still cheap; lazy umount
  # tolerates a container still holding it for milliseconds.
  teardown_preview_media_view "$pr"
  # Drop any stale per-PR ingress reference (legacy layout) before removing the
  # containers, so Nginx never proxies to an unavailable upstream.
  if docker ps --format '{{.Names}}' | grep -Fqx "$HTTP_NGINX_CONTAINER"; then
    docker exec "$HTTP_NGINX_CONTAINER" rm -f "/etc/nginx/conf.d/preview-pr-$pr.conf"
  fi
  mapfile -t preview_containers < <(docker ps -aq --filter "label=com.richidrama.preview-pr=$pr")
  ((${#preview_containers[@]} == 0)) || docker rm -f "${preview_containers[@]}" >/dev/null
  safe_remove_preview_dir "$pr"
}

ensure_preview_network() {
  docker network inspect "$PREVIEW_NETWORK" >/dev/null 2>&1 && return 0
  docker network create --internal "$PREVIEW_NETWORK" >/dev/null || \
    fail 'Cannot create the preview Docker network.'
}

attach_ingress_to_preview_network() {
  require_running_container "$HTTP_NGINX_CONTAINER"
  local networks
  networks="$(docker inspect --format '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' "$HTTP_NGINX_CONTAINER")"
  grep -Fqx "$PREVIEW_NETWORK" <<<"$networks" && return 0
  # gw-priority -1 keeps the ingress default route on its primary network.
  docker network connect --gw-priority -1 "$PREVIEW_NETWORK" "$HTTP_NGINX_CONTAINER" >/dev/null || \
    fail 'Cannot attach the HTTP ingress to the preview network.'
}

# Media realism: build an OverlayFS union view so a preview serves the real
# production hot-copy bytes without ever mutating them (writes land in the
# preview-private upper layer). Objects missing from the hot tree recover at
# request time through the trusted media proxy — no bulk pre-fill exists any
# more. A deleted lower-layer file surfaces as ENOENT, which the handler
# treats exactly like any other miss.
ensure_preview_media_view() {
  local pr_dir="$1"
  local lower="${MINIDRAMA_MEDIA_SOURCE_DIR:-${PROD_DATA_DIR}/storage}"
  local upper="$pr_dir/media-upper" work="$pr_dir/media-work" view="$pr_dir/media-view"
  [[ -d "$lower" ]] || {
    log "No production media directory at $lower; preview will serve no media."
    printf '%s\n' ''
    return 0
  }
  # Always remount from scratch. OverlayFS requires lower layers to be
  # effectively immutable while mounted and fresh per-deploy state keeps
  # snapshot fidelity obvious.
  umount -l "$view" >/dev/null 2>&1 || true
  rm -rf -- "$upper" "$work"
  mkdir -p "$upper" "$work" "$view"
  if ! mount -t overlay overlay -o "lowerdir=$lower,upperdir=$upper,workdir=$work" "$view"; then
    log 'OverlayFS media view unavailable; preview will serve no media.'
    return 0
  fi
  printf '%s\n' "$view"
}

teardown_preview_media_view() {
  local pr="$1"
  local view="$PREVIEW_ROOT/pr-$pr/media-view"
  validate_pr "$pr"
  if mountpoint -q "$view" 2>/dev/null; then
    umount -l "$view" >/dev/null 2>&1 || true
  fi
}

install_ingress_conf_at() {
  # $1 = conf file on disk, $2 = absolute path inside the ingress container.
  # Succeeds only when the dropped file is part of the effective
  # configuration (nginx -T lists every file it actually includes).
  local conf_source="$1" conf_target="$2"
  docker cp "$conf_source" "$HTTP_NGINX_CONTAINER:$conf_target"
  docker exec "$HTTP_NGINX_CONTAINER" nginx -t
  docker exec "$HTTP_NGINX_CONTAINER" nginx -s reload
  docker exec "$HTTP_NGINX_CONTAINER" sh -eu -c '
    nginx -T 2>/dev/null | grep -Fq "configuration file $1"
  ' sh "$conf_target"
}

ensure_preview_edge() {
  # The preview edge is the only dual-homed component. It is recreated on
  # every deploy so auth/config updates always land; its configuration
  # refuses to proxy anything except pr-<N> applications, which is what
  # keeps preview code from pivoting into the production network.
  # Configuration is bind-mounted rather than copied: the rootfs is read-only,
  # so docker cp would be rejected outright.
  local edge_conf="$1" auth_dir="$PREVIEW_ROOT/auth"
  local system_dir="$PREVIEW_ROOT/system"
  [[ -r "$auth_dir/htpasswd" ]] || fail 'Preview basic-auth file is missing.'
  mkdir -p "$system_dir"
  cp "$edge_conf" "$system_dir/preview-edge-default.conf"
  chmod 644 "$system_dir/preview-edge-default.conf"
  docker rm -f "$PREVIEW_EDGE_CONTAINER" >/dev/null 2>&1 || true
  docker create --name "$PREVIEW_EDGE_CONTAINER" \
    --network "$PROD_PROXY_NETWORK" --network-alias minidrama-preview-edge \
    --label "com.richidrama.preview-edge=true" \
    --security-opt no-new-privileges --cap-drop ALL --pids-limit 64 \
    --memory 128m --cpus 0.25 --read-only \
    --tmpfs /tmp:rw,noexec,nosuid,size=8m --tmpfs /var/cache/nginx:rw,noexec,nosuid,size=8m \
    --tmpfs /var/run:rw,noexec,nosuid,size=4m \
    -v "$system_dir/preview-edge-default.conf:/etc/nginx/conf.d/default.conf:ro" \
    -v "$auth_dir/htpasswd:/etc/nginx/minidrama-preview.htpasswd:ro" \
    nginxinc/nginx-unprivileged:1.27-alpine >/dev/null || \
    fail 'Cannot create the preview edge container.'
  docker network connect --gw-priority -1 "$PREVIEW_NETWORK" "$PREVIEW_EDGE_CONTAINER" >/dev/null || \
    fail 'Cannot attach the preview edge to the preview network.'
  docker start "$PREVIEW_EDGE_CONTAINER" >/dev/null || fail 'Cannot start the preview edge container.'
  for _ in {1..10}; do
    docker ps --format '{{.Names}}' | grep -Fqx "$PREVIEW_EDGE_CONTAINER" && break
    sleep 0.5
  done
  docker ps --format '{{.Names}}' | grep -Fqx "$PREVIEW_EDGE_CONTAINER" || {
    docker logs --tail 30 "$PREVIEW_EDGE_CONTAINER" >&2 || true
    fail 'Preview edge container did not stay running.'
  }
  docker exec "$PREVIEW_EDGE_CONTAINER" nginx -t
}

# Long-lived trusted component serving cold OSS objects on demand. Fully
# self-contained script mounted from the host (never depends on which app
# release an image carries). Runs with production credentials (--env-file at
# creation), reachable ONLY from the preview network; the preview app itself
# stays credential-free. Recreated exclusively on drift so concurrent other-PR
# review sessions never blink.
ensure_preview_media_proxy() {
  local script_src="$1"
  # glibc (Debian) rather than alpine/musl: musl's resolver has no TCP
  # fallback and fails getaddrinfo for OSS hostnames behind truncating
  # upstreams. Explicit public DNS servers as a second belt.
  local proxy_image="${MINIDRAMA_PREVIEW_MEDIA_PROXY_IMAGE:-node:18-bookworm-slim}"
  local meta_file="$PREVIEW_ROOT/system/media-proxy.meta"
  local env_file
  env_file="$(resolve_env_file)"
  [[ -n "$env_file" ]] || fail 'Preview media proxy requires the production environment file. Put minidrama.oss.env in /data/minidrama-config (template: deploy/minidrama.oss.env.example).'
  grep -q '^MINIDRAMA_OSS_ENDPOINT=' "$env_file" || fail "The environment file at $env_file carries no MINIDRAMA_OSS_ENDPOINT; the media proxy cannot serve without bucket access."

  mkdir -p "$PREVIEW_ROOT/system"
  local bound_script="$PREVIEW_ROOT/system/media-proxy.js"
  cp "$script_src/backend-node/tools/media-proxy.js" "$bound_script"
  chmod 644 "$bound_script"
  local script_sha env_sha
  script_sha="$(sha256sum "$bound_script" | awk '{print $1}')"
  env_sha="$(sha256sum "$env_file" | awk '{print $1}')"

  if docker ps --format '{{.Names}}' | grep -Fqx "$PREVIEW_MEDIA_PROXY_CONTAINER"; then
    local recorded_script='' recorded_env=''
    [[ -f "$meta_file" ]] && {
      recorded_script="$(awk -F= '$1=="SCRIPT_SHA256"{print $2}' "$meta_file")"
      recorded_env="$(awk -F= '$1=="ENV_SHA256"{print $2}' "$meta_file")"
    }
    if [[ "$recorded_script" == "$script_sha" && "$recorded_env" == "$env_sha" ]] \
      && docker inspect --format '{{.State.Running}}' "$PREVIEW_MEDIA_PROXY_CONTAINER" | grep -q true; then
      return 0
    fi
    log 'Recreating the preview media proxy (script or credentials changed).'
    docker rm -f "$PREVIEW_MEDIA_PROXY_CONTAINER" >/dev/null 2>&1 || true
  else
    docker rm -f "$PREVIEW_MEDIA_PROXY_CONTAINER" >/dev/null 2>&1 || true
  fi

  docker create --name "$PREVIEW_MEDIA_PROXY_CONTAINER" \
    --network "$PROD_PROXY_NETWORK" \
    --dns 223.5.5.5 --dns 119.29.29.29 \
    --label "com.richidrama.preview-media-proxy=true" \
    --security-opt no-new-privileges --cap-drop ALL --pids-limit 64 \
    --memory 256m --cpus 0.5 --read-only \
    --tmpfs /tmp:rw,noexec,nosuid,size=32m \
    --env-file "$env_file" \
    -e PORT=8090 \
    -v "$bound_script:/srv/media-proxy.js:ro" \
    --entrypoint node \
    "$proxy_image" /srv/media-proxy.js >/dev/null || \
    fail 'Cannot create the preview media proxy.'
  # gw-priority -1 belongs on the INTERNAL connect: the proxy keeps its egress
  # default route on the primary network and never hijacks it for previews.
  docker network connect --gw-priority -1 "$PREVIEW_NETWORK" "$PREVIEW_MEDIA_PROXY_CONTAINER" >/dev/null || {
    docker rm -f "$PREVIEW_MEDIA_PROXY_CONTAINER" >/dev/null 2>&1 || true
    fail 'Cannot attach the preview media proxy to the preview network.'
  }
  docker start "$PREVIEW_MEDIA_PROXY_CONTAINER" >/dev/null || {
    docker logs --tail 30 "$PREVIEW_MEDIA_PROXY_CONTAINER" >&2 || true
    fail 'Cannot start the preview media proxy.'
  }
  for _ in {1..20}; do
    docker exec "$PREVIEW_MEDIA_PROXY_CONTAINER" node -e "fetch('http://127.0.0.1:8090/healthz').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))" && break
    sleep 0.5
  done
  docker exec "$PREVIEW_MEDIA_PROXY_CONTAINER" node -e "fetch('http://127.0.0.1:8090/healthz').then(r=>{if(r.status!==200)process.exit(1)}).catch(()=>process.exit(1))" || {
    docker logs --tail 30 "$PREVIEW_MEDIA_PROXY_CONTAINER" >&2 || true
    fail 'Preview media proxy did not become healthy.'
  }
  printf 'SCRIPT_SHA256=%s\nENV_SHA256=%s\n' "$script_sha" "$env_sha" > "$meta_file"
}

install_preview_http_ingress() {
  local passthrough_conf="$1" edge_conf="$2" auth_dir="$PREVIEW_ROOT/auth"
  [[ -r "$auth_dir/htpasswd" ]] || fail 'Preview basic-auth file is missing.'
  require_running_container "$HTTP_NGINX_CONTAINER"
  # Files dropped by earlier layouts must never survive: the ACME-era suffix
  # wildcard and the previous direct vhost would outrank or duplicate the
  # current routing (the direct vhost also bypasses the edge isolation).
  docker exec "$HTTP_NGINX_CONTAINER" sh -eu -c '
    rm -f /etc/nginx/conf.d/minidrama-preview-http.conf
    rm -f /etc/nginx/conf.d/minidrama-previews.conf
  '
  ensure_preview_edge "$edge_conf"
  if ! install_ingress_conf_at "$passthrough_conf" '/etc/nginx/conf.d/minidrama-previews-ingress.conf'; then
    log 'conf.d is not part of the ingress include layout; trying sites-enabled.'
    docker exec "$HTTP_NGINX_CONTAINER" rm -f /etc/nginx/conf.d/minidrama-previews-ingress.conf
    install_ingress_conf_at "$passthrough_conf" '/etc/nginx/sites-enabled/minidrama-previews-ingress.conf' || \
      fail 'Ingress did not load the preview passthrough; neither conf.d nor sites-enabled is included.'
  fi
}

prune_release_images() {
  local keep="${MINIDRAMA_KEEP_IMAGES:-5}" current_image rollback_image
  current_image="$(docker inspect --format '{{.Config.Image}}' "$PROD_CONTAINER" 2>/dev/null || true)"
  rollback_image="$(awk -F= '$1=="PREVIOUS_IMAGE"{print $2}' "${RELEASE_ROOT}/rollback.env" 2>/dev/null || true)"
  mapfile -t tags < <(docker images local-minidrama --format '{{.Tag}} {{.CreatedAt}}' | \
    awk '$1 ~ /^[0-9a-f]{40}$/ {print}' | sort -rk2,3 | awk '{print $1}')
  local index tag image
  for ((index=keep; index<${#tags[@]}; index++)); do
    tag="${tags[$index]}"; image="local-minidrama:$tag"
    [[ "$image" == "$current_image" || "$image" == "$rollback_image" ]] && continue
    docker image rm "$image" >/dev/null 2>&1 || true
  done
}
