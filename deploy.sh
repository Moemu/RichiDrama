#!/usr/bin/env bash
# LocalMiniDrama 服务器部署脚本
# 由 GitHub Actions 通过 SSH 调用，也可手动执行。
#
# 用法:
#   ./deploy.sh            # 拉取最新代码 + 重新构建 + 重启
#   ./deploy.sh restart    # 仅重启（不拉取、不构建）
#
# 退出码: 0=成功, 非0=失败（GitHub Actions 会标红）

set -euo pipefail

# ---------- 配置 ----------
PROJECT_DIR="/data/apps/LocalMiniDrama"
COMPOSE_FILE="${PROJECT_DIR}/docker-compose.yml"
LOG_FILE="/var/log/minidrama-deploy.log"
DATA_DIR="${MINIDRAMA_DATA_DIR:-/data/minidrama-data}"
BACKUP_DIR="${MINIDRAMA_BACKUP_DIR:-/data/minidrama-backups}"
LEGACY_DATA_DIR="${PROJECT_DIR}/volumes/data"
export MINIDRAMA_DATA_DIR="${DATA_DIR}"
export MINIDRAMA_BACKUP_DIR="${BACKUP_DIR}"

# 部署日志
mkdir -p "$(dirname "$LOG_FILE")"
exec > >(tee -a "$LOG_FILE") 2>&1

log()  { echo "[$(date '+%F %T')] $*"; }
fail() { log "ERROR: $*"; exit 1; }

log "===== LocalMiniDrama 部署开始 ====="
log "工作目录: ${PROJECT_DIR}"
cd "${PROJECT_DIR}" || fail "项目目录不存在: ${PROJECT_DIR}"
[[ "${DATA_DIR}" = /* ]] || fail "MINIDRAMA_DATA_DIR 必须是绝对路径: ${DATA_DIR}"
[[ "${BACKUP_DIR}" = /* ]] || fail "MINIDRAMA_BACKUP_DIR 必须是绝对路径: ${BACKUP_DIR}"

# ---------- restart 子命令 ----------
if [[ "${1:-}" == "restart" ]]; then
  log "仅重启容器"
  docker compose -f "${COMPOSE_FILE}" up -d || fail "重启失败"
  log "===== 重启完成 ====="
  exit 0
fi

# ---------- 1. 拉取最新代码 ----------
log "[1/5] 拉取最新代码..."
git fetch --all --prune
# 仅当远端有新提交时才 reset，避免本地无意义 diff（CI 场景下本地不应有改动）
git reset --hard origin/main
git log -1 --oneline

# ---------- 2. 确保数据目录存在 ----------
log "[2/6] 确保持久化数据目录..."
mkdir -p "${DATA_DIR}" "${BACKUP_DIR}"
log "数据目录: ${DATA_DIR}"

# One-time migration from the legacy repository-relative bind mount. Do this
# before the first deployment using the new Compose path, otherwise the app
# would boot a fresh SQLite database and old asset IDs would appear missing.
if [[ ! -f "${DATA_DIR}/drama_generator.db" && -f "${LEGACY_DATA_DIR}/drama_generator.db" ]]; then
  log "检测到旧数据目录，正在迁移: ${LEGACY_DATA_DIR} -> ${DATA_DIR}"
  if docker compose -f "${COMPOSE_FILE}" ps -q app 2>/dev/null | grep -q .; then
    docker compose -f "${COMPOSE_FILE}" exec -T app node -e "const Database=require('better-sqlite3'); const db=new Database('/app/backend-node/data/drama_generator.db'); db.pragma('wal_checkpoint(TRUNCATE)'); db.close();"
  fi
  if command -v rsync >/dev/null 2>&1; then
    rsync -aHAX "${LEGACY_DATA_DIR}/" "${DATA_DIR}/"
  else
    cp -a "${LEGACY_DATA_DIR}/." "${DATA_DIR}/"
  fi
  [[ -f "${DATA_DIR}/drama_generator.db" ]] || fail "旧数据迁移后未找到 SQLite 数据库"
  log "旧数据迁移完成"
fi

# 发布只保留一致的 SQLite 快照；全部媒体必须已在 OSS 持久化。
# 本地热副本的全量归档由离峰定时任务负责，避免小改动被数 GB 媒体拖慢。
log "[3/6] 创建发布级账本快照并校验 OSS 归档..."
bash "${PROJECT_DIR}/deploy/backup-data.sh" --release --quiet || fail "发布级备份或 OSS 归档校验失败，已取消部署"

# ---------- 3. 重新构建 ----------
log "[4/6] 重新构建镜像..."
docker compose -f "${COMPOSE_FILE}" build --pull

# ---------- 4. 启动 / 重启 ----------
log "[5/6] 启动容器..."
docker compose -f "${COMPOSE_FILE}" up -d --remove-orphans

# 防止 compose 环境变量或工作目录变化后把空目录挂载到容器，造成“旧资源不存在”。
MOUNT_SOURCE="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/app/backend-node/data"}}{{.Source}}{{end}}{{end}}' local-minidrama 2>/dev/null || true)"
[[ -n "${MOUNT_SOURCE}" ]] || fail "容器未挂载 /app/backend-node/data"
[[ "$(realpath -m "${MOUNT_SOURCE}")" = "$(realpath -m "${DATA_DIR}")" ]] || fail "数据卷挂载错误: ${MOUNT_SOURCE}（期望 ${DATA_DIR}）"
log "数据卷挂载已校验: ${MOUNT_SOURCE}"

# ---------- 5. 同步 nginx 反代配置（解决 lens-rhyme-nginx 配置不持久问题）----------
# lens-rhyme-nginx 是手动管理的容器(无 compose/无挂载)，重建后会丢失配置，
# 因此每次部署都重新注入反代配置，确保 drama.richbest.cn 可用。
NGINX_CONTAINER="lens-rhyme-nginx-1"
NGINX_CONF_SRC="${PROJECT_DIR}/deploy/nginx-drama-richbest.conf"
if docker ps --format '{{.Names}}' | grep -q "^${NGINX_CONTAINER}$"; then
  log "[6/6] 同步 nginx 反代配置 (${NGINX_CONTAINER})..."
  docker cp "${NGINX_CONF_SRC}" "${NGINX_CONTAINER}:/etc/nginx/conf.d/minidrama.conf"
  # 测试配置；若失败不中断（保持旧配置继续服务），仅告警
  if docker exec "${NGINX_CONTAINER}" nginx -t 2>&1; then
    docker exec "${NGINX_CONTAINER}" nginx -s reload 2>&1 || log "⚠️ nginx reload 失败(保持旧配置)"
    log "nginx 配置已同步并重载"
  else
    log "⚠️ nginx 配置测试失败，跳过 reload(保持现状)"
  fi
else
  log "[6/6] 跳过 nginx 配置同步：未找到容器 ${NGINX_CONTAINER}"
fi

# Full local-media archives are disaster-recovery work, not a dependency of
# every code release. The persistent off-peak timer keeps the full-backup
# policy without delaying deployments.
if command -v systemctl >/dev/null 2>&1; then
  install -m 0644 "${PROJECT_DIR}/deploy/minidrama-full-backup.service" /etc/systemd/system/minidrama-full-backup.service
  install -m 0644 "${PROJECT_DIR}/deploy/minidrama-full-backup.timer" /etc/systemd/system/minidrama-full-backup.timer
  systemctl daemon-reload
  systemctl enable --now minidrama-full-backup.timer
  log "全量灾备定时器已启用"
fi

# ---------- 健康检查 ----------
# 通过域名 drama.richbest.cn 检查（走 nginx 反代，即真实对外路径）
DOMAIN="drama.richbest.cn"
log "等待服务就绪..."
sleep 5
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -sf --max-time 8 -H "Host: ${DOMAIN}" http://127.0.0.1/health >/dev/null 2>&1; then
    log "✅ 健康检查通过 (http://${DOMAIN}/)"
    docker compose -f "${COMPOSE_FILE}" ps
    log "===== 部署成功 ====="
    exit 0
  fi
  log "  健康检查重试 $i/10..."
  sleep 6
done

log "⚠️ 健康检查未通过，查看日志："
docker compose -f "${COMPOSE_FILE}" logs --tail=50 app || true
fail "健康检查失败"
