'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { applySeedance2CertifiedAssetUrlsToVideoOpts } = require('../src/services/videoClient');

function setup(seedance2Asset) {
  const db = new Database(':memory:');
  for (const table of ['characters', 'scenes', 'props']) {
    db.exec(`CREATE TABLE ${table} (id INTEGER PRIMARY KEY, drama_id INTEGER, image_url TEXT, local_path TEXT, seedance2_asset TEXT, deleted_at TEXT)`);
  }
  db.prepare('INSERT INTO characters (id,drama_id,image_url,local_path,seedance2_asset) VALUES (1,1,?,?,?)')
    .run('http://local.test/static/characters/hero.png', 'characters/hero.png', JSON.stringify(seedance2Asset));
  return db;
}

test('active Richbest character images are replaced with asset references', () => {
  const db = setup({ sd2_provider: 'richbest_asset_v3', status: 'active', asset_url: 'asset://asset-1' });
  try {
    const result = applySeedance2CertifiedAssetUrlsToVideoOpts(db, null, {
      drama_id: 1,
      image_url: 'http://local.test/static/characters/hero.png',
    });
    assert.equal(result.image_url, 'asset://asset-1');
  } finally { db.close(); }
});

test('pending or stale Richbest character images cannot fall back to raw images', () => {
  for (const status of ['processing', 'reconciling', 'failed', 'stale']) {
    const db = setup({ sd2_provider: 'richbest_asset_v3', status, asset_url: null });
    try {
      assert.throws(() => applySeedance2CertifiedAssetUrlsToVideoOpts(db, null, {
        drama_id: 1,
        image_url: 'http://local.test/static/characters/hero.png',
      }), /禁止回退/);
    } finally { db.close(); }
  }
});
