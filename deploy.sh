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
log "[1/4] 拉取最新代码..."
git fetch --all --prune
# 仅当远端有新提交时才 reset，避免本地无意义 diff（CI 场景下本地不应有改动）
git reset --hard origin/main
git log -1 --oneline

# ---------- 2. 确保数据目录存在 ----------
log "[2/4] 确保数据目录..."
mkdir -p "${PROJECT_DIR}/volumes/data"

# ---------- 3. 重新构建 ----------
log "[3/4] 重新构建镜像..."
docker compose -f "${COMPOSE_FILE}" build --pull

# ---------- 4. 启动 / 重启 ----------
log "[4/4] 启动容器..."
docker compose -f "${COMPOSE_FILE}" up -d --remove-orphans

# ---------- 健康检查 ----------
log "等待容器启动..."
sleep 5
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -sf --max-time 5 http://127.0.0.1:5679/health >/dev/null 2>&1; then
    log "✅ 健康检查通过"
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
