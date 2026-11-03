-- Realm-Verzeichnis. Die Daten eines Realms liegen in seinem Durable Object (Schema: realm-schema/).
CREATE TABLE IF NOT EXISTS realms (
  slug TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'lan', createdAt INTEGER NOT NULL, legacy INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO realms (slug, name, kind, createdAt, legacy) VALUES ('binary-brotherhood', 'BINARY BROTHERHOOD', 'lan', 0, 1);
