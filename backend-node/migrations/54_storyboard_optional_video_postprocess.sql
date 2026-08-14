-- Per-shot post-processing choices. NULL means the stage is not requested.
ALTER TABLE storyboards ADD COLUMN video_upscale_resolution TEXT;
ALTER TABLE storyboards ADD COLUMN video_target_fps INTEGER;

-- Imported media is already a completed local source and never implicitly
-- opts into a paid post-processing stage.
UPDATE video_generations
SET upscale_resolution = NULL,
    target_fps = NULL,
    upscale_status = 'skipped',
    interpolation_status = 'skipped'
WHERE provider = 'imported';
