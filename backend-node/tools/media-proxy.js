#!/usr/bin/env node
// Entrypoint for the preview media proxy container. Configuration comes from
// the production environment file (--env-file at docker create time); the
// process holds credentials but is never reachable from outside the preview
// network, and the preview app talks to it over plain HTTP by hostname.

const { loadConfig } = require('../src/config');
const { validateProxyConfig, createMediaProxyServer } = require('./media-proxy-server');

const cfg = loadConfig();
const validationError = validateProxyConfig(cfg);
if (validationError) {
  console.error('media proxy config invalid:', validationError);
  process.exit(1);
}

const port = Number(process.env.PORT || 8090);
createMediaProxyServer({ cfg }).listen(port, '0.0.0.0', () => {
  console.log(`media proxy listening on :${port}`);
});
