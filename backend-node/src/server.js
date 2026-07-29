const { loadConfig, getEnvOverrideLog } = require('./config/index.js');

const preConfig = loadConfig();
const tlsFlag = preConfig.server?.insecure_tls ?? preConfig.server?.INSECURE_TLS;
const insecureTlsOn =
  tlsFlag === true ||
  tlsFlag === 1 ||
  tlsFlag === '1' ||
  String(tlsFlag).toLowerCase() === 'true';
if (insecureTlsOn) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  console.warn('[config] server.insecure_tls 已启用：全局跳过 TLS 证书校验，仅用于测试');
}
// 打印环境变量覆盖清单（CFG_*），方便本地调试确认覆盖是否生效
const envOverrides = getEnvOverrideLog();
if (envOverrides.length) {
  console.warn('[config] 环境变量覆盖 config（CFG_*）：');
  for (const line of envOverrides) console.warn('  ' + line);
}
if (process.env.SD2_DISABLE_ASSET_INJECT === '1') {
  console.warn('[config] SD2_DISABLE_ASSET_INJECT=1：已禁用 Seedance 2.0 asset 注入（本地调试用）');
}

const { createApp } = require('./app.js');
const { closeDb } = require('./db/index.js');
const logger = require('./logger.js');

const { app, config } = createApp();
const port = Number(process.env.PORT) || config.server?.port || 5679;
const host = config.server?.host || '0.0.0.0';

const server = app.listen(port, host, () => {
  logger.info('Server starting', { port, host });
  logger.info('Frontend:  http://localhost:' + port);
  logger.info('API:       http://localhost:' + port + '/api/v1');
  logger.info('Health:    http://localhost:' + port + '/health');
  logger.info('Server is ready!');
});

function shutdown() {
  logger.info('Shutting down server...');
  server.close(() => {
    closeDb();
    logger.info('Server exited');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
