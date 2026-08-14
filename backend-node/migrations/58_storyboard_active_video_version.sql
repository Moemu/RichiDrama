-- New generations bind a storyboard to one explicit version. Historical
-- records keep their old video_url behavior until a user adopts a version.
ALTER TABLE storyboards ADD COLUMN active_video_generation_id INTEGER;
