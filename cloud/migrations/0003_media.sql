-- Bilder und GIFs an Forum-Beiträgen und Kommentaren
CREATE TABLE IF NOT EXISTS media (
  id INTEGER PRIMARY KEY AUTOINCREMENT, contentType TEXT NOT NULL, data BLOB NOT NULL, size INTEGER NOT NULL, name TEXT NOT NULL DEFAULT '',
  uploadedBy INTEGER, postId INTEGER, commentId INTEGER, createdAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_media_post ON media(postId);
CREATE INDEX IF NOT EXISTS idx_media_comment ON media(commentId);
