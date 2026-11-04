-- Safe schema change: keep existing article HTML/text, allow long rich-text bodies.
-- Run once if the API server has not already applied this on startup.
ALTER TABLE articles
  MODIFY COLUMN description LONGTEXT NOT NULL;
