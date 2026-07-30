ALTER TABLE assets ADD COLUMN requires_sd2_identity INTEGER NOT NULL DEFAULT 0;
ALTER TABLE omni_video_sequence_shots ADD COLUMN prompt_document_json TEXT;
