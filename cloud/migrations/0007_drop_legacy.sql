-- Altbestand aus der Zeit vor den Realms (liegt jetzt im Realm binary-brotherhood). Backup: ~/.config/bbl/d1-backup-2026-11-04.sql
DROP TABLE IF EXISTS attendance; DROP TABLE IF EXISTS auth_tokens; DROP TABLE IF EXISTS changes; DROP TABLE IF EXISTS equipment;
DROP TABLE IF EXISTS events; DROP TABLE IF EXISTS expense_shares; DROP TABLE IF EXISTS expenses; DROP TABLE IF EXISTS forum_comments;
DROP TABLE IF EXISTS forum_posts; DROP TABLE IF EXISTS games; DROP TABLE IF EXISTS media; DROP TABLE IF EXISTS members;
DROP TABLE IF EXISTS payments; DROP TABLE IF EXISTS poll_votes; DROP TABLE IF EXISTS polls; DROP TABLE IF EXISTS session_participants;
DROP TABLE IF EXISTS sessions; DROP TABLE IF EXISTS settings; DROP TABLE IF EXISTS shares; DROP TABLE IF EXISTS sounds;
DROP TABLE IF EXISTS suggestion_comments; DROP TABLE IF EXISTS suggestion_votes; DROP TABLE IF EXISTS suggestions;
DROP TABLE IF EXISTS tournament_matches; DROP TABLE IF EXISTS tournament_teams; DROP TABLE IF EXISTS tournaments; DROP TABLE IF EXISTS xp_log;
ALTER TABLE realms DROP COLUMN linked;
