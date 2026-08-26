# syntax=docker/dockerfile:1
# RichiDrama 单容器镜像：前端构建 + 后端运行
#
# 后端依赖 better-sqlite3 / sharp 两个原生模块，需要编译工具链。

FROM node:18-bookworm-slim AS builder

# 使用国内 Debian 镜像源加速 apt（基于 bookworm）
RUN sed -i 's|deb.debian.org|mirrors.aliyun.com|g; s|security.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources

# 编译原生模块所需工具链
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        python3 make g++ git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# ---- 1. 构建前端 ----
COPY frontweb/package.json frontweb/package-lock.json* ./frontweb/
# 使用国内镜像源，加速安装
RUN npm config set registry https://registry.npmmirror.com
RUN cd frontweb && npm install --no-audit --no-fund

COPY frontweb ./frontweb
RUN cd frontweb && npm run build
# 产物：/build/frontweb/dist

# ---- 2. 安装后端生产依赖 ----
COPY backend-node/package.json backend-node/package-lock.json* ./backend-node/
COPY backend-node/.npmrc ./backend-node/.npmrc
RUN cd backend-node && npm ci --omit=dev --no-audit --no-fund

# 拷贝后端源码（src/configs/migrations/tools 等）—— 上面只为装依赖，这里补齐业务代码
COPY backend-node ./backend-node

# ============================================================
FROM node:18-bookworm-slim AS runtime

# 使用国内 Debian 镜像源加速 apt
RUN sed -i 's|deb.debian.org|mirrors.aliyun.com|g; s|security.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources

# sharp 运行时基础库 + ffmpeg（视频合并/后期处理依赖）+ tini（信号转发）
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates tini ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/backend-node

# 拷贝已装好依赖的后端
COPY --from=builder /build/backend-node ./

# 拷贝前端构建产物到 /app/frontweb/dist（后端 app.js 默认从 ../frontweb/dist 读取）
COPY --from=builder /build/frontweb/dist /app/frontweb/dist

ENV NODE_ENV=production
ENV PORT=5679
EXPOSE 5679

# 数据持久化目录由 docker-compose 挂载到 ./volumes/data
# （backend-node/data —— SQLite 库 + 上传素材）
VOLUME ["/app/backend-node/data"]

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "src/server.js"]
