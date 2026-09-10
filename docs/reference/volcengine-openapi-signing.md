# 火山 OpenAPI 原生签名

2026-09-10：移除后端的 @volcengine/openapi 依赖，使用 node:crypto 完成现有控制面请求的签名。

## 使用范围

共用实现位于 backend-node/src/services/volcengineOpenApiSigning.js。它仅处理当前业务使用的 JSON POST / 请求，返回 url、bodyText 和 headers，不负责发送请求、鉴权、重试或计费。

- modelArkAssetProxyService：使用共用签名，保留区域推断、国内/国际控制面主机选择、ProjectName、临时 sessionToken、服务名和版本。Bearer 网关路径保持原行为。
- providerPriceService：复用共用签名，保留 signedHeaders 导出和现有账单、价格查询及重试行为。
- modelDiscoveryService：直接导入共用签名；原有国内区域、长期 AK/SK 限制继续生效，不新增查询能力。

Content-Type 和自动添加的 Host 不参与签名，与原 SDK 调用时传入的请求头一致。X-Content-Sha256、X-Date 和可选 X-Security-Token 参与签名。Query 使用确定的键排序及 RFC 3986 编码，JSON 字节同时用于哈希与实际请求体。

## 固定测试样本

backend-node/test/fixtures/volcengineOpenApiSignatures.json 保存 6 组输入和预期输出。它们来自已锁定的官方 SDK 1.36.1，在禁网容器中使用假密钥和固定时间生成；未发出任何 HTTP 请求。

样本记录 SDK 文件 SHA-256：b85d332b255ac749c538166ba72989b57c9388a5da6d5c20c2c6f2304f728288。样本来源是 Signer.addAuthorization，查询串来自同模块的 queryParamsToString。

覆盖价格查询、端点查询、账单服务、UTC 日期边界、中文正文、带特殊字符的项目名、BytePlus 临时凭证及空正文。测试不再安装或加载 SDK，也不使用待测实现生成预期签名。

[官方签名实现](https://github.com/volcengine/volc-sdk-nodejs/blob/main/src/base/sign.ts)。

## 影响面与兼容性

检索覆盖 frontweb/src、backend-node/src 和 backend-node/test。前端的 api/ai.js、AIConfigContent.vue、Sd2AssetManagement.vue、AdminConsole.vue 继续使用原有 HTTP 参数。后端覆盖素材代理及配置加载、角色库与 SD2 资产消费者、租户配置、模型发现、价格和账单查询。鉴权路由、所有权检查、账本和后台恢复逻辑未改动。

所有后续控制面请求使用新的纯签名函数。历史配置保持原参数语义；不改写用户、模型、项目、素材、任务状态、价格快照或账本。不新增付费调用，也不迁移或清理历史数据。

## 依赖结果

后端 lockfile 包条目从 203 减少至 177，删除 26 个包，其余保留包的版本没有变化。已移除 SDK、后端 axios 0.x、protobufjs 及其辅助包。前端 axios 是独立依赖，未改动。

npm audit 从 14 条降至 9 条：0 critical、5 high、4 moderate。严重级别告警已移除；剩余依赖告警仍需按单独的升级评估处理。此结论不等于所有安全问题均已解决。

## 验证

- 6 组签名、请求体和请求头与 SDK 固定样本完全一致。
- 项目 HTTP 集成测试覆盖未登录/普通用户拒绝、国内/国际签名、临时凭证、中文项目名、非法请求、供应商错误、Bearer 网关和重启后的读取。
- 在不包含 SDK、protobufjs、后端 axios 的干净镜像中，三个业务消费者均可加载。Docker 构建通过。
- 验证使用禁网容器、临时 SQLite 和假供应商响应，不调用真实供应商、不产生费用、不触及生产数据。

- 后端全量回归：Node 24.21.0 下 412/412 通过。补充 ProjectName 自动写入和临时令牌空白处理后，素材 API 测试复测通过。
- 受影响文件差异检查通过。所有修改仅在本地，未提交、推送或部署。
