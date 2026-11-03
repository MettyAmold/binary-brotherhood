-- Verknüpfung des Realm-Profils mit dem realmübergreifenden Konto (D1 users.id)
ALTER TABLE members ADD COLUMN userId INTEGER;
CREATE INDEX IF NOT EXISTS idx_members_user ON members(userId);
