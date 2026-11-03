-- Konten gelten für alle Realms. XP, Level und Realm-Admin-Rechte liegen im Realm.
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL COLLATE NOCASE UNIQUE, password TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#C9A24D', motto TEXT NOT NULL DEFAULT '', avatar BLOB, avatarUpdatedAt INTEGER,
  isSuperAdmin INTEGER NOT NULL DEFAULT 0, createdAt INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS user_tokens (
  tokenHash TEXT PRIMARY KEY, userId INTEGER NOT NULL, device TEXT NOT NULL DEFAULT '', createdAt INTEGER NOT NULL, lastUsedAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_tokens_user ON user_tokens(userId);
CREATE TABLE IF NOT EXISTS realm_members (
  realmSlug TEXT NOT NULL, userId INTEGER NOT NULL, memberId INTEGER NOT NULL, joinedAt INTEGER NOT NULL, PRIMARY KEY (realmSlug, userId)
);
CREATE INDEX IF NOT EXISTS idx_realm_members_user ON realm_members(userId);
