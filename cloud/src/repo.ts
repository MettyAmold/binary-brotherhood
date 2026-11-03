// Datenzugriff und Geschäftsregeln, Port von domain/Repository.kt. Liefert dieselben DTOs wie die Android-App.
import { Db, now, bool } from "./db";
import { XP, xpAmount, xpLabel, levelForXp, summarizeCosts, ExpenseInput, normalizeUnc, isGameFolder, gameKey, displayName, BadRequest, NotFound, Forbidden } from "./logic";

/** D1 liefert BLOBs je nach Laufzeit als ArrayBuffer oder als Zahlenliste – beides zu Bytes machen. */
export const toBytes = (v: ArrayBuffer | ArrayBufferView | number[]): Uint8Array =>
  v instanceof ArrayBuffer ? new Uint8Array(v) : ArrayBuffer.isView(v) ? new Uint8Array(v.buffer, v.byteOffset, v.byteLength) : new Uint8Array(v);

const PALETTE = ["#C9A24D", "#D96C4F", "#4FA3D9", "#6BBF59", "#B05ED9", "#E0B04C", "#48C9B0", "#E05C8A", "#8E9BFF", "#F08A24", "#5DD39E", "#D64545"];
const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const groupBy = <T, K>(list: T[], key: (t: T) => K): Map<K, T[]> => { const m = new Map<K, T[]>(); for (const t of list) { const k = key(t); (m.get(k) ?? m.set(k, []).get(k)!).push(t); } return m; };
const byId = <T extends { id: number }>(list: T[]) => new Map(list.map(t => [t.id, t]));

// ---- Zeilentypen
interface EventRow { id: number; name: string; year: number; startDate: string; days: number; isCurrent: number; createdAt: number }
interface MemberRow { id: number; name: string; motto: string; color: string; hasAvatar: number; createdAt: number; password: string; isAdmin: number; avatarUpdatedAt: number | null }
interface GameRow { id: number; name: string; description: string; steamUrl: string; steamAppId: number | null; imageUrl: string; players: string; addedById: number | null; selectedForNext: number; createdAt: number; sharePath: string; shareId: number | null }
interface SessionRow { id: number; gameId: number; eventId: number; startedAt: number; endedAt: number | null; chosenBy: string; note: string }
interface SuggestionRow { id: number; scope: string; title: string; description: string; steamUrl: string; steamAppId: number | null; imageUrl: string; authorId: number | null; adoptedGameId: number | null; createdAt: number }
interface ForumPostRow { id: number; authorId: number | null; title: string; body: string; pinned: number; createdAt: number }
interface CommentRow { id: number; authorId: number | null; text: string; createdAt: number; parentId: number }
interface ExpenseRow { id: number; eventId: number; title: string; amountCents: number; paidById: number; day: number | null; note: string; createdAt: number }
interface EquipmentRow { id: number; eventId: number; name: string; category: string; quantity: number; note: string; bringerId: number | null; done: number; createdAt: number }
interface PollRow { id: number; eventId: number; open: number; winnerGameId: number | null; createdAt: number; closedAt: number | null }
interface ShareRow { id: number; path: string; addedById: number | null; lastScanAt: number | null; lastError: string; lastCount: number; knownFolders: string; uploadKey: string; createdAt: number }

const MEMBER_COLS = "id, name, motto, color, hasAvatar, createdAt, password, isAdmin, avatarUpdatedAt";

export class Repo {
  constructor(private db: Db) {}

  // ================================================================ Events
  async ensureCurrentEvent(): Promise<EventRow> {
    const cur = await this.db.first<EventRow>("SELECT * FROM events WHERE isCurrent = 1 LIMIT 1");
    if (cur) return cur;
    const year = new Date().getFullYear();
    const id = await this.db.insert("INSERT INTO events (name, year, startDate, days, isCurrent, createdAt) VALUES (?, ?, ?, 3, 1, ?)", `LAN-Party ${year}`, year, new Date().toISOString().slice(0, 10), now());
    return (await this.db.first<EventRow>("SELECT * FROM events WHERE id = ?", id))!;
  }
  private eventDto = (e: EventRow) => ({ id: e.id, name: e.name, year: e.year, startDate: e.startDate, days: e.days, isCurrent: bool(e.isCurrent) });
  async events() { return (await this.db.all<EventRow>("SELECT * FROM events ORDER BY startDate DESC, id DESC")).map(this.eventDto); }
  private async eventOrCurrent(eventId: number | null) { return (eventId ? await this.db.first<EventRow>("SELECT * FROM events WHERE id = ?", eventId) : null) ?? this.ensureCurrentEvent(); }

  async createEvent(req: { name: string; year: number; startDate: string; days: number; copyEquipment?: boolean; activate?: boolean }) {
    if (!req.name?.trim()) throw new BadRequest("Name fehlt");
    const previous = await this.db.first<EventRow>("SELECT * FROM events WHERE isCurrent = 1 LIMIT 1");
    const id = await this.db.insert("INSERT INTO events (name, year, startDate, days, isCurrent, createdAt) VALUES (?, ?, ?, ?, 0, ?)", req.name.trim(), req.year, req.startDate, Math.min(14, Math.max(1, req.days)), now());
    if (req.activate ?? true) {
      await this.db.run("UPDATE events SET isCurrent = (id = ?)", id);
      await this.db.run("UPDATE suggestions SET scope = 'current' WHERE scope = 'next' AND adoptedGameId IS NULL");
    }
    if ((req.copyEquipment ?? true) && previous) await this.copyEquipment(previous.id, id);
    return this.eventDto((await this.db.first<EventRow>("SELECT * FROM events WHERE id = ?", id))!);
  }
  async updateEvent(id: number, req: { name: string; year: number; startDate: string; days: number }) {
    const e = await this.db.first<EventRow>("SELECT * FROM events WHERE id = ?", id);
    if (!e) throw new NotFound("Ausgabe nicht gefunden");
    await this.db.run("UPDATE events SET name = ?, year = ?, startDate = ?, days = ? WHERE id = ?", req.name.trim(), req.year, req.startDate, Math.min(14, Math.max(1, req.days)), id);
    return this.eventDto((await this.db.first<EventRow>("SELECT * FROM events WHERE id = ?", id))!);
  }
  async activateEvent(id: number) {
    if (!(await this.db.first("SELECT id FROM events WHERE id = ?", id))) throw new NotFound("Ausgabe nicht gefunden");
    await this.db.run("UPDATE events SET isCurrent = (id = ?)", id);
  }
  async deleteEvent(id: number) {
    const e = await this.db.first<EventRow>("SELECT * FROM events WHERE id = ?", id);
    if (!e) return;
    if (bool(e.isCurrent)) throw new BadRequest("Die aktuelle Ausgabe kann nicht gelöscht werden");
    await this.db.run("DELETE FROM events WHERE id = ?", id);
  }

  // ================================================================ Members
  async members() {
    const [xp, sessions, parts, games, posts, fComments, sComments, suggestions, event, rows] = await Promise.all([
      this.db.all<{ memberId: number; amount: number }>("SELECT memberId, amount FROM xp_log"),
      this.db.all<SessionRow>("SELECT * FROM sessions"),
      this.db.all<{ sessionId: number; memberId: number }>("SELECT * FROM session_participants"),
      this.db.all<GameRow>("SELECT id, name FROM games"),
      this.db.all<{ authorId: number | null }>("SELECT authorId FROM forum_posts"),
      this.db.all<{ authorId: number | null }>("SELECT authorId FROM forum_comments"),
      this.db.all<{ authorId: number | null }>("SELECT authorId FROM suggestion_comments"),
      this.db.all<{ authorId: number | null }>("SELECT authorId FROM suggestions"),
      this.ensureCurrentEvent(),
      this.db.all<MemberRow>(`SELECT ${MEMBER_COLS} FROM members ORDER BY name COLLATE NOCASE`),
    ]);
    const [equipment, expenses, attendance] = await Promise.all([
      this.db.all<{ bringerId: number | null }>("SELECT bringerId FROM equipment WHERE eventId = ? AND done = 1 AND bringerId IS NOT NULL", event.id),
      this.db.all<{ paidById: number }>("SELECT paidById FROM expenses WHERE eventId = ?", event.id),
      this.db.all<{ memberId: number }>("SELECT memberId FROM attendance WHERE eventId = ?", event.id),
    ]);
    const xpBy = groupBy(xp, x => x.memberId), partsBy = groupBy(parts, p => p.memberId), gamesBy = byId(games), sessionBy = byId(sessions);
    const count = (list: { [k: string]: any }[], key: string, id: number) => list.filter(x => x[key] === id).length;
    return rows.map(m => {
      const total = (xpBy.get(m.id) ?? []).reduce((a, x) => a + x.amount, 0);
      const lvl = levelForXp(total);
      const mySessions = (partsBy.get(m.id) ?? []).map(p => sessionBy.get(p.sessionId)).filter((s): s is SessionRow => !!s);
      const fav = [...groupBy(mySessions, s => s.gameId).entries()].sort((a, b) => b[1].length - a[1].length)[0];
      return {
        id: m.id, name: m.name, motto: m.motto, color: m.color, hasAvatar: bool(m.hasAvatar),
        avatarUrl: `/api/members/${m.id}/avatar?v=${m.avatarUpdatedAt ?? m.createdAt}`,
        xp: total, level: lvl.level, rank: lvl.rank, xpForCurrentLevel: lvl.xpForCurrentLevel, xpForNextLevel: lvl.xpForNextLevel, progress: lvl.progress,
        stats: {
          gamesPlayed: mySessions.length, forumPosts: count(posts, "authorId", m.id), comments: count(fComments, "authorId", m.id) + count(sComments, "authorId", m.id),
          suggestions: count(suggestions, "authorId", m.id), equipmentBrought: count(equipment, "bringerId", m.id), expensesPaid: count(expenses, "paidById", m.id),
          attendanceDays: count(attendance, "memberId", m.id), favoriteGame: fav ? gamesBy.get(fav[0])?.name ?? null : null,
        },
        createdAt: m.createdAt, isAdmin: bool(m.isAdmin),
      };
    });
  }
  async member(id: number) { const m = (await this.members()).find(x => x.id === id); if (!m) throw new NotFound("Mitglied nicht gefunden"); return m; }
  async authMembers() {
    return (await this.db.all<MemberRow>(`SELECT ${MEMBER_COLS} FROM members ORDER BY name COLLATE NOCASE`))
      .map(m => ({ id: m.id, name: m.name, color: m.color, hasAvatar: bool(m.hasAvatar), hasPassword: !!m.password, createdAt: m.avatarUpdatedAt ?? m.createdAt }));
  }
  async createMember(req: { name: string; motto?: string; color?: string | null }) {
    const name = (req.name ?? "").trim();
    if (!name) throw new BadRequest("Name fehlt");
    if (await this.db.first("SELECT id FROM members WHERE name = ? COLLATE NOCASE", name)) throw new BadRequest("Name ist bereits vergeben");
    const color = req.color && /^#[0-9a-fA-F]{6}$/.test(req.color) ? req.color : pick(PALETTE);
    const count = (await this.db.first<{ n: number }>("SELECT COUNT(*) AS n FROM members"))!.n;
    const id = await this.db.insert("INSERT INTO members (name, motto, color, createdAt, isAdmin) VALUES (?, ?, ?, ?, ?)", name, (req.motto ?? "").trim(), color, now(), count === 0 ? 1 : 0);
    return this.member(id);
  }
  async updateMember(id: number, req: { name: string; motto?: string; color?: string | null }) {
    const m = await this.db.first<MemberRow>("SELECT * FROM members WHERE id = ?", id);
    if (!m) throw new NotFound("Mitglied nicht gefunden");
    const name = (req.name ?? "").trim();
    if (!name) throw new BadRequest("Name fehlt");
    if (await this.db.first("SELECT id FROM members WHERE name = ? COLLATE NOCASE AND id != ?", name, id)) throw new BadRequest("Name ist bereits vergeben");
    const color = req.color && /^#[0-9a-fA-F]{6}$/.test(req.color) ? req.color : m.color;
    await this.db.run("UPDATE members SET name = ?, motto = ?, color = ? WHERE id = ?", name, (req.motto ?? "").trim(), color, id);
    return this.member(id);
  }
  async deleteMember(id: number) {
    await this.db.batch([{ sql: "DELETE FROM auth_tokens WHERE memberId = ?", params: [id] }, { sql: "DELETE FROM members WHERE id = ?", params: [id] }]);
  }
  async setAdmin(id: number, admin: boolean) {
    if (!(await this.db.first("SELECT id FROM members WHERE id = ?", id))) throw new NotFound("Mitglied nicht gefunden");
    if (!admin) {
      const admins = (await this.db.first<{ n: number }>("SELECT COUNT(*) AS n FROM members WHERE isAdmin = 1"))!.n;
      const isAdmin = (await this.db.first<{ isAdmin: number }>("SELECT isAdmin FROM members WHERE id = ?", id))!.isAdmin;
      if (bool(isAdmin) && admins <= 1) throw new BadRequest("Der letzte Admin kann nicht entfernt werden");
    }
    await this.db.run("UPDATE members SET isAdmin = ? WHERE id = ?", admin ? 1 : 0, id);
    return this.member(id);
  }
  async setAvatar(id: number, bytes: ArrayBuffer) {
    if (!(await this.db.first("SELECT id FROM members WHERE id = ?", id))) throw new NotFound("Mitglied nicht gefunden");
    await this.db.run("UPDATE members SET avatar = ?, hasAvatar = 1, avatarUpdatedAt = ? WHERE id = ?", bytes, now(), id);
  }
  async avatar(id: number): Promise<Uint8Array | null> {
    const r = await this.db.first<{ avatar: ArrayBuffer | number[] | null }>("SELECT avatar FROM members WHERE id = ?", id);
    return r?.avatar ? toBytes(r.avatar) : null;
  }
  async xpLog(memberId: number) {
    return (await this.db.all<{ type: string; amount: number; createdAt: number }>("SELECT type, amount, createdAt FROM xp_log WHERE memberId = ? ORDER BY createdAt DESC", memberId))
      .map(x => ({ type: x.type, label: xpLabel(x.type), amount: x.amount, createdAt: x.createdAt }));
  }
  private async grantXp(memberId: number | null | undefined, type: string, refId: number) {
    if (memberId == null) return;
    if (!(await this.db.first("SELECT id FROM members WHERE id = ?", memberId))) return;
    await this.db.run("INSERT OR IGNORE INTO xp_log (memberId, type, refId, amount, createdAt) VALUES (?, ?, ?, ?, ?)", memberId, type, refId, xpAmount(type), now());
  }
  private async requireMember(id: number | null | undefined): Promise<MemberRow> {
    const m = id != null ? await this.db.first<MemberRow>("SELECT * FROM members WHERE id = ?", id) : null;
    if (!m) throw new BadRequest("Bitte zuerst ein Profil wählen");
    return m;
  }

  // ================================================================ Games
  async games() {
    const [event, sessions, members, rows] = await Promise.all([
      this.ensureCurrentEvent(), this.db.all<SessionRow>("SELECT * FROM sessions"),
      this.db.all<MemberRow>("SELECT id, name FROM members"), this.db.all<GameRow>("SELECT * FROM games ORDER BY name COLLATE NOCASE"),
    ]);
    const sBy = groupBy(sessions, s => s.gameId), mBy = byId(members);
    return rows.map(g => {
      const s = sBy.get(g.id) ?? [];
      return {
        id: g.id, name: g.name, description: g.description, steamUrl: g.steamUrl, steamAppId: g.steamAppId, imageUrl: g.imageUrl, players: g.players,
        addedById: g.addedById, addedByName: g.addedById != null ? mBy.get(g.addedById)?.name ?? null : null,
        selectedForNext: bool(g.selectedForNext), timesPlayed: s.length, playedThisEvent: s.some(x => x.eventId === event.id),
        lastPlayedAt: s.length ? Math.max(...s.map(x => x.startedAt)) : null, createdAt: g.createdAt, sharePath: g.sharePath,
      };
    });
  }
  private normalizeSteamUrl = (url: string | undefined, appId: number | null | undefined) => (url ?? "").trim() || (appId ? `https://store.steampowered.com/app/${appId}/` : "");
  async createGame(req: { name: string; description?: string; steamUrl?: string; steamAppId?: number | null; imageUrl?: string; players?: string }, actorId: number | null) {
    if (!req.name?.trim()) throw new BadRequest("Name fehlt");
    const id = await this.db.insert(
      "INSERT INTO games (name, description, steamUrl, steamAppId, imageUrl, players, addedById, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      req.name.trim(), (req.description ?? "").trim(), this.normalizeSteamUrl(req.steamUrl, req.steamAppId), req.steamAppId ?? null, (req.imageUrl ?? "").trim(), (req.players ?? "").trim(), actorId, now(),
    );
    await this.grantXp(actorId, XP.GAME_ADDED, id);
    return (await this.games()).find(g => g.id === id)!;
  }
  async updateGame(id: number, req: { name: string; description?: string; steamUrl?: string; steamAppId?: number | null; imageUrl?: string; players?: string }) {
    if (!(await this.db.first("SELECT id FROM games WHERE id = ?", id))) throw new NotFound("Spiel nicht gefunden");
    if (!req.name?.trim()) throw new BadRequest("Name fehlt");
    await this.db.run("UPDATE games SET name = ?, description = ?, steamUrl = ?, steamAppId = ?, imageUrl = ?, players = ? WHERE id = ?",
      req.name.trim(), (req.description ?? "").trim(), this.normalizeSteamUrl(req.steamUrl, req.steamAppId), req.steamAppId ?? null, (req.imageUrl ?? "").trim(), (req.players ?? "").trim(), id);
    return (await this.games()).find(g => g.id === id)!;
  }
  async deleteGame(id: number) {
    await this.db.batch([{ sql: "DELETE FROM games WHERE id = ?", params: [id] }, { sql: "DELETE FROM xp_log WHERE type = ? AND refId = ?", params: [XP.GAME_ADDED, id] }]);
  }
  async selectGame(id: number, selected: boolean) {
    if (!(await this.db.first("SELECT id FROM games WHERE id = ?", id))) throw new NotFound("Spiel nicht gefunden");
    await this.db.run("UPDATE games SET selectedForNext = ? WHERE id = ?", selected ? 1 : 0, id);
  }

  // ================================================================ Sessions
  async sessions(eventId: number | null) {
    const [list, games, members, parts] = await Promise.all([
      eventId == null ? this.db.all<SessionRow>("SELECT * FROM sessions ORDER BY startedAt DESC") : this.db.all<SessionRow>("SELECT * FROM sessions WHERE eventId = ? ORDER BY startedAt DESC", eventId),
      this.db.all<GameRow>("SELECT id, name, imageUrl FROM games"), this.db.all<MemberRow>("SELECT id, name, color, hasAvatar FROM members"),
      this.db.all<{ sessionId: number; memberId: number }>("SELECT * FROM session_participants"),
    ]);
    const gBy = byId(games), mBy = byId(members), pBy = groupBy(parts, p => p.sessionId);
    return list.map(s => {
      const g = gBy.get(s.gameId);
      return {
        id: s.id, gameId: s.gameId, gameName: g?.name ?? "Gelöschtes Spiel", imageUrl: g?.imageUrl ?? "", eventId: s.eventId, startedAt: s.startedAt, endedAt: s.endedAt,
        chosenBy: s.chosenBy, note: s.note,
        participants: (pBy.get(s.id) ?? []).flatMap(p => { const m = mBy.get(p.memberId); return m ? [{ id: m.id, name: m.name, color: m.color, hasAvatar: bool(m.hasAvatar) }] : []; }),
      };
    });
  }
  async startSession(req: { gameId: number; participantIds?: number[]; chosenBy?: string; note?: string }) {
    if (!(await this.db.first("SELECT id FROM games WHERE id = ?", req.gameId))) throw new NotFound("Spiel nicht gefunden");
    const event = await this.ensureCurrentEvent();
    const id = await this.db.insert("INSERT INTO sessions (gameId, eventId, startedAt, chosenBy, note) VALUES (?, ?, ?, ?, ?)", req.gameId, event.id, now(), req.chosenBy ?? "manual", (req.note ?? "").trim());
    await this.setParticipants(id, req.participantIds ?? []);
    await this.db.run("UPDATE games SET selectedForNext = 0 WHERE id = ?", req.gameId);
    return (await this.sessions(null)).find(s => s.id === id)!;
  }
  async updateSession(id: number, participantIds: number[], note: string) {
    if (!(await this.db.first("SELECT id FROM sessions WHERE id = ?", id))) throw new NotFound("Runde nicht gefunden");
    await this.db.run("UPDATE sessions SET note = ? WHERE id = ?", (note ?? "").trim(), id);
    await this.setParticipants(id, participantIds ?? []);
    return (await this.sessions(null)).find(s => s.id === id)!;
  }
  private async setParticipants(sessionId: number, ids: number[]) {
    const existing = new Set((await this.db.all<{ id: number }>("SELECT id FROM members")).map(m => m.id));
    const valid = [...new Set(ids)].filter(id => existing.has(id));
    await this.db.batch([
      { sql: "DELETE FROM session_participants WHERE sessionId = ?", params: [sessionId] },
      { sql: "DELETE FROM xp_log WHERE type = ? AND refId = ?", params: [XP.GAME_PLAYED, sessionId] },
      ...valid.map(m => ({ sql: "INSERT OR IGNORE INTO session_participants (sessionId, memberId) VALUES (?, ?)", params: [sessionId, m] })),
      ...valid.map(m => ({ sql: "INSERT OR IGNORE INTO xp_log (memberId, type, refId, amount, createdAt) VALUES (?, ?, ?, ?, ?)", params: [m, XP.GAME_PLAYED, sessionId, xpAmount(XP.GAME_PLAYED), now()] })),
    ]);
  }
  async endSession(id: number) {
    const s = await this.db.first<SessionRow>("SELECT * FROM sessions WHERE id = ?", id);
    if (!s) throw new NotFound("Runde nicht gefunden");
    if (s.endedAt == null) await this.db.run("UPDATE sessions SET endedAt = ? WHERE id = ?", now(), id);
    return (await this.sessions(null)).find(x => x.id === id)!;
  }
  async deleteSession(id: number) {
    await this.db.batch([
      { sql: "DELETE FROM session_participants WHERE sessionId = ?", params: [id] },
      { sql: "DELETE FROM xp_log WHERE type = ? AND refId = ?", params: [XP.GAME_PLAYED, id] },
      { sql: "DELETE FROM sessions WHERE id = ?", params: [id] },
    ]);
  }

  // ================================================================ Glücksrad
  async spin(excludePlayed: boolean, onlySelected: boolean, actorId: number | null) {
    const event = await this.ensureCurrentEvent();
    const all = await this.db.all<GameRow>("SELECT * FROM games ORDER BY name COLLATE NOCASE");
    const played = excludePlayed ? new Set((await this.db.all<{ gameId: number }>("SELECT DISTINCT gameId FROM sessions WHERE eventId = ?", event.id)).map(x => x.gameId)) : new Set<number>();
    let candidates = all.filter(g => !played.has(g.id));
    if (onlySelected && candidates.some(g => bool(g.selectedForNext))) candidates = candidates.filter(g => bool(g.selectedForNext));
    if (!candidates.length) throw new BadRequest("Keine Spiele für das Rad verfügbar");
    const winner = pick(candidates);
    const by = actorId != null ? await this.db.first<{ name: string }>("SELECT name FROM members WHERE id = ?", actorId) : null;
    const spin = { spinId: now(), gameIds: candidates.map(g => g.id), winnerGameId: winner.id, durationMs: 6500 + Math.floor(Math.random() * 2000), turns: 5 + Math.random() * 3, startedAt: now(), startedByName: by?.name ?? null };
    await this.db.setSetting("lastSpin", JSON.stringify(spin));
    return spin;
  }
  async lastSpin() { const s = await this.db.setting("lastSpin"); return s ? JSON.parse(s) : null; }

  // ================================================================ Abstimmung
  private async pollDto(p: PollRow) {
    const [members, votes] = await Promise.all([this.db.all<MemberRow>("SELECT id, name FROM members"), this.db.all<{ memberId: number; gameId: number }>("SELECT memberId, gameId FROM poll_votes WHERE pollId = ?", p.id)]);
    const mBy = byId(members);
    return { id: p.id, open: bool(p.open), winnerGameId: p.winnerGameId, votes: votes.map(v => ({ memberId: v.memberId, memberName: mBy.get(v.memberId)?.name ?? "?", gameId: v.gameId })), createdAt: p.createdAt, closedAt: p.closedAt };
  }
  async currentPoll() {
    const event = await this.ensureCurrentEvent();
    const p = await this.db.first<PollRow>("SELECT * FROM polls WHERE eventId = ? ORDER BY createdAt DESC LIMIT 1", event.id);
    return p ? this.pollDto(p) : null;
  }
  async openPoll() {
    const event = await this.ensureCurrentEvent();
    const latest = await this.db.first<PollRow>("SELECT * FROM polls WHERE eventId = ? ORDER BY createdAt DESC LIMIT 1", event.id);
    if (latest && bool(latest.open)) return this.pollDto(latest);
    const id = await this.db.insert("INSERT INTO polls (eventId, open, createdAt) VALUES (?, 1, ?)", event.id, now());
    return this.pollDto((await this.db.first<PollRow>("SELECT * FROM polls WHERE id = ?", id))!);
  }
  async votePoll(pollId: number, memberId: number | null, gameId: number) {
    const p = await this.db.first<PollRow>("SELECT * FROM polls WHERE id = ?", pollId);
    if (!p) throw new NotFound("Abstimmung nicht gefunden");
    if (!bool(p.open)) throw new BadRequest("Abstimmung ist beendet");
    const m = await this.requireMember(memberId);
    if (!(await this.db.first("SELECT id FROM games WHERE id = ?", gameId))) throw new NotFound("Spiel nicht gefunden");
    await this.db.run("INSERT INTO poll_votes (pollId, memberId, gameId) VALUES (?, ?, ?) ON CONFLICT(pollId, memberId) DO UPDATE SET gameId = excluded.gameId", pollId, m.id, gameId);
    await this.grantXp(m.id, XP.VOTE, pollId);
    return this.pollDto(p);
  }
  async closePoll(pollId: number) {
    const p = await this.db.first<PollRow>("SELECT * FROM polls WHERE id = ?", pollId);
    if (!p) throw new NotFound("Abstimmung nicht gefunden");
    if (!bool(p.open)) return this.pollDto(p);
    const votes = await this.db.all<{ gameId: number }>("SELECT gameId FROM poll_votes WHERE pollId = ?", pollId);
    const counts = new Map<number, number>(); votes.forEach(v => counts.set(v.gameId, (counts.get(v.gameId) ?? 0) + 1));
    const max = Math.max(0, ...counts.values());
    const winners = [...counts.entries()].filter(([, n]) => n === max).map(([g]) => g);
    const winner = winners.length ? pick(winners) : null;
    await this.db.run("UPDATE polls SET open = 0, winnerGameId = ?, closedAt = ? WHERE id = ?", winner, now(), pollId);
    return this.pollDto((await this.db.first<PollRow>("SELECT * FROM polls WHERE id = ?", pollId))!);
  }

  // ================================================================ Vorschläge
  private commentDto = (c: CommentRow, a: MemberRow | undefined) => ({ id: c.id, authorId: c.authorId, authorName: a?.name ?? "Unbekannt", authorColor: a?.color ?? "#777777", authorHasAvatar: a ? bool(a.hasAvatar) : false, text: c.text, createdAt: c.createdAt });
  async suggestions(viewerId: number | null) {
    const [members, votes, comments, rows] = await Promise.all([
      this.db.all<MemberRow>("SELECT id, name, color, hasAvatar FROM members"),
      this.db.all<{ suggestionId: number; memberId: number; value: number }>("SELECT * FROM suggestion_votes"),
      this.db.all<CommentRow>("SELECT id, suggestionId AS parentId, authorId, text, createdAt FROM suggestion_comments ORDER BY createdAt ASC"),
      this.db.all<SuggestionRow>("SELECT * FROM suggestions ORDER BY createdAt DESC"),
    ]);
    const mBy = byId(members), vBy = groupBy(votes, v => v.suggestionId), cBy = groupBy(comments, c => c.parentId);
    return rows.map(s => {
      const v = vBy.get(s.id) ?? [], a = s.authorId != null ? mBy.get(s.authorId) : undefined;
      return {
        id: s.id, scope: s.scope, title: s.title, description: s.description, steamUrl: s.steamUrl, steamAppId: s.steamAppId, imageUrl: s.imageUrl,
        authorId: s.authorId, authorName: a?.name ?? "Unbekannt", authorColor: a?.color ?? "#777777", authorHasAvatar: a ? bool(a.hasAvatar) : false,
        score: v.reduce((x, y) => x + y.value, 0), upvotes: v.filter(x => x.value > 0).length, downvotes: v.filter(x => x.value < 0).length,
        myVote: v.find(x => x.memberId === viewerId)?.value ?? 0, adoptedGameId: s.adoptedGameId,
        comments: (cBy.get(s.id) ?? []).map(c => this.commentDto(c, c.authorId != null ? mBy.get(c.authorId) : undefined)), createdAt: s.createdAt,
      };
    });
  }
  async createSuggestion(req: { scope: string; title: string; description?: string; steamUrl?: string; steamAppId?: number | null; imageUrl?: string }, actorId: number | null) {
    const m = await this.requireMember(actorId);
    if (!req.title?.trim()) throw new BadRequest("Titel fehlt");
    const id = await this.db.insert("INSERT INTO suggestions (scope, title, description, steamUrl, steamAppId, imageUrl, authorId, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      req.scope === "next" ? "next" : "current", req.title.trim(), (req.description ?? "").trim(), this.normalizeSteamUrl(req.steamUrl, req.steamAppId), req.steamAppId ?? null, (req.imageUrl ?? "").trim(), m.id, now());
    await this.grantXp(m.id, XP.SUGGESTION_CREATED, id);
    return (await this.suggestions(actorId)).find(s => s.id === id)!;
  }
  async updateSuggestion(id: number, req: { scope: string; title: string; description?: string; steamUrl?: string; steamAppId?: number | null; imageUrl?: string }, actorId: number | null) {
    if (!(await this.db.first("SELECT id FROM suggestions WHERE id = ?", id))) throw new NotFound("Vorschlag nicht gefunden");
    if (!req.title?.trim()) throw new BadRequest("Titel fehlt");
    await this.db.run("UPDATE suggestions SET scope = ?, title = ?, description = ?, steamUrl = ?, steamAppId = ?, imageUrl = ? WHERE id = ?",
      req.scope === "next" ? "next" : "current", req.title.trim(), (req.description ?? "").trim(), this.normalizeSteamUrl(req.steamUrl, req.steamAppId), req.steamAppId ?? null, (req.imageUrl ?? "").trim(), id);
    return (await this.suggestions(actorId)).find(s => s.id === id)!;
  }
  async deleteSuggestion(id: number) {
    await this.db.batch([
      { sql: "DELETE FROM suggestions WHERE id = ?", params: [id] }, { sql: "DELETE FROM suggestion_votes WHERE suggestionId = ?", params: [id] },
      { sql: "DELETE FROM suggestion_comments WHERE suggestionId = ?", params: [id] },
      { sql: "DELETE FROM xp_log WHERE type = ? AND refId = ?", params: [XP.SUGGESTION_CREATED, id] }, { sql: "DELETE FROM xp_log WHERE type = ? AND refId = ?", params: [XP.SUGGESTION_ADOPTED, id] },
    ]);
  }
  async voteSuggestion(id: number, actorId: number | null, value: number) {
    if (!(await this.db.first("SELECT id FROM suggestions WHERE id = ?", id))) throw new NotFound("Vorschlag nicht gefunden");
    const m = await this.requireMember(actorId);
    if (!value) await this.db.run("DELETE FROM suggestion_votes WHERE suggestionId = ? AND memberId = ?", id, m.id);
    else await this.db.run("INSERT INTO suggestion_votes (suggestionId, memberId, value) VALUES (?, ?, ?) ON CONFLICT(suggestionId, memberId) DO UPDATE SET value = excluded.value", id, m.id, Math.max(-1, Math.min(1, value)));
  }
  async commentSuggestion(id: number, actorId: number | null, text: string) {
    if (!(await this.db.first("SELECT id FROM suggestions WHERE id = ?", id))) throw new NotFound("Vorschlag nicht gefunden");
    const m = await this.requireMember(actorId);
    if (!text?.trim()) throw new BadRequest("Kommentar ist leer");
    const cid = await this.db.insert("INSERT INTO suggestion_comments (suggestionId, authorId, text, createdAt) VALUES (?, ?, ?, ?)", id, m.id, text.trim(), now());
    await this.grantXp(m.id, XP.SUGGESTION_COMMENT, cid);
  }
  async deleteSuggestionComment(id: number) {
    await this.db.batch([{ sql: "DELETE FROM suggestion_comments WHERE id = ?", params: [id] }, { sql: "DELETE FROM xp_log WHERE type = ? AND refId = ?", params: [XP.SUGGESTION_COMMENT, id] }]);
  }
  async adoptSuggestion(id: number, actorId: number | null) {
    const s = await this.db.first<SuggestionRow>("SELECT * FROM suggestions WHERE id = ?", id);
    if (!s) throw new NotFound("Vorschlag nicht gefunden");
    if (s.adoptedGameId != null) { const g = (await this.games()).find(x => x.id === s.adoptedGameId); if (g) return g; }
    const game = await this.createGame({ name: s.title, description: s.description, steamUrl: s.steamUrl, steamAppId: s.steamAppId, imageUrl: s.imageUrl }, actorId);
    await this.db.run("UPDATE suggestions SET adoptedGameId = ? WHERE id = ?", game.id, id);
    await this.grantXp(s.authorId, XP.SUGGESTION_ADOPTED, id);
    return game;
  }

  // ================================================================ Forum
  async forum() {
    const [members, comments, posts] = await Promise.all([
      this.db.all<MemberRow>("SELECT id, name, color, hasAvatar FROM members"),
      this.db.all<CommentRow>("SELECT id, postId AS parentId, authorId, body AS text, createdAt FROM forum_comments ORDER BY createdAt ASC"),
      this.db.all<ForumPostRow>("SELECT * FROM forum_posts ORDER BY pinned DESC, createdAt DESC"),
    ]);
    const mBy = byId(members), cBy = groupBy(comments, c => c.parentId);
    return posts.map(p => {
      const a = p.authorId != null ? mBy.get(p.authorId) : undefined;
      return {
        id: p.id, authorId: p.authorId, authorName: a?.name ?? "Unbekannt", authorColor: a?.color ?? "#777777", authorHasAvatar: a ? bool(a.hasAvatar) : false,
        title: p.title, body: p.body, pinned: bool(p.pinned), comments: (cBy.get(p.id) ?? []).map(c => this.commentDto(c, c.authorId != null ? mBy.get(c.authorId) : undefined)), createdAt: p.createdAt,
      };
    });
  }
  async createPost(req: { title: string; body: string; pinned?: boolean }, actorId: number | null) {
    const m = await this.requireMember(actorId);
    if (!req.title?.trim() && !req.body?.trim()) throw new BadRequest("Beitrag ist leer");
    const id = await this.db.insert("INSERT INTO forum_posts (authorId, title, body, pinned, createdAt) VALUES (?, ?, ?, ?, ?)", m.id, (req.title ?? "").trim(), (req.body ?? "").trim(), req.pinned ? 1 : 0, now());
    await this.grantXp(m.id, XP.FORUM_POST, id);
    return (await this.forum()).find(p => p.id === id)!;
  }
  async updatePost(id: number, req: { title: string; body: string; pinned?: boolean }) {
    if (!(await this.db.first("SELECT id FROM forum_posts WHERE id = ?", id))) throw new NotFound("Beitrag nicht gefunden");
    await this.db.run("UPDATE forum_posts SET title = ?, body = ?, pinned = ? WHERE id = ?", (req.title ?? "").trim(), (req.body ?? "").trim(), req.pinned ? 1 : 0, id);
    return (await this.forum()).find(p => p.id === id)!;
  }
  async deletePost(id: number) {
    await this.db.batch([{ sql: "DELETE FROM forum_comments WHERE postId = ?", params: [id] }, { sql: "DELETE FROM forum_posts WHERE id = ?", params: [id] }, { sql: "DELETE FROM xp_log WHERE type = ? AND refId = ?", params: [XP.FORUM_POST, id] }]);
  }
  async commentPost(postId: number, actorId: number | null, body: string) {
    if (!(await this.db.first("SELECT id FROM forum_posts WHERE id = ?", postId))) throw new NotFound("Beitrag nicht gefunden");
    const m = await this.requireMember(actorId);
    if (!body?.trim()) throw new BadRequest("Kommentar ist leer");
    const id = await this.db.insert("INSERT INTO forum_comments (postId, authorId, body, createdAt) VALUES (?, ?, ?, ?)", postId, m.id, body.trim(), now());
    await this.grantXp(m.id, XP.FORUM_COMMENT, id);
  }
  async deleteForumComment(id: number) {
    await this.db.batch([{ sql: "DELETE FROM forum_comments WHERE id = ?", params: [id] }, { sql: "DELETE FROM xp_log WHERE type = ? AND refId = ?", params: [XP.FORUM_COMMENT, id] }]);
  }

  // ================================================================ Kosten
  async costs(eventId: number | null) {
    const event = await this.eventOrCurrent(eventId);
    const [members, attendanceRows, shareRows, expenses, payments] = await Promise.all([
      this.db.all<MemberRow>("SELECT id, name FROM members"),
      this.db.all<{ memberId: number; day: number }>("SELECT memberId, day FROM attendance WHERE eventId = ?", event.id),
      this.db.all<{ expenseId: number; memberId: number }>("SELECT * FROM expense_shares"),
      this.db.all<ExpenseRow>("SELECT * FROM expenses WHERE eventId = ? ORDER BY createdAt DESC", event.id),
      this.db.all<{ id: number; fromId: number; toId: number; amountCents: number; createdAt: number }>("SELECT * FROM payments WHERE eventId = ? ORDER BY createdAt DESC", event.id),
    ]);
    const memberIds = members.map(m => m.id), mBy = byId(members);
    const attendance = new Map<number, Set<number>>();
    attendanceRows.forEach(a => (attendance.get(a.memberId) ?? attendance.set(a.memberId, new Set()).get(a.memberId)!).add(a.day));
    const sBy = groupBy(shareRows, s => s.expenseId);
    const inputs: ExpenseInput[] = expenses.map(e => ({ id: e.id, amountCents: e.amountCents, paidById: e.paidById, day: e.day, explicitParticipants: (sBy.get(e.id) ?? []).map(s => s.memberId) }));
    const summary = summarizeCosts(memberIds, inputs, payments, attendance);
    return {
      eventId: event.id, days: event.days,
      attendance: Object.fromEntries([...attendance.entries()].map(([id, days]) => [id, [...days].sort((a, b) => a - b)])),
      expenses: expenses.map(e => ({
        id: e.id, eventId: e.eventId, title: e.title, amountCents: e.amountCents, paidById: e.paidById, paidByName: mBy.get(e.paidById)?.name ?? "Unbekannt", day: e.day, note: e.note,
        participantIds: (sBy.get(e.id) ?? []).map(s => s.memberId), shares: (summary.shares.get(e.id) ?? []).map(s => ({ memberId: s.memberId, cents: s.cents })), createdAt: e.createdAt,
      })),
      payments: payments.map(p => ({ id: p.id, fromId: p.fromId, toId: p.toId, amountCents: p.amountCents, createdAt: p.createdAt })),
      balances: summary.balances.filter(b => mBy.has(b.memberId)).map(b => ({ memberId: b.memberId, paidCents: b.paidCents, owedCents: b.owedCents, netCents: b.netCents })),
      transfers: summary.transfers, totalCents: summary.totalCents,
    };
  }
  async setAttendance(eventId: number | null, req: { memberId: number; days: number[] }) {
    const event = await this.eventOrCurrent(eventId);
    if (!(await this.db.first("SELECT id FROM members WHERE id = ?", req.memberId))) throw new NotFound("Mitglied nicht gefunden");
    const days = [...new Set((req.days ?? []).filter(d => d >= 1 && d <= event.days))];
    const stmts = [{ sql: "DELETE FROM attendance WHERE eventId = ? AND memberId = ?", params: [event.id, req.memberId] as unknown[] }];
    for (let d = 1; d <= event.days; d++) stmts.push({ sql: "DELETE FROM xp_log WHERE type = ? AND refId = ? AND memberId = ?", params: [XP.ATTENDANCE, event.id * 100 + d, req.memberId] });
    for (const d of days) {
      stmts.push({ sql: "INSERT OR IGNORE INTO attendance (eventId, memberId, day) VALUES (?, ?, ?)", params: [event.id, req.memberId, d] });
      stmts.push({ sql: "INSERT OR IGNORE INTO xp_log (memberId, type, refId, amount, createdAt) VALUES (?, ?, ?, ?, ?)", params: [req.memberId, XP.ATTENDANCE, event.id * 100 + d, xpAmount(XP.ATTENDANCE), now()] });
    }
    await this.db.batch(stmts);
  }
  private async validateExpense(req: { title: string; amountCents: number; paidById: number; day?: number | null }, event: EventRow) {
    if (!req.title?.trim()) throw new BadRequest("Bezeichnung fehlt");
    if (!(req.amountCents > 0)) throw new BadRequest("Betrag muss größer als 0 sein");
    if (!(await this.db.first("SELECT id FROM members WHERE id = ?", req.paidById))) throw new BadRequest("Zahler nicht gefunden");
    if (req.day != null && (req.day < 1 || req.day > event.days)) throw new BadRequest("Ungültiger Tag");
  }
  async createExpense(eventId: number | null, req: { title: string; amountCents: number; paidById: number; day?: number | null; note?: string; participantIds?: number[] }) {
    const event = await this.eventOrCurrent(eventId);
    await this.validateExpense(req, event);
    const id = await this.db.insert("INSERT INTO expenses (eventId, title, amountCents, paidById, day, note, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)", event.id, req.title.trim(), Math.round(req.amountCents), req.paidById, req.day ?? null, (req.note ?? "").trim(), now());
    await this.db.batch([...new Set(req.participantIds ?? [])].map(m => ({ sql: "INSERT OR IGNORE INTO expense_shares (expenseId, memberId) VALUES (?, ?)", params: [id, m] })));
    await this.grantXp(req.paidById, XP.EXPENSE_PAID, id);
    return (await this.costs(event.id)).expenses.find(e => e.id === id)!;
  }
  async updateExpense(id: number, req: { title: string; amountCents: number; paidById: number; day?: number | null; note?: string; participantIds?: number[] }) {
    const e = await this.db.first<ExpenseRow>("SELECT * FROM expenses WHERE id = ?", id);
    if (!e) throw new NotFound("Einkauf nicht gefunden");
    const event = await this.eventOrCurrent(e.eventId);
    await this.validateExpense(req, event);
    await this.db.batch([
      { sql: "UPDATE expenses SET title = ?, amountCents = ?, paidById = ?, day = ?, note = ? WHERE id = ?", params: [req.title.trim(), Math.round(req.amountCents), req.paidById, req.day ?? null, (req.note ?? "").trim(), id] },
      { sql: "DELETE FROM expense_shares WHERE expenseId = ?", params: [id] },
      ...[...new Set(req.participantIds ?? [])].map(m => ({ sql: "INSERT OR IGNORE INTO expense_shares (expenseId, memberId) VALUES (?, ?)", params: [id, m] })),
      { sql: "DELETE FROM xp_log WHERE type = ? AND refId = ?", params: [XP.EXPENSE_PAID, id] },
    ]);
    await this.grantXp(req.paidById, XP.EXPENSE_PAID, id);
    return (await this.costs(event.id)).expenses.find(x => x.id === id)!;
  }
  async deleteExpense(id: number) {
    await this.db.batch([{ sql: "DELETE FROM expense_shares WHERE expenseId = ?", params: [id] }, { sql: "DELETE FROM expenses WHERE id = ?", params: [id] }, { sql: "DELETE FROM xp_log WHERE type = ? AND refId = ?", params: [XP.EXPENSE_PAID, id] }]);
  }
  async createPayment(eventId: number | null, req: { fromId: number; toId: number; amountCents: number }) {
    const event = await this.eventOrCurrent(eventId);
    if (!(req.amountCents > 0)) throw new BadRequest("Betrag muss größer als 0 sein");
    if (req.fromId === req.toId) throw new BadRequest("Zahler und Empfänger sind identisch");
    if (!(await this.db.first("SELECT id FROM members WHERE id = ?", req.fromId))) throw new BadRequest("Zahler nicht gefunden");
    if (!(await this.db.first("SELECT id FROM members WHERE id = ?", req.toId))) throw new BadRequest("Empfänger nicht gefunden");
    const id = await this.db.insert("INSERT INTO payments (eventId, fromId, toId, amountCents, createdAt) VALUES (?, ?, ?, ?, ?)", event.id, req.fromId, req.toId, Math.round(req.amountCents), now());
    return (await this.costs(event.id)).payments.find(p => p.id === id)!;
  }
  async deletePayment(id: number) { await this.db.run("DELETE FROM payments WHERE id = ?", id); }

  // ================================================================ Ausrüstung
  private equipmentDto = (e: EquipmentRow, bringerName: string | null) => ({ id: e.id, eventId: e.eventId, name: e.name, category: e.category, quantity: e.quantity, note: e.note, bringerId: e.bringerId, bringerName, done: bool(e.done), createdAt: e.createdAt });
  async equipment(eventId: number | null) {
    const event = await this.eventOrCurrent(eventId);
    const [members, rows] = await Promise.all([this.db.all<MemberRow>("SELECT id, name FROM members"), this.db.all<EquipmentRow>("SELECT * FROM equipment WHERE eventId = ? ORDER BY category, name COLLATE NOCASE", event.id)]);
    const mBy = byId(members);
    return rows.map(e => this.equipmentDto(e, e.bringerId != null ? mBy.get(e.bringerId)?.name ?? null : null));
  }
  async createEquipment(eventId: number | null, req: { name: string; category?: string; quantity?: number; note?: string }) {
    const event = await this.eventOrCurrent(eventId);
    if (!req.name?.trim()) throw new BadRequest("Bezeichnung fehlt");
    const id = await this.db.insert("INSERT INTO equipment (eventId, name, category, quantity, note, createdAt) VALUES (?, ?, ?, ?, ?, ?)", event.id, req.name.trim(), (req.category ?? "").trim() || "Sonstiges", Math.max(1, req.quantity ?? 1), (req.note ?? "").trim(), now());
    return (await this.equipment(event.id)).find(e => e.id === id)!;
  }
  async updateEquipment(id: number, req: { name: string; category?: string; quantity?: number; note?: string }) {
    const e = await this.db.first<EquipmentRow>("SELECT * FROM equipment WHERE id = ?", id);
    if (!e) throw new NotFound("Gegenstand nicht gefunden");
    if (!req.name?.trim()) throw new BadRequest("Bezeichnung fehlt");
    await this.db.run("UPDATE equipment SET name = ?, category = ?, quantity = ?, note = ? WHERE id = ?", req.name.trim(), (req.category ?? "").trim() || "Sonstiges", Math.max(1, req.quantity ?? 1), (req.note ?? "").trim(), id);
    return (await this.equipment(e.eventId)).find(x => x.id === id)!;
  }
  async deleteEquipment(id: number) {
    await this.db.batch([{ sql: "DELETE FROM equipment WHERE id = ?", params: [id] }, { sql: "DELETE FROM xp_log WHERE type = ? AND refId = ?", params: [XP.EQUIPMENT_BROUGHT, id] }]);
  }
  async claimEquipment(id: number, memberId: number | null) {
    const e = await this.db.first<EquipmentRow>("SELECT * FROM equipment WHERE id = ?", id);
    if (!e) throw new NotFound("Gegenstand nicht gefunden");
    if (memberId != null && !(await this.db.first("SELECT id FROM members WHERE id = ?", memberId))) throw new NotFound("Mitglied nicht gefunden");
    await this.db.batch([
      { sql: "UPDATE equipment SET bringerId = ?, done = ? WHERE id = ?", params: [memberId, memberId == null ? 0 : e.done, id] },
      { sql: "DELETE FROM xp_log WHERE type = ? AND refId = ?", params: [XP.EQUIPMENT_BROUGHT, id] },
    ]);
    if (memberId != null && bool(e.done)) await this.grantXp(memberId, XP.EQUIPMENT_BROUGHT, id);
    return (await this.equipment(e.eventId)).find(x => x.id === id)!;
  }
  async setEquipmentDone(id: number, done: boolean) {
    const e = await this.db.first<EquipmentRow>("SELECT * FROM equipment WHERE id = ?", id);
    if (!e) throw new NotFound("Gegenstand nicht gefunden");
    await this.db.batch([{ sql: "UPDATE equipment SET done = ? WHERE id = ?", params: [done ? 1 : 0, id] }, { sql: "DELETE FROM xp_log WHERE type = ? AND refId = ?", params: [XP.EQUIPMENT_BROUGHT, id] }]);
    if (done) await this.grantXp(e.bringerId, XP.EQUIPMENT_BROUGHT, id);
    return (await this.equipment(e.eventId)).find(x => x.id === id)!;
  }
  async applyEquipmentTemplate(fromEventId: number | null) {
    const target = await this.ensureCurrentEvent();
    const source = fromEventId ? await this.db.first<EventRow>("SELECT * FROM events WHERE id = ?", fromEventId) : await this.db.first<EventRow>("SELECT * FROM events WHERE id != ? ORDER BY startDate DESC, id DESC LIMIT 1", target.id);
    if (!source) throw new BadRequest("Keine frühere LAN-Party vorhanden");
    if (source.id === target.id) throw new BadRequest("Quelle und Ziel sind identisch");
    return this.copyEquipment(source.id, target.id);
  }
  private async copyEquipment(fromEventId: number, toEventId: number) {
    const existing = new Set((await this.db.all<EquipmentRow>("SELECT name, category FROM equipment WHERE eventId = ?", toEventId)).map(e => `${e.name.toLowerCase()}|${e.category.toLowerCase()}`));
    const items = (await this.db.all<EquipmentRow>("SELECT * FROM equipment WHERE eventId = ?", fromEventId)).filter(e => !existing.has(`${e.name.toLowerCase()}|${e.category.toLowerCase()}`));
    await this.db.batch(items.map(e => ({ sql: "INSERT INTO equipment (eventId, name, category, quantity, note, bringerId, done, createdAt) VALUES (?, ?, ?, ?, ?, ?, 0, ?)", params: [toEventId, e.name, e.category, e.quantity, e.note, e.bringerId, now()] })));
    return items.length;
  }
  async seedDefaultEquipmentIfEmpty() {
    const event = await this.ensureCurrentEvent();
    const n = (await this.db.first<{ n: number }>("SELECT COUNT(*) AS n FROM equipment WHERE eventId = ?", event.id))!.n;
    const events = (await this.db.first<{ n: number }>("SELECT COUNT(*) AS n FROM events"))!.n;
    if (n > 0 || events > 1) return;
    const defaults: [string, string][] = [["Nintendo Switch", "Konsolen"], ["Beamer", "Technik"], ["Controller", "Technik"], ["HDMI-Kabel", "Kabel"], ["Netzwerkkabel", "Kabel"], ["Netzwerk-Switch", "Netzwerk"], ["Mehrfachsteckdosen", "Kabel"], ["Bier", "Getränke"], ["Energy-Drinks", "Getränke"], ["Snacks", "Verpflegung"], ["Boxen / Lautsprecher", "Technik"]];
    await this.db.batch(defaults.map(([name, cat]) => ({ sql: "INSERT INTO equipment (eventId, name, category, createdAt) VALUES (?, ?, ?, ?)", params: [event.id, name, cat, now()] })));
  }

  // ================================================================ Freigaben (Ordnerlisten werden vom PC hochgeladen)
  private async shareDto(s: ShareRow, members: Map<number, MemberRow>, gamesCount: number) {
    return { id: s.id, path: s.path, username: "", addedById: s.addedById, addedByName: s.addedById != null ? members.get(s.addedById)?.name ?? null : null, lastScanAt: s.lastScanAt, lastError: s.lastError, lastCount: s.lastCount, gamesCount, createdAt: s.createdAt, uploadKey: s.uploadKey };
  }
  async shares() {
    const [members, counts, rows] = await Promise.all([this.db.all<MemberRow>("SELECT id, name FROM members"), this.db.all<{ shareId: number; n: number }>("SELECT shareId, COUNT(*) AS n FROM games WHERE shareId IS NOT NULL GROUP BY shareId"), this.db.all<ShareRow>("SELECT * FROM shares ORDER BY path COLLATE NOCASE")]);
    const mBy = byId(members), cBy = new Map(counts.map(c => [c.shareId, c.n]));
    return Promise.all(rows.map(s => this.shareDto(s, mBy, cBy.get(s.id) ?? 0)));
  }
  async createShare(req: { path: string }, actorId: number | null, uploadKey: string) {
    const path = normalizeUnc(req.path);
    if (await this.db.first("SELECT id FROM shares WHERE path = ? COLLATE NOCASE", path)) throw new BadRequest("Diese Freigabe ist schon eingetragen");
    const id = await this.db.insert("INSERT INTO shares (path, addedById, uploadKey, createdAt) VALUES (?, ?, ?, ?)", path, actorId, uploadKey, now());
    return (await this.shares()).find(s => s.id === id)!;
  }
  async deleteShare(id: number, actorId: number, isAdmin: boolean) {
    const s = await this.db.first<ShareRow>("SELECT * FROM shares WHERE id = ?", id);
    if (!s) return;
    if (s.addedById !== actorId && !isAdmin) throw new Forbidden("Nur wer die Freigabe eingetragen hat, kann sie entfernen");
    await this.db.batch([{ sql: "UPDATE games SET sharePath = '', shareId = NULL WHERE shareId = ?", params: [id] }, { sql: "DELETE FROM shares WHERE id = ?", params: [id] }]);
  }
  async shareByUploadKey(id: number, key: string) {
    const s = await this.db.first<ShareRow>("SELECT * FROM shares WHERE id = ?", id);
    if (!s || !key || s.uploadKey !== key) throw new Forbidden("Ungültiger Upload-Schlüssel");
    return s;
  }
  /** Ordnerliste vom PC übernehmen: neue Ordner werden Spiele, Dubletten übersprungen, verschwundene Ordner lösen den Pfad. */
  async applyFolders(share: ShareRow, foldersIn: string[]) {
    const folders = [...new Set(foldersIn.map(f => String(f).trim()).filter(isGameFolder))].sort();
    const known = new Set(share.knownFolders.split("\n").filter(Boolean));
    const games = await this.db.all<GameRow>("SELECT * FROM games");
    let added = 0;
    for (const folder of folders) {
      const path = `${share.path}\\${folder}`;
      if (games.some(g => g.sharePath.toLowerCase() === path.toLowerCase())) continue;
      const key = gameKey(folder);
      const same = games.find(g => gameKey(g.name) === key);
      if (same) { if (!same.sharePath) { await this.db.run("UPDATE games SET sharePath = ?, shareId = ? WHERE id = ?", path, share.id, same.id); same.sharePath = path; } continue; }
      if (known.has(folder)) continue;
      const id = await this.db.insert("INSERT INTO games (name, addedById, sharePath, shareId, createdAt) VALUES (?, ?, ?, ?, ?)", displayName(folder), share.addedById, path, share.id, now());
      games.push({ ...games[0], id, name: displayName(folder), sharePath: path, shareId: share.id } as GameRow);
      added++;
    }
    const present = new Set(folders.map(f => `${share.path}\\${f}`.toLowerCase()));
    for (const g of games.filter(g => g.shareId === share.id && !present.has(g.sharePath.toLowerCase()))) await this.db.run("UPDATE games SET sharePath = '', shareId = NULL WHERE id = ?", g.id);
    folders.forEach(f => known.add(f));
    await this.db.run("UPDATE shares SET lastScanAt = ?, lastError = '', lastCount = ?, knownFolders = ? WHERE id = ?", now(), folders.length, [...known].join("\n"), share.id);
    return { shareId: share.id, path: share.path, folders: folders.length, added };
  }

  // ================================================================ Klänge (Admin lädt eigene Audiodateien hoch)
  async sounds() {
    const rows = await this.db.all<{ kind: string; name: string; contentType: string; updatedAt: number }>("SELECT kind, name, contentType, updatedAt FROM sounds");
    return Object.fromEntries(rows.map(r => [r.kind, { name: r.name, contentType: r.contentType, updatedAt: r.updatedAt, url: `/api/sounds/${r.kind}?v=${r.updatedAt}` }]));
  }
  async sound(kind: string) {
    const r = await this.db.first<{ data: ArrayBuffer | number[]; contentType: string }>("SELECT data, contentType FROM sounds WHERE kind = ?", kind);
    return r ? { data: toBytes(r.data), contentType: r.contentType } : null;
  }
  async setSound(kind: string, data: ArrayBuffer, contentType: string, name: string) {
    await this.db.run("INSERT INTO sounds (kind, data, contentType, name, updatedAt) VALUES (?, ?, ?, ?, ?) ON CONFLICT(kind) DO UPDATE SET data = excluded.data, contentType = excluded.contentType, name = excluded.name, updatedAt = excluded.updatedAt", kind, data, contentType, name.slice(0, 80), now());
  }
  async deleteSound(kind: string) { await this.db.run("DELETE FROM sounds WHERE kind = ?", kind); }

  // ================================================================ Einstellungen / Admin
  async inviteCode() { return (await this.db.setting("inviteCode")) ?? (await this.regenerateInviteCode()); }
  async regenerateInviteCode() { const { randomCode } = await import("./auth"); const c = randomCode(8); await this.db.setSetting("inviteCode", c); return c; }
  async adminCount() { return (await this.db.first<{ n: number }>("SELECT COUNT(*) AS n FROM members WHERE isAdmin = 1"))!.n; }
  async touch(topic: string) { await this.db.run("INSERT INTO changes (topic, ts) VALUES (?, ?) ON CONFLICT(topic) DO UPDATE SET ts = excluded.ts", topic, now()); }
  async changesSince(ts: number) { return (await this.db.all<{ topic: string; ts: number }>("SELECT topic, ts FROM changes WHERE ts > ?", ts)); }
}
