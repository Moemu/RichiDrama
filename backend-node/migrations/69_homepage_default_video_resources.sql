-- 主页默认轮播是产品资源，不从管理员或其他用户的生成记录动态派生。
-- 仅在首次升级时写入当前已验证的三条本地成片；后续可通过该全局设置替换，
-- 不会覆盖已有部署的显式配置。
INSERT OR IGNORE INTO global_settings (key, value, updated_at) VALUES
  ('homepage_default_video_paths', '["library/videos/vg_64_f36d4152.mp4","library/videos/vg_63_4afe75bc.mp4","library/videos/vg_62_9fe88acc.mp4"]', '2026-08-18T00:00:00.000Z');
