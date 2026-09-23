-- LAS 中转治理：耗时统计、TOS 对象清单与仅对新任务生效的清理策略。
-- 历史行 tos_policy 为 NULL，清理逻辑必须跳过；只有发布后新建任务写入 'cleanup'。
ALTER TABLE las_media_jobs ADD COLUMN submitted_at TEXT;
ALTER TABLE las_media_jobs ADD COLUMN completed_at TEXT;
ALTER TABLE las_media_jobs ADD COLUMN tos_objects_json TEXT;
ALTER TABLE las_media_jobs ADD COLUMN tos_cleanup_at TEXT;
ALTER TABLE las_media_jobs ADD COLUMN tos_cleanup_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE las_media_jobs ADD COLUMN tos_policy TEXT;
