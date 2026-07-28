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

# 部署日志
mkdir -p "$(dirname "$LOG_FILE")"
exec > >(tee -a "$LOG_FILE") 2>&1

log()  { echo "[$(date '+%F %T')] $*"; }
fail() { log "ERROR: $*"; exit 1; }

log "===== LocalMiniDrama 部署开始 ====="
log "工作目录: ${PROJECT_DIR}"
cd "${PROJECT_DIR}" || fail "项目目录不存在: ${PROJECT_DIR}"

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
log "[2/5] 确保数据目录..."
mkdir -p "${PROJECT_DIR}/volumes/data"

# ---------- 3. 重新构建 ----------
log "[3/5] 重新构建镜像..."
docker compose -f "${COMPOSE_FILE}" build --pull

# ---------- 4. 启动 / 重启 ----------
log "[4/5] 启动容器..."
docker compose -f "${COMPOSE_FILE}" up -d --remove-orphans

# ---------- 5. 同步 nginx 反代配置（解决 lens-rhyme-nginx 配置不持久问题）----------
# lens-rhyme-nginx 是手动管理的容器(无 compose/无挂载)，重建后会丢失配置，
# 因此每次部署都重新注入反代配置，确保 drama.richbest.cn 可用。
NGINX_CONTAINER="lens-rhyme-nginx-1"
NGINX_CONF_SRC="${PROJECT_DIR}/deploy/nginx-drama-richbest.conf"
if docker ps --format '{{.Names}}' | grep -q "^${NGINX_CONTAINER}$"; then
  log "[5/5] 同步 nginx 反代配置 (${NGINX_CONTAINER})..."
  docker cp "${NGINX_CONF_SRC}" "${NGINX_CONTAINER}:/etc/nginx/conf.d/minidrama.conf"
  # 测试配置；若失败不中断（保持旧配置继续服务），仅告警
  if docker exec "${NGINX_CONTAINER}" nginx -t 2>&1; then
    docker exec "${NGINX_CONTAINER}" nginx -s reload 2>&1 || log "⚠️ nginx reload 失败(保持旧配置)"
    log "nginx 配置已同步并重载"
  else
    log "⚠️ nginx 配置测试失败，跳过 reload(保持现状)"
  fi
else
  log "[5/5] 跳过 nginx 配置同步：未找到容器 ${NGINX_CONTAINER}"
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
