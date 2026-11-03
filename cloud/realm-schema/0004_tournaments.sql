-- Turniere mit Teams und Spielen (Liga, Swiss, K.o.)
CREATE TABLE IF NOT EXISTS tournaments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, eventId INTEGER NOT NULL, name TEXT NOT NULL, gameId INTEGER, format TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft', rounds INTEGER NOT NULL DEFAULT 0, createdBy INTEGER, winnerTeamId INTEGER, createdAt INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tournament_teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT, tournamentId INTEGER NOT NULL, name TEXT NOT NULL, seed INTEGER NOT NULL, memberIds TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_tteams_t ON tournament_teams(tournamentId);
CREATE TABLE IF NOT EXISTS tournament_matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT, tournamentId INTEGER NOT NULL, round INTEGER NOT NULL, slot INTEGER NOT NULL,
  teamA INTEGER, teamB INTEGER, scoreA INTEGER, scoreB INTEGER, status TEXT NOT NULL DEFAULT 'pending', updatedAt INTEGER
);
CREATE INDEX IF NOT EXISTS idx_tmatches_t ON tournament_matches(tournamentId);
