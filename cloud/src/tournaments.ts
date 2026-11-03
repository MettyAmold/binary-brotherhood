// Turniere: Anlegen, Starten, Ergebnisse, nächste Swiss-Runde, Sieger. Nutzt die reine Logik aus tournamentLogic.ts.
import { Db, now } from "./db";
import { BadRequest, NotFound, xpAmount } from "./logic";
import { Format, MatchRow, roundRobin, standings, swissPairing, swissRounds, knockoutBracket, nextSlot, roundName } from "./tournamentLogic";

interface TRow { id: number; eventId: number; name: string; gameId: number | null; format: Format; status: "draft" | "running" | "done"; rounds: number; createdBy: number | null; winnerTeamId: number | null; createdAt: number }
interface TeamRow { id: number; tournamentId: number; name: string; seed: number; memberIds: string }
export interface TeamInput { name: string; memberIds: number[] }
export interface TournamentInput { name: string; gameId?: number | null; format: Format; rounds?: number; teams: TeamInput[] }

const FORMATS = new Set<Format>(["league", "swiss", "knockout"]);
export const XP_TOURNAMENT_WIN = "tournament_win";

export class Tournaments {
  constructor(private db: Db) {}

  private async row(id: number) { const t = await this.db.first<TRow>("SELECT * FROM tournaments WHERE id = ?", id); if (!t) throw new NotFound("Turnier nicht gefunden"); return t; }
  private teams(id: number) { return this.db.all<TeamRow>("SELECT * FROM tournament_teams WHERE tournamentId = ? ORDER BY seed", id); }
  private matches(id: number) { return this.db.all<MatchRow & { updatedAt: number | null }>("SELECT * FROM tournament_matches WHERE tournamentId = ? ORDER BY round, slot", id); }

  /** Darf verwalten: Ersteller oder Admin. Ergebnisse zusätzlich die Spieler des Matches. */
  async canManage(id: number, memberId: number, isAdmin: boolean) { const t = await this.row(id); return isAdmin || t.createdBy === memberId; }

  async list(eventId: number | null) {
    const rows = eventId == null ? await this.db.all<TRow>("SELECT * FROM tournaments ORDER BY createdAt DESC")
      : await this.db.all<TRow>("SELECT * FROM tournaments WHERE eventId = ? ORDER BY createdAt DESC", eventId);
    return Promise.all(rows.map(r => this.dto(r)));
  }
  async get(id: number) { return this.dto(await this.row(id)); }

  private async dto(t: TRow) {
    const [teams, matches, members, game, creator] = await Promise.all([
      this.teams(t.id), this.matches(t.id),
      this.db.all<{ id: number; name: string; color: string; hasAvatar: number }>("SELECT id, name, color, hasAvatar FROM members"),
      t.gameId != null ? this.db.first<{ name: string; imageUrl: string }>("SELECT name, imageUrl FROM games WHERE id = ?", t.gameId) : null,
      t.createdBy != null ? this.db.first<{ name: string }>("SELECT name FROM members WHERE id = ?", t.createdBy) : null,
    ]);
    const mBy = new Map(members.map(m => [m.id, m]));
    const teamDtos = teams.map(tm => ({ id: tm.id, name: tm.name, seed: tm.seed,
      members: (JSON.parse(tm.memberIds) as number[]).map(id => mBy.get(id)).filter(Boolean).map(m => ({ id: m!.id, name: m!.name, color: m!.color, hasAvatar: !!m!.hasAvatar })) }));
    const totalRounds = t.format === "knockout" ? Math.max(0, ...matches.map(m => m.round)) : t.rounds;
    return {
      id: t.id, eventId: t.eventId, name: t.name, format: t.format, status: t.status, rounds: totalRounds,
      gameId: t.gameId, gameName: game?.name ?? null, gameImage: game?.imageUrl ?? "",
      createdBy: t.createdBy, createdByName: creator?.name ?? null, winnerTeamId: t.winnerTeamId, createdAt: t.createdAt,
      currentRound: matches.length ? Math.max(...matches.map(m => m.round).filter(r => matches.some(m => m.round === r && m.status === "pending")), 0) || Math.max(...matches.map(m => m.round)) : 0,
      teams: teamDtos,
      matches: matches.map(m => ({ id: m.id, round: m.round, slot: m.slot, teamA: m.teamA, teamB: m.teamB, scoreA: m.scoreA, scoreB: m.scoreB, status: m.status,
        roundName: t.format === "knockout" ? roundName(m.round, totalRounds) : `Runde ${m.round}` })),
      standings: t.format === "knockout" ? [] : standings(teams.map(x => x.id), matches),
    };
  }

  private validate(req: TournamentInput) {
    if (!req.name?.trim()) throw new BadRequest("Name fehlt");
    if (!FORMATS.has(req.format)) throw new BadRequest("Unbekannte Turnierart");
    const teams = (req.teams ?? []).map((t, i) => ({ name: String(t.name ?? "").trim() || `Team ${i + 1}`, memberIds: [...new Set((t.memberIds ?? []).map(Number).filter(Number.isInteger))] }));
    if (teams.length < 2) throw new BadRequest("Mindestens zwei Teams");
    if (teams.length > 64) throw new BadRequest("Höchstens 64 Teams");
    const all = teams.flatMap(t => t.memberIds);
    if (new Set(all).size !== all.length) throw new BadRequest("Ein Mitglied ist in mehreren Teams");
    if (teams.some(t => !t.memberIds.length)) throw new BadRequest("Jedes Team braucht mindestens ein Mitglied");
    const names = teams.map(t => t.name.toLowerCase());
    if (new Set(names).size !== names.length) throw new BadRequest("Teamnamen müssen verschieden sein");
    return teams;
  }

  private async writeTeams(id: number, teams: TeamInput[]) {
    await this.db.batch([
      { sql: "DELETE FROM tournament_teams WHERE tournamentId = ?", params: [id] },
      ...teams.map((t, i) => ({ sql: "INSERT INTO tournament_teams (tournamentId, name, seed, memberIds) VALUES (?, ?, ?, ?)", params: [id, t.name, i + 1, JSON.stringify(t.memberIds)] })),
    ]);
  }

  async create(eventId: number, req: TournamentInput, actorId: number) {
    const teams = this.validate(req);
    const rounds = req.format === "swiss" ? Math.max(1, Math.min(teams.length - 1, Math.round(req.rounds ?? swissRounds(teams.length)))) : 0;
    const id = await this.db.insert("INSERT INTO tournaments (eventId, name, gameId, format, status, rounds, createdBy, createdAt) VALUES (?, ?, ?, ?, 'draft', ?, ?, ?)",
      eventId, req.name.trim(), req.gameId ?? null, req.format, rounds, actorId, now());
    await this.writeTeams(id, teams);
    return this.get(id);
  }

  async update(id: number, req: TournamentInput) {
    const t = await this.row(id);
    if (t.status !== "draft") throw new BadRequest("Ein gestartetes Turnier kann nicht mehr umgebaut werden");
    const teams = this.validate(req);
    const rounds = req.format === "swiss" ? Math.max(1, Math.min(teams.length - 1, Math.round(req.rounds ?? swissRounds(teams.length)))) : 0;
    await this.db.run("UPDATE tournaments SET name = ?, gameId = ?, format = ?, rounds = ? WHERE id = ?", req.name.trim(), req.gameId ?? null, req.format, rounds, id);
    await this.writeTeams(id, teams);
    return this.get(id);
  }

  async remove(id: number) {
    await this.db.batch([
      { sql: "DELETE FROM xp_log WHERE type = ? AND refId = ?", params: [XP_TOURNAMENT_WIN, id] },
      { sql: "DELETE FROM tournament_matches WHERE tournamentId = ?", params: [id] },
      { sql: "DELETE FROM tournament_teams WHERE tournamentId = ?", params: [id] },
      { sql: "DELETE FROM tournaments WHERE id = ?", params: [id] },
    ]);
  }

  private insertMatches(id: number, specs: { round: number; slot: number; teamA: number | null; teamB: number | null }[], byeStatus: boolean) {
    return specs.map(m => ({ sql: "INSERT INTO tournament_matches (tournamentId, round, slot, teamA, teamB, status, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
      params: [id, m.round, m.slot, m.teamA, m.teamB, byeStatus && m.round === 1 && (m.teamA == null) !== (m.teamB == null) ? "bye" : "pending", now()] }));
  }

  async start(id: number) {
    const t = await this.row(id);
    if (t.status !== "draft") throw new BadRequest("Turnier läuft bereits");
    const teamIds = (await this.teams(id)).map(x => x.id);
    let specs;
    if (t.format === "league") specs = roundRobin(teamIds);
    else if (t.format === "swiss") specs = swissPairing(teamIds, [], 1);
    else specs = knockoutBracket(teamIds);
    const rounds = t.format === "league" ? Math.max(...specs.map(m => m.round)) : t.rounds;
    await this.db.batch([
      { sql: "DELETE FROM tournament_matches WHERE tournamentId = ?", params: [id] },
      ...this.insertMatches(id, specs, true),
      { sql: "UPDATE tournaments SET status = 'running', rounds = ? WHERE id = ?", params: [rounds, id] },
    ]);
    if (t.format === "knockout") await this.advanceByes(id);
    return this.get(id);
  }

  /** K.o.: Sieger von Freilosen und entschiedenen Spielen in die nächste Runde schieben. */
  private async advanceByes(id: number) {
    for (const m of await this.matches(id)) {
      if (m.status === "bye") await this.placeWinner(id, m.round, m.slot, (m.teamA ?? m.teamB)!);
    }
  }

  private async placeWinner(id: number, round: number, slot: number, teamId: number | null) {
    const n = nextSlot(round, slot);
    await this.db.run(`UPDATE tournament_matches SET team${n.side} = ?, updatedAt = ? WHERE tournamentId = ? AND round = ? AND slot = ?`, teamId, now(), id, n.round, n.slot);
  }

  /** Darf der Nutzer das Ergebnis dieses Spiels eintragen? Verwalter oder ein Spieler der beiden Teams. */
  async canReport(id: number, matchId: number, memberId: number, isAdmin: boolean) {
    if (await this.canManage(id, memberId, isAdmin)) return true;
    const m = await this.db.first<MatchRow>("SELECT * FROM tournament_matches WHERE id = ? AND tournamentId = ?", matchId, id);
    if (!m) return false;
    const teams = await this.teams(id);
    return teams.filter(t => t.id === m.teamA || t.id === m.teamB).some(t => (JSON.parse(t.memberIds) as number[]).includes(memberId));
  }

  async report(id: number, matchId: number, scoreA: number | null, scoreB: number | null) {
    const t = await this.row(id);
    if (t.status === "draft") throw new BadRequest("Turnier ist noch nicht gestartet");
    const m = await this.db.first<MatchRow>("SELECT * FROM tournament_matches WHERE id = ? AND tournamentId = ?", matchId, id);
    if (!m) throw new NotFound("Spiel nicht gefunden");
    if (m.status === "bye") throw new BadRequest("Freilos hat kein Ergebnis");
    if (m.teamA == null || m.teamB == null) throw new BadRequest("Die Gegner stehen noch nicht fest");
    const clear = scoreA == null && scoreB == null;
    if (!clear) {
      if (!Number.isInteger(scoreA) || !Number.isInteger(scoreB) || scoreA! < 0 || scoreB! < 0 || scoreA! > 9999 || scoreB! > 9999) throw new BadRequest("Ergebnis muss aus zwei ganzen Zahlen ab 0 bestehen");
      if (t.format === "knockout" && scoreA === scoreB) throw new BadRequest("Im K.o.-Turnier braucht es einen Sieger – kein Unentschieden");
    }
    if (t.format === "knockout") {
      const n = nextSlot(m.round, m.slot);
      const next = await this.db.first<MatchRow>("SELECT * FROM tournament_matches WHERE tournamentId = ? AND round = ? AND slot = ?", id, n.round, n.slot);
      if (next && next.status === "done") throw new BadRequest("Das folgende Spiel ist schon entschieden – zuerst dort das Ergebnis löschen");
    }
    if (t.format === "swiss") {
      const later = await this.db.first<{ n: number }>("SELECT COUNT(*) AS n FROM tournament_matches WHERE tournamentId = ? AND round > ?", id, m.round);
      if (later && later.n > 0) throw new BadRequest("Die nächste Runde ist schon ausgelost – Ergebnisse früherer Runden sind fix");
    }
    await this.db.run("UPDATE tournament_matches SET scoreA = ?, scoreB = ?, status = ?, updatedAt = ? WHERE id = ?", clear ? null : scoreA, clear ? null : scoreB, clear ? "pending" : "done", now(), matchId);
    if (t.format === "knockout") await this.placeWinner(id, m.round, m.slot, clear ? null : scoreA! > scoreB! ? m.teamA : m.teamB);
    await this.updateStatus(id);
    return this.get(id);
  }

  async nextRound(id: number) {
    const t = await this.row(id);
    if (t.format !== "swiss") throw new BadRequest("Nur bei Swiss");
    const matches = await this.matches(id);
    const current = Math.max(0, ...matches.map(m => m.round));
    if (matches.some(m => m.round === current && m.status === "pending")) throw new BadRequest("Erst alle Ergebnisse der aktuellen Runde eintragen");
    if (current >= t.rounds) throw new BadRequest("Alle Runden sind gespielt");
    const specs = swissPairing((await this.teams(id)).map(x => x.id), matches, current + 1);
    await this.db.batch(this.insertMatches(id, specs, false).map((s, i) => ({ ...s, params: [...s.params.slice(0, 5), specs[i].teamB == null ? "bye" : "pending", now()] })));
    return this.get(id);
  }

  /** Fertig, wenn alles gespielt ist; Sieger festlegen und XP vergeben (bzw. zurücknehmen). */
  private async updateStatus(id: number) {
    const t = await this.row(id);
    const matches = await this.matches(id);
    const teams = await this.teams(id);
    let winner: number | null = null;
    if (t.format === "knockout") {
      const final = matches.find(m => m.round === Math.max(...matches.map(x => x.round)));
      if (final && final.status === "done") winner = final.scoreA! > final.scoreB! ? final.teamA : final.teamB;
    } else {
      const allDone = matches.every(m => m.status !== "pending");
      const lastRound = Math.max(0, ...matches.map(m => m.round));
      if (allDone && (t.format === "league" || lastRound >= t.rounds)) winner = standings(teams.map(x => x.id), matches)[0]?.teamId ?? null;
    }
    await this.db.run("UPDATE tournaments SET status = ?, winnerTeamId = ? WHERE id = ?", winner ? "done" : "running", winner, id);
    await this.db.run("DELETE FROM xp_log WHERE type = ? AND refId = ?", XP_TOURNAMENT_WIN, id);
    if (winner) {
      const ids = JSON.parse(teams.find(x => x.id === winner)!.memberIds) as number[];
      await this.db.batch(ids.map(mid => ({ sql: "INSERT OR IGNORE INTO xp_log (memberId, type, refId, amount, createdAt) VALUES (?, ?, ?, ?, ?)", params: [mid, XP_TOURNAMENT_WIN, id, xpAmount(XP_TOURNAMENT_WIN), now()] })));
    }
  }
}
