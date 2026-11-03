-- Realms: jede Gruppe (LAN-Party oder Online-Runde) hat ihre eigene Datenbank in einem Durable Object.
-- Hier steht nur das Verzeichnis. Die Tabellen von 0001–0004 bleiben als Altbestand des ersten Realms liegen.
CREATE TABLE IF NOT EXISTS realms (
  slug TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'lan', createdAt INTEGER NOT NULL, legacy INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO realms (slug, name, kind, createdAt, legacy) VALUES ('binary-brotherhood', 'BINARY BROTHERHOOD', 'lan', 0, 1);
