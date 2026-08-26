#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { runMigrationsAndEnsure } = require('../src/db/migrate');

const PRESERVED_TABLES = ['users', 'dramas', 'billing_transactions'];

function tableExists(db, table) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
}

function counts(db) {
  return Object.fromEntries(PRESERVED_TABLES
    .filter((table) => tableExists(db, table))
    .map((table) => [table, Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count)]));
}

function assertIntegrity(db, pass) {
  const result = db.pragma('integrity_check', { simple: true });
  if (result !== 'ok') throw new Error(`SQLite integrity check failed after pass ${pass}: ${result}`);
}

function verifyDatabase(dbPath) {
  const resolved = path.resolve(dbPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const existed = fs.existsSync(resolved);
  const db = new Database(resolved);
  try {
    const before = counts(db);
    for (let pass = 1; pass <= 2; pass += 1) {
      runMigrationsAndEnsure(db);
      assertIntegrity(db, pass);
    }
    const after = counts(db);
    for (const [table, value] of Object.entries(before)) {
      if (!(table in after) || after[table] < value) {
        throw new Error(`Migration reduced ${table} rows: ${value} -> ${after[table] ?? 'missing'}`);
      }
    }
    return { database: resolved, source: existed ? 'existing' : 'empty', before, after, integrity: 'ok', passes: 2 };
  } finally {
    db.close();
  }
}

if (require.main === module) {
  const dbPath = process.argv[2] || process.env.MIGRATION_DB_PATH;
  if (!dbPath) {
    console.error('Usage: node tools/verify-migrations.js <database-path>');
    process.exit(2);
  }
  try {
    console.log(JSON.stringify(verifyDatabase(dbPath)));
  } catch (error) {
    console.error(error.stack || error.message);
    process.exit(1);
  }
}

module.exports = { verifyDatabase, counts, PRESERVED_TABLES };
