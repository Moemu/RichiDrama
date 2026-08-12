'use strict';

// Usage (PowerShell):
//   $env:CFG_STORAGE__TYPE='oss'; ...; node src/scripts/migrateMediaToOss.js --dry-run
// Uploads retain each existing local_path as the object suffix, so DB rows and
// /static URLs remain unchanged. Use --remove-local only after validating the
// dry run and a sampled playback/export rollback check.
const path = require('path');
const { loadConfig } = require('../config');
const logger = require('../logger');
const { migrateLocalTree, isOss, assertOssDeliveryReady } = require('../services/mediaStorageService');

async function main() {
  const args = new Set(process.argv.slice(2));
  const cfg = loadConfig();
  if (!isOss(cfg)) throw new Error('Set CFG_STORAGE__TYPE=oss before running migration');
  if (args.has('--remove-local')) assertOssDeliveryReady(cfg);
  const storageRoot = path.resolve(process.cwd(), cfg.storage?.local_path || './data/storage');
  const result = await migrateLocalTree(cfg, storageRoot, logger, {
    dry_run: args.has('--dry-run'),
    remove_local: args.has('--remove-local'),
  });
  console.log(JSON.stringify(result));
  if (result.failed) process.exitCode = 2;
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
