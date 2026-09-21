-- Pin the AI config that submitted an in-flight generation so a restart or a
-- later default change cannot re-resolve it by model name. The Star Proxy only
-- lets the key that created a task query or cancel it. Historical rows stay NULL
-- and keep the original resolve-by-model-name path.
--
-- 注意两处同名列的语义不同，不得混用：
--   - 素材库（richbest_asset_v3 相关表）的 ai_config_id 记录素材归属哪条配置；
--   - 这里的 ai_config_id 记录「生成任务由哪条配置提交」，用于查询/取消时同源 Key。
ALTER TABLE video_generations ADD COLUMN ai_config_id INTEGER;
ALTER TABLE image_generations ADD COLUMN ai_config_id INTEGER;
