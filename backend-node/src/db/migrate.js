const fs = require('fs');
const path = require('path');
const { getDb } = require('./index.js');
const { loadConfig } = require('../config/index.js');
const { v4: uuidv4 } = require('uuid');

function stripLeadingComments(sql) {
  return sql
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      return t.length > 0 && !t.startsWith('--');
    })
    .join('\n')
    .trim();
}

function runOne(database, sql, file, index) {
  const s = stripLeadingComments(sql);
  if (!s) return;
  try {
    database.exec(s);
    console.log('Ran migration:', file + (index >= 0 ? ' #' + (index + 1) : ''));
  } catch (err) {
    const msg = (err.message || '').toLowerCase();
    if (err.code === 'SQLITE_ERROR' && (msg.includes('duplicate column') || msg.includes('already exists'))) {
      console.log('Skip (already exists):', file + (index >= 0 ? ' #' + (index + 1) : ''));
    } else if (err.code === 'SQLITE_ERROR' && msg.includes('no such table')) {
      // ALTER TABLE 遇到表不存在时，记录警告并跳过（启动后 ensureAllColumns 会兜底建表补列）
      console.warn('Skip migration (table not found, will be ensured later):', file, '-', err.message);
    } else {
      throw err;
    }
  }
}

function runMigrations(database) {
  const migrationsDir = path.join(__dirname, '..', '..', 'migrations');
  if (!fs.existsSync(migrationsDir)) {
    console.log('Migrations dir missing, skipping:', migrationsDir);
    return;
  }
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const fullPath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(fullPath, 'utf8');
    const statements = sql
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (statements.length <= 1) {
      runOne(database, sql, file, -1);
    } else {
      statements.forEach((stmt, i) => runOne(database, stmt + ';', file, i));
    }
  }
}

// Prior releases stored whole points in columns already named *_micro. Convert
// once to true micro-points (1 point = 10,000 micro-points). This runs in one
// SQLite transaction and uses a durable marker, so restarts never rescale
// balances or historical snapshots.
function migrateBillingPrecision(database) {
  const hasSettings = database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='billing_settings'").get();
  if (!hasSettings) return;
  const marker = database.prepare("SELECT value FROM billing_settings WHERE key = 'billing_precision_scale_v2'").get();
  if (marker) return;
  const scale = 10000;
  const multiplyMicroFields = (value) => {
    if (Array.isArray(value)) return value.map(multiplyMicroFields);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, child]) => {
      if (key.endsWith('_micro') && typeof child === 'number' && Number.isSafeInteger(child)) return [key, child * scale];
      return [key, multiplyMicroFields(child)];
    }));
  };
  const updateJsonColumn = (table, column) => {
    const rows = database.prepare(`SELECT rowid, ${column} value FROM ${table} WHERE ${column} IS NOT NULL AND ${column} <> ''`).all();
    const update = database.prepare(`UPDATE ${table} SET ${column} = ? WHERE rowid = ?`);
    for (const row of rows) {
      try { update.run(JSON.stringify(multiplyMicroFields(JSON.parse(row.value))), row.rowid); } catch (_) {}
    }
  };
  database.transaction(() => {
    database.exec(`
      UPDATE billing_accounts SET
        balance_micro = balance_micro * ${scale}, frozen_micro = frozen_micro * ${scale},
        total_recharged_micro = total_recharged_micro * ${scale}, total_consumed_micro = total_consumed_micro * ${scale};
      UPDATE billing_transactions SET
        amount_micro = amount_micro * ${scale}, balance_after_micro = balance_after_micro * ${scale}, frozen_after_micro = frozen_after_micro * ${scale};
      UPDATE billing_usage_logs SET charged_micro = charged_micro * ${scale};
      UPDATE billing_price_book_items SET unit_price_micro = unit_price_micro * ${scale};
    `);
    updateJsonColumn('billing_transactions', 'snapshot_json');
    updateJsonColumn('billing_usage_logs', 'snapshot_json');
    updateJsonColumn('billing_reconciliation_cases', 'resolution_json');
    updateJsonColumn('billing_audit_logs', 'detail_json');
    database.prepare("INSERT INTO billing_settings (key, value, updated_at) VALUES ('billing_precision_scale_v2', ?, ?)")
      .run(String(scale), new Date().toISOString());
  })();
  console.log('Migrated billing ledger to micro-points:', scale);
}

/**
 * 通用：确保某张表存在指定列，不存在则 ALTER TABLE ADD COLUMN。
 * @param {object} database - better-sqlite3 实例
 * @param {string} table - 表名
 * @param {Array<{name:string, type:string}>} columns - 要确保存在的列
 */
function ensureColumns(database, table, columns) {
  let existing;
  try {
    existing = database.prepare(`PRAGMA table_info(${table})`).all();
  } catch (err) {
    if ((err.message || '').toLowerCase().includes('no such table')) {
      console.log(`ensureColumns: table ${table} not found, skip`);
      return;
    }
    throw err;
  }
  const names = new Set(existing.map((r) => r.name));
  for (const col of columns) {
    if (names.has(col.name)) continue;
    try {
      database.exec(`ALTER TABLE ${table} ADD COLUMN ${col.name} ${col.type}`);
      console.log(`ensureColumns: added ${table}.${col.name} (${col.type})`);
    } catch (e) {
      if ((e.message || '').toLowerCase().includes('duplicate column')) {
        // already exists (race / concurrent)
      } else {
        console.warn(`ensureColumns: failed to add ${table}.${col.name}:`, e.message);
      }
    }
  }
}

/**
 * 全量兜底补列：覆盖所有表的所有业务列。
 * 对于旧数据库（用更早版本的 init 脚本创建、缺少部分列），
 * 在每次启动时自动补齐，避免 "no such column" 运行时错误。
 *
 * SQLite 不支持 ALTER TABLE ADD COLUMN ... NOT NULL（无默认值），
 * 所以原 schema 中 NOT NULL 的列在这里用 DEFAULT 兜底。
 */
function ensureAllColumns(database) {
  // --- dramas ---
  ensureColumns(database, 'dramas', [
    { name: 'title',          type: 'TEXT NOT NULL DEFAULT \'\'' },
    { name: 'description',    type: 'TEXT' },
    { name: 'genre',          type: 'TEXT' },
    { name: 'style',          type: 'TEXT DEFAULT \'realistic\'' },
    { name: 'tags',           type: 'TEXT' },
    { name: 'thumbnail',      type: 'TEXT' },
    { name: 'total_episodes', type: 'INTEGER DEFAULT 1' },
    { name: 'total_duration', type: 'INTEGER DEFAULT 0' },
    { name: 'status',         type: 'TEXT DEFAULT \'draft\'' },
    { name: 'metadata',       type: 'TEXT' },
    { name: 'created_at',     type: 'TEXT' },
    { name: 'updated_at',     type: 'TEXT' },
    { name: 'deleted_at',     type: 'TEXT' },
  ]);

  // --- episodes ---
  ensureColumns(database, 'episodes', [
    { name: 'drama_id',       type: 'INTEGER DEFAULT 0' },
    { name: 'episode_number', type: 'INTEGER DEFAULT 0' },
    { name: 'title',          type: 'TEXT DEFAULT \'\'' },
    { name: 'script_content', type: 'TEXT' },
    { name: 'description',    type: 'TEXT' },
    { name: 'duration',       type: 'INTEGER DEFAULT 0' },
    { name: 'video_url',      type: 'TEXT' },
    { name: 'thumbnail',      type: 'TEXT' },
    { name: 'status',         type: 'TEXT DEFAULT \'draft\'' },
    { name: 'created_at',     type: 'TEXT' },
    { name: 'updated_at',     type: 'TEXT' },
    { name: 'deleted_at',     type: 'TEXT' },
    { name: 'generation_defaults_json', type: 'TEXT' },
  ]);

  // --- storyboards ---
  ensureColumns(database, 'storyboards', [
    { name: 'episode_id',        type: 'INTEGER DEFAULT 0' },
    { name: 'scene_id',          type: 'INTEGER' },
    { name: 'storyboard_number', type: 'INTEGER DEFAULT 0' },
    { name: 'title',             type: 'TEXT' },
    { name: 'description',       type: 'TEXT' },
    { name: 'layout_description', type: 'TEXT' },   // 画面布局与人物站位（首尾帧模式空间合同）
    { name: 'location',          type: 'TEXT' },
    { name: 'time',              type: 'TEXT' },
    { name: 'duration',          type: 'REAL' },
    { name: 'dialogue',          type: 'TEXT' },
    { name: 'narration',         type: 'TEXT' },
    { name: 'action',            type: 'TEXT' },
    { name: 'atmosphere',        type: 'TEXT' },
    { name: 'image_prompt',      type: 'TEXT' },
    { name: 'video_prompt',      type: 'TEXT' },
    { name: 'text_model',        type: 'TEXT' },
    { name: 'video_model',       type: 'TEXT' },
    { name: 'video_resolution',  type: 'TEXT' },
    { name: 'video_aspect_ratio', type: 'TEXT' },
    { name: 'video_upscale_resolution', type: 'TEXT' },
    { name: 'video_target_fps', type: 'INTEGER' },
    { name: 'generation_overrides_json', type: 'TEXT' },
    { name: 'characters',        type: 'TEXT' },
    { name: 'shot_type',         type: 'TEXT' },
    { name: 'angle',             type: 'TEXT' },
    { name: 'movement',          type: 'TEXT' },
    { name: 'image_url',         type: 'TEXT' },
    { name: 'local_path',        type: 'TEXT' },
    { name: 'main_panel_idx',    type: 'INTEGER' },
    { name: 'video_url',         type: 'TEXT' },
    { name: 'composed_image',    type: 'TEXT' },
    { name: 'result',            type: 'TEXT' },
    { name: 'emotion',           type: 'TEXT' },               // 当前情绪（兴奋/悲伤/紧张等）
    { name: 'emotion_intensity', type: 'INTEGER' },            // 情绪强度 3/2/1/0/-1
    { name: 'error_msg',         type: 'TEXT' },
    { name: 'segment_index',     type: 'INTEGER DEFAULT 0' },  // 剧情段落索引（0-based）
    { name: 'segment_title',     type: 'TEXT' },               // 剧情段落名称
    { name: 'angle_h',           type: 'TEXT' },               // 水平方向（front/left/back/right...）
    { name: 'angle_v',           type: 'TEXT' },               // 俯仰角度（worm/low/eye_level/high）
    { name: 'angle_s',           type: 'TEXT' },               // 景别（close_up/medium/wide）
    { name: 'lighting_style',    type: 'TEXT' },               // 灯光风格（natural/side/dramatic/golden_hour 等）
    { name: 'depth_of_field',    type: 'TEXT' },               // 景深（shallow/medium/deep/extreme_shallow）
    { name: 'polished_prompt',        type: 'TEXT' },               // 文字AI润色后的图片生成提示词（可编辑，生图时优先使用）
    { name: 'continuity_snapshot',   type: 'TEXT' },               // JSON: 连戏状态快照 {characters:{name:{position,clothing,expression,props}},lighting}
    { name: 'audio_local_path',      type: 'TEXT' },               // 对白 TTS 本地路径
    { name: 'narration_audio_local_path', type: 'TEXT' },         // 解说旁白 TTS 本地路径
    { name: 'creation_mode',     type: 'TEXT DEFAULT \'classic\'' }, // classic | universal
    { name: 'omni_asset_ids',    type: 'TEXT' },
    { name: 'audio_strategy',    type: 'TEXT DEFAULT \'reference_only\'' },
    { name: 'keep_original_audio', type: 'INTEGER DEFAULT 0' },
    { name: 'audio_volume',      type: 'REAL DEFAULT 1' },
    { name: 'audio_fade_seconds', type: 'REAL DEFAULT 0' },
    { name: 'omni_creation_mode', type: 'TEXT DEFAULT \'multi_reference\'' },
    { name: 'omni_first_frame_asset_id', type: 'INTEGER' },
    { name: 'omni_last_frame_asset_id', type: 'INTEGER' },
    { name: 'omni_asset_usage_json', type: 'TEXT' },
    { name: 'universal_segment_text', type: 'TEXT' },              // 全能模式片段描述（@ 引用等）
    { name: 'omni_prompt_document_json', type: 'TEXT' },           // {text,refs:[{asset_id,alias,occurrence,start,end}]}
    { name: 'first_frame_image_id', type: 'INTEGER' },
    { name: 'last_frame_image_id',  type: 'INTEGER' },
    { name: 'last_frame_image_url', type: 'TEXT' },
    { name: 'last_frame_local_path', type: 'TEXT' },
    { name: 'sort_order',        type: 'INTEGER DEFAULT 0' },          // 分镜拖拽排序（0-based；与 storyboard_number 并行，排序优先）
    { name: 'storyboard_uid',    type: 'TEXT' },                       // immutable logical storyboard identity
    { name: 'position',          type: 'INTEGER' },                    // canonical 0-based order inside one episode
    { name: 'status',            type: 'TEXT DEFAULT \'draft\'' },
    { name: 'created_at',        type: 'TEXT' },
    { name: 'updated_at',        type: 'TEXT' },
    { name: 'deleted_at',        type: 'TEXT' },
  ]);

  // --- characters ---
  ensureColumns(database, 'characters', [
    { name: 'drama_id',          type: 'INTEGER DEFAULT 0' },
    { name: 'name',              type: 'TEXT NOT NULL DEFAULT \'\'' },
    { name: 'role',              type: 'TEXT' },
    { name: 'description',       type: 'TEXT' },
    { name: 'personality',       type: 'TEXT' },
    { name: 'appearance',        type: 'TEXT' },
    { name: 'image_url',         type: 'TEXT' },
    { name: 'local_path',        type: 'TEXT' },
    { name: 'extra_images',      type: 'TEXT' },
    { name: 'voice_style',       type: 'TEXT' },
    { name: 'sort_order',        type: 'INTEGER DEFAULT 0' },
    { name: 'error_msg',         type: 'TEXT' },
    { name: 'identity_anchors',  type: 'TEXT' },   // JSON: 6层视觉锚点（骨相/五官/辨识标记/色值/皮肤/发型）
    { name: 'style_tokens',      type: 'TEXT' },   // 风格词 token 列表
    { name: 'color_palette',     type: 'TEXT' },   // JSON: Hex 色值数组
    { name: 'four_view_image_url', type: 'TEXT' }, // 四视图参考图 URL
    { name: 'polished_prompt',   type: 'TEXT' },   // 文字AI润色后的完整图片生成提示词（可编辑，生图时直接使用）
    { name: 'ref_image',         type: 'TEXT' },   // 用户上传的参考图（本地相对路径或 URL），独立于 AI 生成的主图
    { name: 'stages',            type: 'TEXT' },   // JSON: 多阶段造型 [{episode_range:[1,3], appearance:"..."}]
    { name: 'seedance2_asset', type: 'TEXT' },   // JSON: 即梦/Seedance2 素材库认证 hub_asset_id / asset_url 等
    { name: 'seedance2_voice_asset', type: 'TEXT' }, // JSON: Seedance 2.0 音色参考音频（仅 SD2 模型有效）
    { name: 'negative_prompt', type: 'TEXT' },
    { name: 'created_at',        type: 'TEXT' },
    { name: 'updated_at',        type: 'TEXT' },
    { name: 'deleted_at',        type: 'TEXT' },
  ]);

  // --- scenes ---
  ensureColumns(database, 'scenes', [
    { name: 'drama_id',         type: 'INTEGER DEFAULT 0' },
    { name: 'episode_id',       type: 'INTEGER' },
    { name: 'location',         type: 'TEXT' },
    { name: 'time',             type: 'TEXT' },
    { name: 'prompt',           type: 'TEXT' },
    { name: 'polished_prompt',  type: 'TEXT' },  // 文字AI润色后的完整四视图图片提示词，生图时直接使用
    { name: 'image_url',        type: 'TEXT' },
    { name: 'local_path',       type: 'TEXT' },
    { name: 'seedance2_asset',  type: 'TEXT' },
    { name: 'extra_images',     type: 'TEXT' },
    { name: 'ref_image',        type: 'TEXT' },  // 用户上传的参考图（本地相对路径或 URL）
    { name: 'negative_prompt',  type: 'TEXT' },
    { name: 'storyboard_count', type: 'INTEGER DEFAULT 0' },
    { name: 'error_msg',        type: 'TEXT' },
    { name: 'status',           type: 'TEXT DEFAULT \'draft\'' },
    { name: 'created_at',       type: 'TEXT' },
    { name: 'updated_at',       type: 'TEXT' },
    { name: 'deleted_at',       type: 'TEXT' },
  ]);

  // --- props ---
  ensureColumns(database, 'props', [
    { name: 'drama_id',    type: 'INTEGER DEFAULT 0' },
    { name: 'episode_id',  type: 'INTEGER' },
    { name: 'name',        type: 'TEXT NOT NULL DEFAULT \'\'' },
    { name: 'type',        type: 'TEXT' },
    { name: 'description', type: 'TEXT' },
    { name: 'prompt',      type: 'TEXT' },
    { name: 'image_url',    type: 'TEXT' },
    { name: 'local_path',   type: 'TEXT' },
    { name: 'seedance2_asset', type: 'TEXT' },
    { name: 'extra_images', type: 'TEXT' },
    { name: 'ref_image',    type: 'TEXT' },  // 用户上传的参考图（本地相对路径或 URL）
    { name: 'negative_prompt', type: 'TEXT' },
    { name: 'error_msg',    type: 'TEXT' },
    { name: 'created_at',   type: 'TEXT' },
    { name: 'updated_at',   type: 'TEXT' },
    { name: 'deleted_at',   type: 'TEXT' },
  ]);

  // --- tenants ---（兜底列：新用户默认分组标记，见 migrations/61）
  try {
    database.exec(`CREATE TABLE IF NOT EXISTS tenants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active',
      created_by INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);
  } catch (_) {}
  ensureColumns(database, 'tenants', [
    { name: 'is_new_user_default', type: 'INTEGER DEFAULT 0' },
  ]);

  // --- ai_service_configs ---（兜底建表：旧版 01_init.sql 可能未包含此表）
  try {
    database.exec(`CREATE TABLE IF NOT EXISTS ai_service_configs (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      service_type  TEXT NOT NULL DEFAULT 'text',
      provider      TEXT DEFAULT '',
      name          TEXT DEFAULT '',
      base_url      TEXT DEFAULT '',
      api_key       TEXT,
      model         TEXT,
      default_model TEXT,
      endpoint      TEXT,
      query_endpoint TEXT,
      priority      INTEGER DEFAULT 0,
      is_default    INTEGER DEFAULT 0,
      is_active     INTEGER DEFAULT 1,
      settings      TEXT,
      created_at    TEXT,
      updated_at    TEXT,
      deleted_at    TEXT
    )`);
  } catch (_) {}
  ensureColumns(database, 'ai_service_configs', [
    { name: 'service_type',   type: 'TEXT NOT NULL DEFAULT \'text\'' },
    { name: 'provider',       type: 'TEXT DEFAULT \'\'' },
    { name: 'name',           type: 'TEXT DEFAULT \'\'' },
    { name: 'base_url',       type: 'TEXT DEFAULT \'\'' },
    { name: 'api_key',        type: 'TEXT' },
    { name: 'model',          type: 'TEXT' },
    { name: 'default_model',  type: 'TEXT' },
    { name: 'endpoint',       type: 'TEXT' },
    { name: 'query_endpoint', type: 'TEXT' },
    { name: 'priority',       type: 'INTEGER DEFAULT 0' },
    { name: 'is_default',     type: 'INTEGER DEFAULT 0' },
    { name: 'is_active',      type: 'INTEGER DEFAULT 1' },
    { name: 'settings',       type: 'TEXT' },
    { name: 'created_at',     type: 'TEXT' },
    { name: 'updated_at',     type: 'TEXT' },
    { name: 'deleted_at',     type: 'TEXT' },
  ]);

  // --- async_tasks ---
  ensureColumns(database, 'async_tasks', [
    { name: 'type',         type: 'TEXT NOT NULL DEFAULT \'\'' },
    { name: 'status',       type: 'TEXT NOT NULL DEFAULT \'pending\'' },
    { name: 'progress',     type: 'INTEGER DEFAULT 0' },
    { name: 'message',      type: 'TEXT' },
    { name: 'resource_id',  type: 'TEXT' },
    { name: 'completed_at', type: 'TEXT' },
    { name: 'error',        type: 'TEXT' },
    { name: 'result',       type: 'TEXT' },
    { name: 'created_at',   type: 'TEXT' },
    { name: 'updated_at',   type: 'TEXT' },
    { name: 'deleted_at',   type: 'TEXT' },
  ]);

  // --- image_generations ---
  ensureColumns(database, 'image_generations', [
    { name: 'storyboard_id',    type: 'INTEGER' },
    { name: 'drama_id',         type: 'INTEGER' },
    { name: 'episode_id',       type: 'INTEGER' },
    { name: 'scene_id',         type: 'INTEGER' },
    { name: 'character_id',     type: 'INTEGER' },
    { name: 'provider',         type: 'TEXT' },
    { name: 'prompt',           type: 'TEXT' },
    { name: 'negative_prompt',  type: 'TEXT' },
    { name: 'model',            type: 'TEXT' },
    { name: 'frame_type',       type: 'TEXT' },
    { name: 'reference_images', type: 'TEXT' },
    { name: 'use_first_frame_layout_lock', type: 'INTEGER' },
    { name: 'size',             type: 'TEXT' },
    { name: 'quality',          type: 'TEXT' },
    { name: 'image_url',        type: 'TEXT' },
    { name: 'local_path',       type: 'TEXT' },
    { name: 'width',            type: 'INTEGER' },
    { name: 'height',           type: 'INTEGER' },
    { name: 'status',           type: 'TEXT' },
    { name: 'task_id',          type: 'TEXT' },
    { name: 'completed_at',     type: 'TEXT' },
    { name: 'error_msg',        type: 'TEXT' },
    { name: 'created_at',       type: 'TEXT' },
    { name: 'updated_at',       type: 'TEXT' },
    { name: 'deleted_at',       type: 'TEXT' },
  ]);

  // --- video_generations ---
  ensureColumns(database, 'video_generations', [
    { name: 'drama_id',             type: 'INTEGER' },
    { name: 'storyboard_id',        type: 'INTEGER' },
    { name: 'provider',             type: 'TEXT' },
    { name: 'prompt',               type: 'TEXT' },
    { name: 'model',                type: 'TEXT' },
    { name: 'duration',             type: 'REAL' },
    { name: 'aspect_ratio',         type: 'TEXT' },
    { name: 'resolution',           type: 'TEXT' },
    { name: 'seed',                 type: 'INTEGER' },
    { name: 'camera_fixed',         type: 'INTEGER' },
    { name: 'watermark',            type: 'INTEGER' },
    { name: 'image_url',            type: 'TEXT' },
    { name: 'first_frame_url',      type: 'TEXT' },
    { name: 'last_frame_url',       type: 'TEXT' },
    { name: 'reference_image_urls', type: 'TEXT' },
    { name: 'video_url',            type: 'TEXT' },
    { name: 'local_path',           type: 'TEXT' },
    { name: 'source_local_path',    type: 'TEXT' },
    { name: 'intermediate_cleanup_enabled', type: 'INTEGER NOT NULL DEFAULT 0' },
    { name: 'upscale_resolution',   type: 'TEXT' },
    { name: 'upscale_job_id',       type: 'INTEGER' },
    { name: 'upscale_status',       type: 'TEXT' },
    { name: 'upscale_local_path',   type: 'TEXT' },
    { name: 'upscale_billing_authorization_id', type: 'TEXT' },
    { name: 'interpolation_job_id', type: 'INTEGER' },
    { name: 'interpolation_status', type: 'TEXT' },
    { name: 'target_fps',           type: 'INTEGER' },
    { name: 'interpolation_billing_authorization_id', type: 'TEXT' },
    { name: 'output_width',         type: 'INTEGER' },
    { name: 'output_height',        type: 'INTEGER' },
    { name: 'output_resolution',    type: 'TEXT' },
    { name: 'output_fps',           type: 'REAL' },
    { name: 'output_duration_ms',   type: 'INTEGER' },
    { name: 'poster_local_path',    type: 'TEXT' },
    { name: 'status',               type: 'TEXT' },
    { name: 'task_id',              type: 'TEXT' },
    { name: 'provider_task_id',     type: 'TEXT' },
    { name: 'scene_id',             type: 'INTEGER' },
    { name: 'completed_at',         type: 'TEXT' },
    { name: 'error_msg',            type: 'TEXT' },
    // Delivery/archive is intentionally independent from model completion.
    // A locally playable result can wait for OSS retry without becoming failed.
    { name: 'archive_status',        type: 'TEXT' },
    { name: 'archive_error',         type: 'TEXT' },
    { name: 'archive_attempts',      type: 'INTEGER NOT NULL DEFAULT 0' },
    { name: 'archived_at',           type: 'TEXT' },
    { name: 'created_at',           type: 'TEXT' },
    { name: 'updated_at',           type: 'TEXT' },
    { name: 'deleted_at',           type: 'TEXT' },
  ]);

  ensureColumns(database, 'storyboards', [
    { name: 'active_video_generation_id', type: 'INTEGER' },
    { name: 'omni_asset_send_policy', type: "TEXT NOT NULL DEFAULT 'all_selected'" },
  ]);

  ensureColumns(database, 'video_interpolation_jobs', [
    { name: 'output_width',  type: 'INTEGER' },
    { name: 'output_height', type: 'INTEGER' },
  ]);

  ensureColumns(database, 'video_upscale_jobs', [
    { name: 'output_width',       type: 'INTEGER' },
    { name: 'output_height',      type: 'INTEGER' },
    { name: 'output_duration_ms', type: 'INTEGER' },
    { name: 'output_resolution',  type: 'TEXT' },
    { name: 'output_fps',         type: 'REAL' },
  ]);

  // --- video_merges ---
  ensureColumns(database, 'video_merges', [
    { name: 'episode_id',   type: 'INTEGER' },
    { name: 'drama_id',     type: 'INTEGER' },
    { name: 'title',        type: 'TEXT' },
    { name: 'provider',     type: 'TEXT' },
    { name: 'model',        type: 'TEXT' },
    { name: 'status',       type: 'TEXT' },
    { name: 'scenes',       type: 'TEXT' },
    { name: 'merge_options', type: 'TEXT' },
    { name: 'task_id',      type: 'TEXT' },
    { name: 'merged_url',   type: 'TEXT' },
    { name: 'duration',     type: 'INTEGER' },
    { name: 'completed_at', type: 'TEXT' },
    { name: 'error_msg',    type: 'TEXT' },
    { name: 'created_at',   type: 'TEXT' },
    { name: 'deleted_at',   type: 'TEXT' },
  ]);

  // --- assets ---
  ensureColumns(database, 'assets', [
    { name: 'drama_id',     type: 'INTEGER' },
    { name: 'name',         type: 'TEXT' },
    // 原文件名用于素材管理；引用名是稳定且唯一的 @ 标识，避免同名文件错绑。
    { name: 'reference_alias', type: 'TEXT' },
    { name: 'type',         type: 'TEXT' },
    { name: 'category',     type: 'TEXT' },
    { name: 'url',          type: 'TEXT' },
    { name: 'local_path',   type: 'TEXT' },
    { name: 'file_size',    type: 'INTEGER' },
    { name: 'mime_type',    type: 'TEXT' },
    { name: 'width',        type: 'INTEGER' },
    { name: 'height',       type: 'INTEGER' },
    { name: 'duration',     type: 'REAL' },
    { name: 'image_gen_id', type: 'INTEGER' },
    { name: 'video_gen_id', type: 'INTEGER' },
    { name: 'source_type', type: 'TEXT DEFAULT \'upload\'' },
    { name: 'parent_asset_id', type: 'INTEGER' },
    { name: 'thumbnail_local_path', type: 'TEXT' },
    { name: 'metadata_json', type: 'TEXT' },
    { name: 'tags_json', type: 'TEXT' },
    { name: 'is_favorite', type: 'INTEGER NOT NULL DEFAULT 0' },
    { name: 'checksum', type: 'TEXT' },
    { name: 'processing_status', type: 'TEXT DEFAULT \'ready\'' },
    { name: 'error_msg', type: 'TEXT' },
    { name: 'seedance2_asset', type: 'TEXT' },
    { name: 'requires_sd2_identity', type: 'INTEGER NOT NULL DEFAULT 0' },
    { name: 'created_at',   type: 'TEXT' },
    { name: 'updated_at',   type: 'TEXT' },
    { name: 'archived_at',  type: 'TEXT' },
    { name: 'deleted_at',   type: 'TEXT' },
  ]);

  // --- external provider asset groups and bindings ---
  // These tables are additive. Existing seedance2_asset JSON remains the
  // compatibility projection used by old clients and generation jobs.
  try {
    database.exec(`CREATE TABLE IF NOT EXISTS external_asset_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL DEFAULT 0,
      ai_config_id INTEGER NOT NULL,
      provider TEXT NOT NULL,
      remote_group_id TEXT NOT NULL,
      name TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(tenant_id, ai_config_id, provider)
    )`);
    database.exec(`CREATE TABLE IF NOT EXISTS external_asset_bindings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL DEFAULT 0,
      owner_user_id INTEGER,
      local_asset_id INTEGER,
      resource_type TEXT NOT NULL,
      resource_id INTEGER NOT NULL,
      ai_config_id INTEGER NOT NULL,
      provider TEXT NOT NULL,
      remote_group_id TEXT,
      remote_asset_id TEXT,
      upload_id TEXT,
      object_key TEXT,
      asset_type TEXT NOT NULL DEFAULT 'Image',
      source_fingerprint TEXT NOT NULL,
      source_image_url TEXT,
      source_local_path TEXT,
      attempt_no INTEGER NOT NULL DEFAULT 1,
      source_name TEXT,
      status TEXT NOT NULL DEFAULT 'processing',
      stage TEXT NOT NULL DEFAULT 'queued',
      error_code TEXT,
      error_message TEXT,
      provider_request_id TEXT,
      upload_duration_ms INTEGER,
      create_duration_ms INTEGER,
      settlement_duration_ms INTEGER,
      payload_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      active_at TEXT,
      stale_at TEXT,
      UNIQUE(ai_config_id, resource_type, resource_id, source_fingerprint, attempt_no)
    )`);
    database.exec('CREATE INDEX IF NOT EXISTS idx_external_asset_bindings_pending ON external_asset_bindings(provider, status, stage, updated_at)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_external_asset_bindings_resource ON external_asset_bindings(resource_type, resource_id, updated_at DESC)');
  } catch (_) {}
  ensureColumns(database, 'external_asset_bindings', [
    { name: 'attempt_no', type: 'INTEGER NOT NULL DEFAULT 1' },
    { name: 'source_image_url', type: 'TEXT' },
    { name: 'source_local_path', type: 'TEXT' },
    { name: 'upload_duration_ms', type: 'INTEGER' },
    { name: 'create_duration_ms', type: 'INTEGER' },
    { name: 'settlement_duration_ms', type: 'INTEGER' },
  ]);

  // --- billing project attribution snapshots ---
  ensureColumns(database, 'billing_transactions', [
    { name: 'drama_id', type: 'INTEGER' },
    { name: 'project_title_snapshot', type: 'TEXT' },
    { name: 'source_kind', type: 'TEXT' },
    { name: 'source_id', type: 'TEXT' },
    { name: 'organization_id', type: 'INTEGER' },
  ]);
  ensureColumns(database, 'billing_usage_logs', [
    { name: 'drama_id', type: 'INTEGER' },
    { name: 'project_title_snapshot', type: 'TEXT' },
    { name: 'source_kind', type: 'TEXT' },
    { name: 'source_id', type: 'TEXT' },
    { name: 'organization_id', type: 'INTEGER' },
  ]);
  ensureColumns(database, 'billing_reconciliation_cases', [
    { name: 'organization_id', type: 'INTEGER' },
  ]);
  try {
    database.exec('CREATE INDEX IF NOT EXISTS idx_billing_usage_project_created ON billing_usage_logs(drama_id, created_at DESC)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_billing_usage_user_created ON billing_usage_logs(user_id, created_at DESC)');
  } catch (_) {}

  // --- omni_video_jobs ---
  try {
    database.exec(`CREATE TABLE IF NOT EXISTS omni_video_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, video_generation_id INTEGER NOT NULL,
      mode TEXT NOT NULL DEFAULT 'omni', prompt TEXT NOT NULL DEFAULT '', negative_prompt TEXT,
      model_requested TEXT, model_resolved TEXT, capability_snapshot_json TEXT,
      request_snapshot_json TEXT, preprocess_snapshot_json TEXT, input_summary_json TEXT,
      audio_strategy TEXT DEFAULT 'reference_only', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`);
    database.exec(`CREATE TABLE IF NOT EXISTS omni_video_job_assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT, omni_job_id INTEGER NOT NULL, asset_id INTEGER,
      ordinal INTEGER NOT NULL DEFAULT 0, alias TEXT, media_type TEXT, role TEXT, usage TEXT,
      send_to_model INTEGER NOT NULL DEFAULT 0, derived_asset_id INTEGER, provider_asset_ref TEXT,
      snapshot_json TEXT, created_at TEXT NOT NULL
    )`);
    // Project storyboards are not sequence shots. Keep their job association so
    // generation history survives a page refresh and can be queried per shot.
    ensureColumns(database, 'omni_video_jobs', [
      { name: 'sequence_id', type: 'INTEGER' },
      { name: 'shot_id', type: 'INTEGER' },
      { name: 'storyboard_id', type: 'INTEGER' },
      { name: 'hidden_at', type: 'TEXT' },
      { name: 'hidden_by_user_id', type: 'INTEGER' },
    ]);
    database.exec('CREATE INDEX IF NOT EXISTS idx_omni_jobs_owner_visible ON omni_video_jobs(owner_user_id, hidden_at, id DESC)');
  } catch (_) {}

  // --- character_libraries ---
  ensureColumns(database, 'character_libraries', [
    { name: 'drama_id',          type: 'INTEGER' },   // NULL = 全局素材库；有值 = 本剧专属
    { name: 'name',              type: 'TEXT NOT NULL DEFAULT \'\'' },
    { name: 'category',          type: 'TEXT' },
    { name: 'image_url',         type: 'TEXT' },
    { name: 'local_path',        type: 'TEXT' },
    { name: 'description',       type: 'TEXT' },
    { name: 'appearance',        type: 'TEXT' },
    { name: 'tags',              type: 'TEXT' },
    { name: 'source_type',       type: 'TEXT' },
    { name: 'source_id',         type: 'TEXT' },
    { name: 'identity_anchors',  type: 'TEXT' },   // JSON: 6层视觉锚点（骨相/五官/辨识标记/色值/皮肤/发型）
    { name: 'style_tokens',      type: 'TEXT' },   // 风格词 token 列表
    { name: 'color_palette',     type: 'TEXT' },   // JSON: Hex 色值数组
    { name: 'four_view_image_url', type: 'TEXT' }, // 四视图参考图 URL（分镜图生图参考用）
    { name: 'created_at',        type: 'TEXT' },
    { name: 'updated_at',        type: 'TEXT' },
    { name: 'deleted_at',        type: 'TEXT' },
  ]);

  // --- scene_libraries ---
  ensureColumns(database, 'scene_libraries', [
    { name: 'drama_id',    type: 'INTEGER' },   // NULL = 全局素材库
    { name: 'location',    type: 'TEXT NOT NULL DEFAULT \'\'' },
    { name: 'time',        type: 'TEXT' },
    { name: 'prompt',      type: 'TEXT' },
    { name: 'description', type: 'TEXT' },
    { name: 'image_url',   type: 'TEXT' },
    { name: 'local_path',  type: 'TEXT' },
    { name: 'category',    type: 'TEXT' },
    { name: 'tags',        type: 'TEXT' },
    { name: 'source_type', type: 'TEXT' },
    { name: 'source_id',   type: 'TEXT' },
    { name: 'created_at',  type: 'TEXT' },
    { name: 'updated_at',  type: 'TEXT' },
    { name: 'deleted_at',  type: 'TEXT' },
  ]);

  // --- prop_libraries ---
  ensureColumns(database, 'prop_libraries', [
    { name: 'drama_id',    type: 'INTEGER' },   // NULL = 全局素材库
    { name: 'name',        type: 'TEXT NOT NULL DEFAULT \'\'' },
    { name: 'description', type: 'TEXT' },
    { name: 'prompt',      type: 'TEXT' },
    { name: 'image_url',   type: 'TEXT' },
    { name: 'local_path',  type: 'TEXT' },
    { name: 'category',    type: 'TEXT' },
    { name: 'tags',        type: 'TEXT' },
    { name: 'source_type', type: 'TEXT' },
    { name: 'source_id',   type: 'TEXT' },
    { name: 'created_at',  type: 'TEXT' },
    { name: 'updated_at',  type: 'TEXT' },
    { name: 'deleted_at',  type: 'TEXT' },
  ]);

  // --- image_proxy_cache ---
  try {
    database.exec(`CREATE TABLE IF NOT EXISTS image_proxy_cache (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      cache_key  TEXT NOT NULL UNIQUE,
      proxy_url  TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`);
  } catch (_) {}
  ensureColumns(database, 'image_proxy_cache', [
    { name: 'cache_key',  type: 'TEXT NOT NULL DEFAULT \'\'' },
    { name: 'proxy_url',  type: 'TEXT NOT NULL DEFAULT \'\'' },
    { name: 'created_at', type: 'TEXT NOT NULL DEFAULT \'\'' },
  ]);

  // --- ai_model_map（业务场景→模型路由映射表） ---
  try {
    database.exec(`CREATE TABLE IF NOT EXISTS ai_model_map (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      key            TEXT NOT NULL UNIQUE,
      service_type   TEXT NOT NULL DEFAULT 'text',
      config_id      INTEGER,
      model_override TEXT,
      description    TEXT,
      created_at     TEXT NOT NULL DEFAULT '',
      updated_at     TEXT NOT NULL DEFAULT ''
    )`);
  } catch (_) {}
  ensureColumns(database, 'ai_model_map', [
    { name: 'key',            type: 'TEXT NOT NULL DEFAULT \'\'' },
    { name: 'service_type',   type: 'TEXT NOT NULL DEFAULT \'text\'' },
    { name: 'config_id',      type: 'INTEGER' },
    { name: 'model_override', type: 'TEXT' },
    { name: 'description',    type: 'TEXT' },
    { name: 'created_at',     type: 'TEXT NOT NULL DEFAULT \'\'' },
    { name: 'updated_at',     type: 'TEXT NOT NULL DEFAULT \'\'' },
  ]);

  // --- storyboard_characters（分镜与角色库的关联表） ---
  try {
    database.exec(`CREATE TABLE IF NOT EXISTS storyboard_characters (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      storyboard_id  INTEGER NOT NULL,
      character_id   INTEGER NOT NULL,
      created_at     TEXT NOT NULL DEFAULT ''
    )`);
  } catch (_) {}

  // --- global_settings（全局键值设置表） ---
  try {
    database.exec(`CREATE TABLE IF NOT EXISTS global_settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    )`);
  } catch (_) {}
}

function migrateStoryboardIdentityAndPosition(database) {
  const exists = database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='storyboards'").get();
  if (!exists) return;
  database.exec(`CREATE TABLE IF NOT EXISTS schema_migration_markers (
    name TEXT PRIMARY KEY, applied_at TEXT NOT NULL, detail_json TEXT
  )`);
  const markerName = 'storyboard_identity_position_v1';
  if (database.prepare('SELECT 1 FROM schema_migration_markers WHERE name = ?').get(markerName)) return;
  const apply = database.transaction(() => {
    const rows = database.prepare(`SELECT id, episode_id, storyboard_number, sort_order, created_at, deleted_at
      FROM storyboards ORDER BY episode_id, storyboard_number, id`).all();
    const byEpisode = new Map();
    for (const row of rows) {
      const episodeRows = byEpisode.get(Number(row.episode_id)) || [];
      episodeRows.push(row);
      byEpisode.set(Number(row.episode_id), episodeRows);
    }
    const updateActive = database.prepare('UPDATE storyboards SET storyboard_uid = ?, position = ?, sort_order = ?, storyboard_number = ? WHERE id = ?');
    const updateHistorical = database.prepare('UPDATE storyboards SET storyboard_uid = ?, position = ? WHERE id = ?');
    let activeCount = 0;
    let historicalCount = 0;
    for (const episodeRows of byEpisode.values()) {
      const active = episodeRows.filter((row) => !row.deleted_at).sort((a, b) => {
        const sortA = Number.isFinite(Number(a.sort_order)) ? Number(a.sort_order) : Number(a.storyboard_number || 0);
        const sortB = Number.isFinite(Number(b.sort_order)) ? Number(b.sort_order) : Number(b.storyboard_number || 0);
        return sortA - sortB || Number(a.storyboard_number || 0) - Number(b.storyboard_number || 0) || Number(a.id) - Number(b.id);
      });
      const canonicalByNumber = new Map();
      active.forEach((row, index) => {
        const uid = uuidv4();
        updateActive.run(uid, index, index, index + 1, row.id);
        canonicalByNumber.set(Number(row.storyboard_number), { id: Number(row.id), uid });
        activeCount += 1;
      });
      const historicalUidByNumber = new Map();
      for (const row of episodeRows.filter((item) => item.deleted_at)) {
        const number = Number(row.storyboard_number);
        const uid = canonicalByNumber.get(number)?.uid || historicalUidByNumber.get(number) || uuidv4();
        historicalUidByNumber.set(number, uid);
        updateHistorical.run(uid, Math.max(0, number - 1), row.id);
        historicalCount += 1;
      }
    }
    database.exec('CREATE INDEX IF NOT EXISTS idx_storyboards_uid ON storyboards(storyboard_uid)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_storyboards_episode_position ON storyboards(episode_id, position, id)');
    database.prepare('INSERT INTO schema_migration_markers (name, applied_at, detail_json) VALUES (?, ?, ?)')
      .run(markerName, new Date().toISOString(), JSON.stringify({ active: activeCount, historical: historicalCount }));
  });
  apply();
  console.log('Migrated storyboard identity and position.');
}

/** 对已打开的 database 执行迁移与兜底补列（供 app 启动时调用） */
// SQLite cannot widen a CHECK constraint with ALTER COLUMN. Upgrade existing
// ledgers once before migration 52 publishes the millisecond MediaKit meter.
function ensureMillisecondBillingMeter(database) {
  const row = database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='billing_price_book_items'").get();
  if (!row?.sql || row.sql.includes("'millisecond'")) return;
  database.transaction(() => {
    database.exec(`ALTER TABLE billing_price_book_items RENAME TO billing_price_book_items_legacy_meter;
      CREATE TABLE billing_price_book_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        price_book_id INTEGER NOT NULL,
        service_type TEXT NOT NULL,
        model TEXT NOT NULL,
        meter TEXT NOT NULL CHECK(meter IN ('request', 'image', 'second', 'millisecond', 'character', 'input_token', 'output_token')),
        unit_price_micro INTEGER NOT NULL DEFAULT 0 CHECK(unit_price_micro >= 0),
        is_free INTEGER NOT NULL DEFAULT 0,
        conditions_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(price_book_id, service_type, model, meter)
      );
      INSERT INTO billing_price_book_items
        (id, price_book_id, service_type, model, meter, unit_price_micro, is_free, conditions_json, created_at, updated_at)
      SELECT id, price_book_id, service_type, model, meter, unit_price_micro, is_free, conditions_json, created_at, updated_at
      FROM billing_price_book_items_legacy_meter;
      DROP TABLE billing_price_book_items_legacy_meter;
      CREATE INDEX IF NOT EXISTS idx_billing_price_items_lookup
        ON billing_price_book_items(service_type, model, meter, price_book_id);`);
  })();
  console.log('Expanded billing meter schema for millisecond usage.');
}

function runMigrationsAndEnsure(database) {
  ensureMillisecondBillingMeter(database);
  runMigrations(database);
  migrateBillingPrecision(database);
  ensureAllColumns(database);
  migrateStoryboardIdentityAndPosition(database);
}

function main() {
  const config = loadConfig();
  const database = getDb(config.database);
  runMigrationsAndEnsure(database);
  console.log('Migrations complete.');
}

if (require.main === module) {
  main();
}

module.exports = { runMigrationsAndEnsure, ensureColumns };
