-- Vom Admin hochgeladene Klänge (spin, winner)
CREATE TABLE IF NOT EXISTS sounds (kind TEXT PRIMARY KEY, data BLOB NOT NULL, contentType TEXT NOT NULL, name TEXT NOT NULL, updatedAt INTEGER NOT NULL);
