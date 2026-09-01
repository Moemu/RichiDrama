'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const guards = require('../src/utils/seedance2AssetGuards');

test('a Richbest pending binding becomes stale when the character image changes', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE characters (id INTEGER PRIMARY KEY, image_url TEXT, local_path TEXT, seedance2_asset TEXT, updated_at TEXT);
    CREATE TABLE external_asset_bindings (
      id INTEGER PRIMARY KEY, provider TEXT, resource_type TEXT, resource_id INTEGER, source_fingerprint TEXT,
      status TEXT, stage TEXT, stale_at TEXT, updated_at TEXT
    );
  `);
  const certificate = {
    sd2_provider: 'richbest_asset_v3',
    status: 'processing',
    source_fingerprint: 'fingerprint-old',
    certified_image_url: '/static/characters/old.png',
    certified_local_path: 'characters/old.png',
  };
  db.prepare('INSERT INTO characters VALUES (1,?,?,?,?)')
    .run('/static/characters/old.png', 'characters/old.png', JSON.stringify(certificate), new Date().toISOString());
  db.prepare('INSERT INTO external_asset_bindings VALUES (1,?,?,?,?,?,?,NULL,?)')
    .run('richbest_asset_v3', 'character', 1, 'fingerprint-old', 'processing', 'processing', new Date().toISOString());
  try {
    let row = db.prepare('SELECT * FROM characters WHERE id=1').get();
    guards.markStaleOnCharacterMainImageDrift(db, null, row, {
      image_url: '/static/characters/new.png',
      local_path: 'characters/new.png',
    });
    let saved = JSON.parse(db.prepare('SELECT seedance2_asset FROM characters WHERE id=1').get().seedance2_asset);
    assert.equal(saved.status, 'stale');
    assert.equal(saved.stale_previous_status, 'processing');
    assert.equal(saved.certified_local_path, 'characters/old.png');
    assert.equal(db.prepare('SELECT status FROM external_asset_bindings WHERE id=1').get().status, 'stale');

    db.prepare('UPDATE characters SET image_url=?,local_path=? WHERE id=1')
      .run('/static/characters/new.png', 'characters/new.png');
    row = db.prepare('SELECT * FROM characters WHERE id=1').get();
    guards.markStaleOnCharacterMainImageDrift(db, null, row, {
      image_url: '/static/characters/old.png',
      local_path: 'characters/old.png',
    });
    saved = JSON.parse(db.prepare('SELECT seedance2_asset FROM characters WHERE id=1').get().seedance2_asset);
    assert.equal(saved.status, 'processing');
    assert.equal(db.prepare('SELECT status FROM external_asset_bindings WHERE id=1').get().status, 'processing');
  } finally { db.close(); }
});
