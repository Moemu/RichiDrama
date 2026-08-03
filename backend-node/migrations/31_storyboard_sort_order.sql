-- 分镜拖拽排序：新增 sort_order（0-based），查询按 sort_order 优先、storyboard_number 兜底
ALTER TABLE storyboards ADD COLUMN sort_order INTEGER DEFAULT 0;
