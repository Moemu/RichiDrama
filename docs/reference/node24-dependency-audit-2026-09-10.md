# Node 24 与依赖升级评估

后续处理：SDK 已移除，详见 [原生签名说明](volcengine-openapi-signing.md)。下文保留初次检查的版本和告警快照。

检查日期：2026-09-10。版本取自 npm 官方 registry，当前版本取自 package-lock.json。

本次修改 CI/CD 的 Node 运行时和相关 Actions。运行时验收发现 better-sqlite3 11.10.0 在 Node 24.21.0 下触发 RemoveEnvironmentCleanupHook 原生断言，因此已将它升级至 13.0.3 并更新后端 lockfile。其他业务依赖未升级。未提交、推送或部署。

## 包管理器

项目只使用 npm。前后端各有一份 lockfile v3，没有 pnpm、Yarn 或 Bun 的项目配置。继续使用 npm 和 npm ci 即可，目前没有切换包管理器的明确收益。

本机为 Node 24.14.0 / npm 11.9.0。实际 Docker Node 24 镜像为 Node 24.21.0 / npm 11.19.0。npm 最新版本为 12.0.2，要求 Node ^22.22.2、^24.15.0 或 >=26.0.0。本机 Node 尚不满足 npm 12 要求。建议先使用 Node 24 自带的 npm，再单独评估 npm 12。

backend-node/.npmrc 的 better_sqlite3_binary_host_mirror 已触发 npm 11 未知配置告警。升级 npm 前应确认该镜像参数的实际使用方式并移出不支持的 npm 配置。strict-ssl=false 也建议另行清理，先确认镜像证书链；本次没有改动安装网络配置。

## 优先级

| 优先级 | 依赖 | 建议 | 原因与验证范围 |
|---|---|---|---|
| 高 | multer 1.4.5-lts.2 | 升级至 2.3.0 | 官方确认旧版本有上传拒绝服务漏洞；检查 routes/upload.js、routes/index.js 的 multipart 路径、文件限制、异常和中断清理 |
| 高 | @volcengine/openapi 1.36.1 | 优先缩小或移除依赖，不只升补丁 | 最新 1.36.2 仍锁 protobufjs 7.2.5，带入旧 axios、uuid；项目只检索到 Signer 用法，评估签名替代并保持业务 HTTP/计费路径 |
| 高 | axios 1.13.5 | 升级至 1.20.0 | 前端直接依赖有安全告警；后端 SDK 的 axios 0.x 是独立依赖，不能靠升级前端修复 |
| 高 | sharp 0.34.5 | 升级至 0.35.4 | libvips/libheif 告警；验证图片读写、元数据、格式转换及持久化媒体恢复 |
| 高 | adm-zip 0.5.16 | 评估 0.6.0 并加固导入路径 | 0.6.0 修复内存分配问题，但 audit 仍报告该版本的符号链接覆盖问题；不能宣称升级后全部修复 |
| 高 | Vite 5.4.21 + plugin-vue 5.2.4 | 分批迁移到 Vite 8.2.2 + plugin-vue 6.0.8 | Vite 5 已不在维护范围；同时处理 esbuild、Rollup、PostCSS、nanoid 链；Vite 8 切换到 Rolldown，须验收代理、构建和页面交互 |
| 中 | express 4.22.1 / js-yaml 4.1.1 | 先评估 4.22.2 / 4.3.2 | 同主版本更新，并更新 qs、body-parser、path-to-regexp 等锁定依赖；随后重跑 audit，不能只看顶层版本 |
| 已完成必要升级 | better-sqlite3 11.10.0 → 13.0.3 | 解决 Node 24 原生断言 | Node 原生模块与 SQLite 同时变化，需检查迁移幂等、历史数据读取、事务及重启恢复；不自动改数据库 |
| 中 | echarts 5.6.0 | 评估 6.1.0 | 有 XSS 告警，检查 OperationsTrendChart.vue 的 Tooltip 与图表输出 |
| 中 | element-plus 2.13.2 / vue 3.5.27 | 更新至 2.14.5 / 3.5.42 | 同主版本维护更新；Element Plus 引入的 lodash/lodash-es 也需更新，并执行三档桌面 UI 验收 |
| 低 | uuid 10.0.0 | 先检查受影响 API，再选兼容版本 | audit 指向 v3/v5/v6 的 buffer 参数，项目检索结果主要为 v4；最新 14.0.2 不宜与 CommonJS 迁移混做 |
| 低 | pinia 2.3.1 / vue-router 4.6.4 | 暂不为追新升到 4.0.3 / 5.3.1 | 属于主版本迁移，应由实际功能或缺陷驱动，单独验证状态和路由行为 |

## 安全审计

后端 npm audit：14 个受影响依赖条目（1 critical、8 high、5 moderate）。前端：11 个（8 high、3 moderate）。这些是依赖树告警，不等于已经证实线上可利用；前端结果还包含开发工具和仅用于 Node 的代码。

后端 critical 来自 @volcengine/openapi → protobufjs 7.2.5。npm audit 建议将 SDK 降至 1.0.5，因此不应直接运行 npm audit fix --force。Multer 没有出现在本次 audit 返回中，但官方安全公告明确覆盖其旧版本，仍列为高优先级。

重要间接依赖链：

- @volcengine/openapi → axios / protobufjs / uuid / form-data。
- alipay-sdk → urllib。顶层 alipay-sdk 已是最新版，仍需更新间接依赖。
- express → body-parser / qs / path-to-regexp。
- element-plus → lodash / lodash-es。
- vite → esbuild / rollup / postcss → nanoid。

## 检查开始时的完整直接依赖版本

| 项目 | 依赖 | 锁定版本 | registry latest |
|---|---|---|---|
| backend-node | @volcengine/openapi | 1.36.1 | 1.36.2 |
| backend-node | adm-zip | 0.5.16 | 0.6.0 |
| backend-node | alipay-sdk | 4.14.0 | 4.14.0 |
| backend-node | better-sqlite3 | 11.10.0 | 13.0.3 |
| backend-node | buffer | 6.0.3 | 6.0.3 |
| backend-node | cors | 2.8.6 | 2.8.6 |
| backend-node | express | 4.22.1 | 5.2.1 |
| backend-node | js-yaml | 4.1.1 | 5.4.1 |
| backend-node | jsonrepair | 3.13.3 | 3.15.0 |
| backend-node | jsonwebtoken | 9.0.3 | 9.0.3 |
| backend-node | multer | 1.4.5-lts.2 | 2.3.0 |
| backend-node | sharp | 0.34.5 | 0.35.4 |
| backend-node | uuid | 10.0.0 | 14.0.2 |
| frontweb | @element-plus/icons-vue | 2.3.2 | 2.3.2 |
| frontweb | @vue-flow/background | 1.3.2 | 1.3.2 |
| frontweb | @vue-flow/controls | 1.1.3 | 1.1.3 |
| frontweb | @vue-flow/core | 1.48.2 | 1.48.2 |
| frontweb | @vue-flow/minimap | 1.5.4 | 1.5.4 |
| frontweb | axios | 1.13.5 | 1.20.0 |
| frontweb | echarts | 5.6.0 | 6.1.0 |
| frontweb | element-plus | 2.13.2 | 2.14.5 |
| frontweb | pinia | 2.3.1 | 4.0.3 |
| frontweb | qrcode | 1.5.4 | 1.5.4 |
| frontweb | vue | 3.5.27 | 3.5.42 |
| frontweb | vue-router | 4.6.4 | 5.3.1 |
| frontweb | @vitejs/plugin-vue | 5.2.4 | 6.0.8 |
| frontweb | vite | 5.4.21 | 8.2.2 |

## 来源

- [npm 官方 registry](https://registry.npmjs.org/)：版本、engines、依赖元数据及 audit。
- [Multer 官方安全公告](https://expressjs.com/en/blog/2026-02-27-security-releases/)：旧上传中间件的拒绝服务漏洞。
- [Vite 维护版本](https://vite.dev/releases)：当前维护分支。
- [protobufjs 公告](https://github.com/advisories/GHSA-xq3m-2v4x-88gg)：代码执行风险。
- [adm-zip 符号链接公告](https://github.com/advisories/GHSA-vwc7-r8mq-g2x9)：最新版本仍需额外处理的风险。

本次未启用任何新的业务数据行为，历史用户、任务、媒体及账本不执行改写或清理。运行时升级将作用于后续构建的应用进程；兼容性验证使用隔离测试数据。

## Node 24 兼容性变更

- Validation 的测试 Node 版本、生产 Docker builder/runtime、预览 builder 均使用 Node 24。
- actions/checkout 与 actions/setup-node 升至 v7，Docker setup-buildx 升至 v4，build-push 升至 v7；这些版本的 action.yml 均声明 Node 24。
- 预览仍继承生产运行时的系统库，但复制 builder 的 Node 可执行文件，避免首次升级预览仍运行旧 Node。
- CI 新增禁网容器检查：验证 Node major、SQLite 查询及关闭、sharp 实际 PNG 编码与正常退出。该检查实际发现并复现旧 better-sqlite3 崩溃。
- better-sqlite3 13 要求 Node >=22，因此后端 engines 同步改为 >=22.0.0；Node 18/20 不再是该版本支持的后端运行时。CI/CD 使用 Node 24。
- better-sqlite3 13 使用 N-API，并移除旧 prebuild-install 依赖。lockfile 删除项来自旧安装依赖链，不是业务依赖的批量升级。
- 消费者检索覆盖 frontweb/src、backend-node/src、backend-node/test；命中数据库入口、迁移、应用启动、资产服务，以及授权、计费、支付、媒体、异步状态和模型目录测试。前端没有直接引用 SQLite 原生模块。

[better-sqlite3 13 官方变更](https://github.com/WiseLibs/better-sqlite3/releases/tag/v13.0.0)。

## 本地验证结果

- 本机 Node 24.14.0：前端 147 项测试通过，production build 通过；构建仍有原有大 chunk 提示。没有前端源码或样式改动。
- Docker Node 24.21.0 / npm 11.19.0：生产镜像干净安装和构建通过，SQLite/sharp 运行时检查通过。
- 后端全量 405 项：初次在镜像默认 NODE_ENV=production 下 404 通过，媒体权限测试夹具缺少 production 模式使用的 runtime_settings 表而失败。设置 NODE_ENV=test 后重跑该文件，3/3 通过；未修改业务代码或测试夹具来绕过问题。
- 数据库验证器对隔离空库连续执行两次迁移，integrity_check 为 ok。后端测试覆盖历史分镜及生成历史在迁移、数据库关闭和重启后的读取。
- 预览运行时阶段从 Node 22 Bookworm 基础镜像开始，执行 Dockerfile.preview 的真实 runtime 阶段，并使用已验证的构建产物。运行时 Node 24 检查与 SQLite/sharp 操作通过。未运行线上 preview-deploy。
- 首次使用 Debian 官方源的本地构建因下载失败中断，改用项目原有默认镜像源后成功；CI 仍使用原有官方源设置。
- 变更文件的 git diff --check 通过。没有提交、推送或远端 CI/部署结果。
- 升级 SQLite 后重跑 npm audit：后端仍为 14 条（1 critical / 8 high / 5 moderate）；后端依赖计数由 231 降至 203。安全升级建议仍需后续实施。

- 禁网容器使用 dev 档和隔离数据库启动，/ready 返回 200，database/frontend 检查均为 true；重启后结果相同。验证容器及其临时卷已清理。Workflow YAML 解析及两个测试 job 的 Node 24 配置校验通过。
