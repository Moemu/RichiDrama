# 依赖升级记录（2026-09-10）

本次更新前后端依赖及锁文件。仅修改本地工作区，未提交、推送或部署。

## 主要版本

| 依赖 | 升级前锁定版本 | 升级后锁定版本 |
| --- | --- | --- |
| Express | 4.22.1 | 5.2.1 |
| Multer | 1.4.5-lts.2 | 2.3.0 |
| sharp | 0.34.5 | 0.35.4 |
| adm-zip | 0.5.16 | 0.6.0 |
| js-yaml | 4.1.1 | 4.3.2 |
| jsonrepair | 3.13.3 | 3.15.0 |
| urllib（支付宝 SDK 间接依赖） | 4.9.0 | 4.9.1 |
| Vue | 3.5.27 | 3.5.42 |
| Vue Router | 4.6.4 | 5.3.1 |
| Pinia | 2.3.1 | 4.0.3 |
| Element Plus | 2.13.2 | 2.14.5 |
| Axios | 1.13.5 | 1.20.0 |
| ECharts | 5.6.0 | 6.1.0 |
| Vite | 5.4.21 | 8.2.2 |
| @vitejs/plugin-vue | 5.2.4 | 6.0.8 |

其余直接依赖已处于检查时的最新版本。better-sqlite3 13.0.3 沿用上一轮 Node 24 兼容升级。

## 兼容处理

- Express 5 使用命名通配符 `/{*splat}`，保留根路径和深层 SPA 路由回退。显式保留扩展查询解析器。
- Vite 保留原 Vite 5 的浏览器构建目标：ES2020、Edge 88、Firefox 78、Chrome 87、Safari 14。此设置保留编译目标，不等同于这些旧浏览器的实机验证。
- Pinia 4 要求显式安装 `@vue/devtools-api`，锁定到 8.2.1。前端本身已使用 ESM。
- js-yaml 保留 4.x 最新版本。5.x 改变默认 schema 和部分配置语义，本次不迁移现有 YAML。
- 五处 UUID v4 调用改用 Node 内置 `crypto.randomUUID`，删除 `uuid` 依赖。保留原调用名、ID 格式和持久化字段。
- 支付宝 SDK 的 urllib 最低版本约束为 4.9.1。检查时 npm `latest` 仍指向 4.9.0，普通更新没有选中已发布的安全修复版。

## 影响面与数据边界

已检索 `frontweb/src`、`backend-node/src`、`backend-node/test` 的依赖消费者。

| 范围 | 覆盖 |
| --- | --- |
| HTTP 与认证 | API 路由、JSON/表单解析、Cookie/JWT、未登录拒绝、未知 API、SPA 回退、完整应用重启 |
| 上传与媒体 | Multer 上传、ZIP 导入导出、sharp 图像处理、静态媒体鉴权、Range、持久化媒体读取 |
| UUID | 迁移中的分镜身份、分镜身份服务、任务服务、支付服务、计费服务 |
| 前端共享依赖 | API 封装、登录、项目工作台、制作表单、画布、运营图表及表格 |
| 历史与异步任务 | 现有集成测试中的历史媒体、计费、任务恢复；新增真实进程重启后的项目和 Cookie 读取 |

本次没有新增数据迁移、清理、重算或付费行为，也没有修改模型默认参数。
新旧记录均使用更新后的运行库；历史记录明确排除任何批量改写、删除、重新生成或重新扣费。

自动化测试使用临时数据库和模拟供应商，并在禁用外网的容器中执行。
UI 使用独立数据库、空供应商配置、关闭支付的 dev 档。未挂载业务数据库，未执行真实生成或支付。

## 验证

- 前端自动化测试：147 项通过。
- 前端 production build：通过；保留现有大体积 chunk 提示。
- Node 24 Docker 构建及干净 `npm ci`：通过。
- 后端完整运行 413 项：412 项通过，1 项视频恢复等待超时。该测试所在组独立复验 5/5 通过，包含失败场景；未放宽超时或更改业务逻辑。详见 `artifacts/dependency-upgrades/backend-tests-final.log` 和 `video-recovery-recheck.log`。
- 新增完整应用 HTTP 重启测试通过，覆盖 SPA 路由、Cookie 会话和历史项目读取。SQLite 与 sharp 原生模块烟测通过。
- 内置浏览器：登录、项目工作台、制作页面、画布、运营概览在 1280×720、1440×900、1920×1080 下实查。
- 交互：错误/成功登录、账户菜单、项目创建、比例下拉、添加剧集、剧本保存与刷新恢复、画布切换与对齐、运营选项卡。
- 滚动：制作页面和运营页面底部操作可达；桌面页面无横向溢出。另检查 390×844 工作台和记录展开。
- 构建版：通过后端静态入口实际打开项目工作台及剧集管理，确认懒加载路由和已保存剧本正常读取。

## 审计

前端 `npm audit` 为零告警；后端剩一项中危、零高危、零严重。

剩余为 [adm-zip 解压时跟随目标符号链接](https://github.com/advisories/GHSA-vwc7-r8mq-g2x9)。
0.6.0 仍被公告列为受影响版本。项目使用 `getEntries`/`getData` 后自行校验和写入文件，未调用受影响的 `extractAllTo`/`extractEntryTo`。
不采用审计建议的旧版本降级，避免重新引入已修复问题。告警仍保留，不能宣称依赖无漏洞。

## 上游参考

- [Express 5 迁移说明](https://expressjs.com/en/guide/migrating-5/)
- [Vite 8 迁移说明](https://vite.dev/guide/migration)
- [Vue Router 5 迁移说明](https://router.vuejs.org/guide/migration/v4-to-v5)
- [Pinia 变更记录](https://github.com/vuejs/pinia/blob/v4/packages/pinia/CHANGELOG.md)
- [js-yaml 变更记录](https://github.com/nodeca/js-yaml/blob/master/CHANGELOG.md)
- [urllib 安全修复说明](https://github.com/advisories/GHSA-hq3h-g68c-hp78)
