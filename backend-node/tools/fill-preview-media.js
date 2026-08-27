#!/usr/bin/env node
// Fill a preview's cold-media layer from the production OSS bucket.
//
// Preview data volumes carry only the DB snapshot; hot media copies arrive via
// the OverlayFS lower dir, but objects archived to OSS and pruned locally are
// invisible there. This one-off runs on the SERVER (never inside a preview
// container), reads production configuration from its environment, and writes
// referenced-but-missing objects into the per-PR cold directory that becomes
// an additional overlay lower layer. Credentials never reach preview code.
//
// Usage:
//   node tools/fill-preview-media.js <snapshot.db> <prod-storage-root> <cold-dir> \
//        [--max-bytes N] [--limit-count N] [--prefer-prefix p1,p2]
//
// Budget exhaustion, missing objects and single-object errors are reported on
// stdout as JSON and exit 0 — an incomplete fill degrades gracefully to 404s,
// it must not fail the deploy. Infrastructural errors exit non-zero.

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const mediaStorage = require('../src/services/mediaStorageService');
const { loadConfig } = require('../src/config');

function parseArgs(argv) {
  const opts = { maxBytes: 2147483648, limitCount: 400, preferPrefixes: [] };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--max-bytes') { opts.maxBytes = Number(argv[++i]); continue; }
    if (argv[i] === '--limit-count') { opts.limitCount = Number(argv[++i]); continue; }
    if (argv[i] === '--prefer-prefix') {
      for (const p of String(argv[++i]).split(',')) {
        const prefix = p.replace(/^\/+|\/+$/g, '');
        if (prefix) opts.preferPrefixes.push(prefix);
      }
      continue;
    }
    positional.push(argv[i]);
  }
  [opts.dbPath, opts.prodRoot, opts.coldDir] = positional;
  return opts;
}

/**
 * Two-source candidate enumeration.
 * 1. The archive ledger (authoritative for migrated uploads).
 * 2. A scan of every text column for media references. Two shapes exist:
 *    explicit "/static/..." URLs and BARE relative paths inside JSON payloads
 *    (global_settings stores carousel arrays without the /static prefix), so
 *    both are recognised and normalised to storage-root-relative candidates.
 */
const STATIC_RE = /\/static\/[A-Za-z0-9_.-/]+/g;
// Requires a delimiter before the token, one or more "segment/" groups and a
// known media extension, so prose words never qualify while bare JSON array
// entries do. CJK segments appear in real project directory names.
const BARE_MEDIA_RE = /(?:^|["'\s,[\]:])(?:\.\/)?((?:[A-Za-z0-9_一-鿿][A-Za-z0-9_一-鿿-]*\/)+)([A-Za-z0-9_一-鿿][A-Za-z0-9_一-鿿.-]*)\.(mp4|webm|mov|png|jpg|jpeg|webp|gif|avif|mp3|wav|m4a|m3u8)(?=$|["'\s,\]])/gi;

function collectMatches(valueString, seen) {
  for (const match of valueString.matchAll(STATIC_RE)) {
    const rel = match[0].slice('/static'.length).replace(/^\/+/, '');
    if (/\.[a-z0-9]{2,6}$/i.test(rel)) seen.add(mediaStorage.normalizeKey(rel));
  }
  for (const match of valueString.matchAll(BARE_MEDIA_RE)) {
    const dirs = match[1].replace(/\/$/, '');
    const rel = `${dirs}/${match[2]}.${match[3]}`;
    seen.add(mediaStorage.normalizeKey(rel));
  }
}

function enumerateMediaReferences(db) {
  const seen = new Set();

  let hasLedger = false;
  try {
    hasLedger = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='media_archive_records'").get();
  } catch (_) {}

  if (hasLedger) {
    try {
      const rows = db.prepare(`
        SELECT local_path FROM media_archive_records
        WHERE archive_status IN ('oss_synced', 'local_pruned') AND local_path IS NOT NULL`).all();
      for (const r of rows) seen.add(mediaStorage.normalizeKey(r.local_path));
    } catch (_) {}
  }

  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  for (const { name } of tables) {
    let columns;
    try {
      columns = db.prepare(`PRAGMA table_info(${JSON.stringify(name)})`).all()
        .filter((c) => !c.type || /text|varchar|clob|json/i.test(c.type))
        .map((c) => `"${c.name.replaceAll('"', '""')}"`);
    } catch (_) { continue; }
    for (const col of columns) {
      let values;
      try {
        // A row cap bounds the query; byte/count budgets bound the fill. The
        // /static LIKE filter cannot apply here because bare relative paths
        // (global_settings carousel arrays) lack the prefix entirely.
        values = db.prepare(`SELECT DISTINCT ${col} AS v FROM ${JSON.stringify(name)} LIMIT 5000`).all();
      } catch (_) { continue; }
      for (const { v } of values) {
        if (typeof v !== 'string') continue;
        collectMatches(v, seen);
      }
    }
  }
  return Array.from(seen).map((rel) => ({ rel }));
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.dbPath || !opts.prodRoot || !opts.coldDir) {
    console.error('Usage: fill-preview-media.js <snapshot.db> <prod-storage-root> <cold-dir> [--max-bytes N] [--limit-count N] [--prefer-prefix p1,p2]');
    process.exit(2);
  }

  const cfg = loadConfig();
  if (!mediaStorage.isOss(cfg)) {
    console.log(JSON.stringify({ skipped: 'storage_not_oss', filled: 0, bytes: 0 }));
    return;
  }

  if (!fs.existsSync(opts.dbPath)) {
    console.log(JSON.stringify({ skipped: 'snapshot_missing', dbPath: opts.dbPath, filled: 0, bytes: 0 }));
    return;
  }
  const db = new Database(opts.dbPath, { readonly: true });
  let candidates;
  try {
    candidates = enumerateMediaReferences(db);
  } finally { db.close(); }

  // Preferred prefixes first within each candidate group.
  const rank = (candidate) => {
    const rel = mediaStorage.normalizeKey(candidate.rel);
    const preferred = opts.preferPrefixes.some((prefix) => rel.startsWith(`${prefix}/`));
    return preferred ? 0 : 1;
  };
  candidates.sort((a, b) => rank(a) - rank(b));

  fs.mkdirSync(opts.coldDir, { recursive: true });
  const summary = { filled: 0, skipped_existing: 0, skipped_on_host: 0, missing_in_oss: 0, errors: 0, bytes: 0, stop_reason: null };
  for (const candidate of candidates) {
    if (summary.filled >= opts.limitCount) { summary.stop_reason = 'count_budget'; break; }
    const rel = mediaStorage.normalizeKey(candidate.rel);
    const dest = path.join(opts.coldDir, rel);
    if (!dest.startsWith(path.join(opts.coldDir) + path.sep)) { summary.errors += 1; continue; }
    if (fs.existsSync(dest)) { summary.skipped_existing += 1; continue; }
    // Still hot on the server? The OverlayFS base layer already serves it.
    if (fs.existsSync(path.join(opts.prodRoot, rel))) { summary.skipped_on_host += 1; continue; }

    try {
      // Derive the object key exactly as the serving layer does — legacy
      // uploads may exist in the bucket without any ledger record.
      const body = await mediaStorage.readObjectByKey(cfg, mediaStorage.objectKey(cfg, rel));
      if (!body) { summary.missing_in_oss += 1; continue; }
      if (summary.bytes + body.length > opts.maxBytes) { summary.stop_reason = 'byte_budget'; break; }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, body);
      summary.filled += 1;
      summary.bytes += body.length;
    } catch (err) {
      summary.errors += 1;
      console.error(`fill error ${rel}: ${err.message}`);
    }
  }
  console.log(JSON.stringify(summary));
}

module.exports = { enumerateMediaReferences };

if (require.main === module) {
  main().catch((err) => { console.error(err.stack || err.message); process.exit(1); });
}
