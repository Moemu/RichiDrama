-- Per-storyboard model choices must survive reloads and be used for both text and video calls.
ALTER TABLE storyboards ADD COLUMN text_model TEXT;
ALTER TABLE storyboards ADD COLUMN video_model TEXT;
ALTER TABLE storyboards ADD COLUMN video_resolution TEXT;
ALTER TABLE storyboards ADD COLUMN video_aspect_ratio TEXT;
