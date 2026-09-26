-- 投流剪辑（爆款素材剪辑 las_viral_clip_gen）：独立任务模型，N 集输入 → 多条成片。
-- 全部为新建表；历史 las_media_jobs 与既有任务不受影响。
-- 价目种子：镜像已发布的 LAS 价目书（含 las-video-translate 的书），补两条 1:1 项：
-- 输入分析 150 积分/分钟（millisecond），剪辑合成 6 积分/分钟（second）。
-- 上游文档称输出单价按剪辑模式不同而不同，但只给出 0.06 元/分钟代表价，未公布各模式真实价；
-- MVP 先对两个模式扁平 1:1。待上游给出真实分模式价后，再为输出项增加 mode 条件价，
-- 并同步把 mode 加入 billing 条件价白名单——这一步是增量，不影响历史结算。
CREATE TABLE IF NOT EXISTS viral_edit_jobs (
  id TEXT PRIMARY KEY,
  owner_user_id INTEGER NOT NULL,
  drama_id INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL,
  input_assets_json TEXT NOT NULL,
  params_json TEXT NOT NULL,
  input_json TEXT NOT NULL,
  provider_task_id TEXT,
  result_json TEXT,
  storyboard_local_path TEXT,
  authorization_id TEXT,
  lease_token TEXT,
  lease_until TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'submitting', 'processing', 'finalizing', 'completed', 'failed', 'reconciliation')),
  error_msg TEXT,
  submitted_at TEXT,
  completed_at TEXT,
  tos_objects_json TEXT,
  tos_cleanup_at TEXT,
  tos_cleanup_attempts INTEGER NOT NULL DEFAULT 0,
  tos_policy TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(owner_user_id, idempotency_key),
  FOREIGN KEY(owner_user_id) REFERENCES users(id),
  FOREIGN KEY(drama_id) REFERENCES dramas(id)
);

CREATE TABLE IF NOT EXISTS viral_edit_outputs (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  clip_index INTEGER NOT NULL,
  owner_user_id INTEGER NOT NULL,
  drama_id INTEGER NOT NULL,
  provider_clip_id TEXT,
  provider_duration_sec REAL,
  local_path TEXT,
  file_size INTEGER,
  width INTEGER,
  height INTEGER,
  duration_ms INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'downloaded', 'saved', 'failed')),
  asset_id INTEGER,
  timeline_json TEXT,
  rating_summary_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(job_id, clip_index),
  FOREIGN KEY(job_id) REFERENCES viral_edit_jobs(id),
  FOREIGN KEY(owner_user_id) REFERENCES users(id),
  FOREIGN KEY(drama_id) REFERENCES dramas(id),
  FOREIGN KEY(asset_id) REFERENCES assets(id)
);

CREATE INDEX IF NOT EXISTS idx_viral_edit_jobs_owner_project ON viral_edit_jobs(owner_user_id, drama_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_viral_edit_jobs_status ON viral_edit_jobs(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_viral_edit_outputs_job ON viral_edit_outputs(job_id, clip_index);

INSERT INTO billing_price_book_items
  (price_book_id, service_type, model, meter, unit_price_micro, is_free, conditions_json, created_at, updated_at)
SELECT pb.id, 'video_postprocess', 'las-viral-clip-gen', 'millisecond',
  CASE WHEN EXISTS (SELECT 1 FROM billing_settings WHERE key = 'billing_precision_scale_v2') THEN 1500000 ELSE 150 END, 0,
  '{"currency":"CNY","unit_size":60000,"source":"https://docs.byteplus.com/en/docs/Byteplus_LAS/Viral_content_editing","verified_on":"2026-09-24","provider":"las","pricing_note":"爆款素材剪辑输入分析，上游 1.5 元/分钟，对用户 1:1 计价（100 积分 = 1 元）"}',
  '2026-09-24T00:00:00.000Z', '2026-09-24T00:00:00.000Z'
FROM billing_price_books pb
WHERE pb.status = 'published'
  AND EXISTS (SELECT 1 FROM billing_price_book_items i
    WHERE i.price_book_id = pb.id AND i.service_type = 'video_postprocess'
      AND i.model = 'las-video-translate' AND i.meter = 'millisecond')
  AND NOT EXISTS (SELECT 1 FROM billing_price_book_items i
    WHERE i.price_book_id = pb.id AND i.service_type = 'video_postprocess'
      AND i.model = 'las-viral-clip-gen' AND i.meter = 'millisecond');

INSERT INTO billing_price_book_items
  (price_book_id, service_type, model, meter, unit_price_micro, is_free, conditions_json, created_at, updated_at)
SELECT pb.id, 'video_postprocess', 'las-viral-clip-gen', 'second',
  CASE WHEN EXISTS (SELECT 1 FROM billing_settings WHERE key = 'billing_precision_scale_v2') THEN 60000 ELSE 6 END, 0,
  '{"currency":"CNY","unit_size":60,"source":"https://docs.byteplus.com/en/docs/Byteplus_LAS/Viral_content_editing","verified_on":"2026-09-24","provider":"las","pricing_note":"爆款素材剪辑合成输出，上游 0.06 元/分钟代表价，对用户 1:1；官方称按剪辑模式差异化定价但未公布各模式真实价，取得真实价前扁平计价"}',
  '2026-09-24T00:00:00.000Z', '2026-09-24T00:00:00.000Z'
FROM billing_price_books pb
WHERE pb.status = 'published'
  AND EXISTS (SELECT 1 FROM billing_price_book_items i
    WHERE i.price_book_id = pb.id AND i.service_type = 'video_postprocess'
      AND i.model = 'las-video-translate' AND i.meter = 'millisecond')
  AND NOT EXISTS (SELECT 1 FROM billing_price_book_items i
    WHERE i.price_book_id = pb.id AND i.service_type = 'video_postprocess'
      AND i.model = 'las-viral-clip-gen' AND i.meter = 'second');
