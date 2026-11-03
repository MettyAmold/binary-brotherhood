// Einstieg des Workers: Routing der REST-API (gleiche Pfade wie die Android-App), Login-Pflicht,
// Live-Updates über das Hub-Durable-Object, Steam-Proxy, Admin-Funktionen, Export/Import.
import { Db, Env } from "./db";
import { Repo, toBytes } from "./repo";
import { resolveSession, issueToken, login, changePassword, resetPassword, validatePassword, hashPassword, randomCode, Session } from "./auth";
import { steamSearch, steamDetails, steamAppIdFromUrl } from "./steam";
import { HttpError, Unauthorized, Forbidden, BadRequest, NotFound } from "./logic";
export { Hub } from "./hub";

const VERSION = "2.0.0";
const PUBLIC = new Set(["/api/auth/members", "/api/auth/login", "/api/auth/register", "/api/ping", "/api/host", "/api/changes"]);

type Handler = (c: Ctx) => Promise<Response | unknown>;
interface Route { method: string; pattern: RegExp; keys: string[]; handler: Handler }
interface Ctx { req: Request; env: Env; db: Db; repo: Repo; session: Session | null; params: Record<string, string>; url: URL; body: <T = any>() => Promise<T>; broadcast: (topic: string, payload?: unknown) => Promise<void> }

const routes: Route[] = [];
function add(method: string, path: string, handler: Handler) {
  const keys: string[] = [];
  const pattern = new RegExp("^" + path.replace(/\{(\w+)\}/g, (_, k) => { keys.push(k); return "([^/]+)"; }) + "$");
  routes.push({ method, pattern, keys, handler });
}
const get = (p: string, h: Handler) => add("GET", p, h), post = (p: string, h: Handler) => add("POST", p, h), put = (p: string, h: Handler) => add("PUT", p, h), del = (p: string, h: Handler) => add("DELETE", p, h);

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers } });
const ok = (id?: number) => ({ ok: true, id: id ?? null });
const id = (c: Ctx, name = "id") => { const n = Number(c.params[name]); if (!Number.isInteger(n)) throw new BadRequest("Ungültige ID"); return n; };
const eventId = (c: Ctx) => { const v = c.url.searchParams.get("eventId"); return v ? Number(v) : null; };
const actor = (c: Ctx) => c.session?.member.id ?? null;
const session = (c: Ctx) => { if (!c.session) throw new Unauthorized(); return c.session; };
const isAdmin = (c: Ctx) => !!c.session && c.session.member.isAdmin === 1;
const requireAdmin = (c: Ctx) => { if (!isAdmin(c)) throw new Forbidden("Nur Admins dürfen das"); };
const requireSelfOrAdmin = (c: Ctx, memberId: number) => { if (session(c).member.id !== memberId && !isAdmin(c)) throw new Forbidden("Nur das eigene Profil kann bearbeitet werden"); };
const device = (c: Ctx) => c.req.headers.get("User-Agent") ?? "";
const authResponse = async (c: Ctx, memberId: number, token: string) => ({ token, member: await c.repo.member(memberId), isHost: (await c.repo.member(memberId)).isAdmin, isAdmin: (await c.repo.member(memberId)).isAdmin });

// ---------------- Login
get("/api/auth/members", async c => c.repo.authMembers());
post("/api/auth/login", async c => {
  const r = await c.body<{ memberId: number; password: string }>();
  const m = await login(c.db, Number(r.memberId), String(r.password ?? ""));
  const token = await issueToken(c.db, m.id, device(c));
  await c.broadcast("members");
  return authResponse(c, m.id, token);
});
post("/api/auth/register", async c => {
  const r = await c.body<{ name: string; password: string; color?: string; inviteCode?: string }>();
  validatePassword(String(r.password ?? ""));
  const count = (await c.db.first<{ n: number }>("SELECT COUNT(*) AS n FROM members"))!.n;
  if (count > 0) {
    const code = await c.repo.inviteCode();
    if (String(r.inviteCode ?? "").trim().toUpperCase() !== code) throw new Forbidden("Einladungscode fehlt oder ist falsch. Frag einen Admin der Bruderschaft.");
  }
  const m = await c.repo.createMember({ name: r.name, color: r.color });
  await c.db.run("UPDATE members SET password = ? WHERE id = ?", await hashPassword(r.password), m.id);
  const token = await issueToken(c.db, m.id, device(c));
  await c.broadcast("members");
  return authResponse(c, m.id, token);
});
get("/api/auth/me", async c => { const s = session(c); const m = await c.repo.member(s.member.id); return { member: m, isHost: m.isAdmin, isAdmin: m.isAdmin }; });
post("/api/auth/logout", async c => { await c.db.run("DELETE FROM auth_tokens WHERE tokenHash = ?", session(c).tokenHash); return ok(); });
post("/api/auth/password", async c => {
  const s = session(c); const r = await c.body<{ oldPassword?: string; newPassword: string }>();
  await changePassword(c.db, s.member.id, r.oldPassword ?? "", r.newPassword);
  return authResponse(c, s.member.id, await issueToken(c.db, s.member.id, device(c)));
});
post("/api/auth/reset/{id}", async c => { requireAdmin(c); await resetPassword(c.db, id(c)); await c.broadcast("members"); return ok(); });

// ---------------- Admin
get("/api/admin/invite", async c => { requireAdmin(c); return { code: await c.repo.inviteCode() }; });
post("/api/admin/invite", async c => { requireAdmin(c); return { code: await c.repo.regenerateInviteCode() }; });
post("/api/admin/members/{id}/admin", async c => { requireAdmin(c); const r = await c.body<{ admin: boolean }>(); const m = await c.repo.setAdmin(id(c), !!r.admin); await c.broadcast("members"); return m; });
get("/api/admin/export", async c => { requireAdmin(c); return exportAll(c); });
post("/api/admin/import", async c => { requireAdmin(c); const data = await c.body<ExportData>(); const r = await importAll(c, data); for (const t of ["members", "games", "sessions", "suggestions", "forum", "costs", "equipment", "events", "shares"]) await c.broadcast(t); return r; });

// ---------------- Allgemein
get("/api/bootstrap", async c => {
  const ev = await c.repo.ensureCurrentEvent();
  return { event: { id: ev.id, name: ev.name, year: ev.year, startDate: ev.startDate, days: ev.days, isCurrent: true }, events: await c.repo.events(), members: await c.repo.members(), serverTime: Date.now(), appName: c.env.APP_NAME };
});
get("/api/host", async c => ({ mode: "cloud", addresses: [c.url.host], port: 443, clients: 0, version: VERSION, dbPath: "Cloudflare D1" }));
get("/api/ping", async () => new Response("pong"));
get("/api/changes", async c => ({ now: Date.now(), changes: await c.repo.changesSince(Number(c.url.searchParams.get("since") ?? 0)) }));

// ---------------- Mitglieder
get("/api/members", async c => c.repo.members());
post("/api/members", async c => { const m = await c.repo.createMember(await c.body()); await c.broadcast("members"); return m; });
get("/api/members/{id}", async c => c.repo.member(id(c)));
put("/api/members/{id}", async c => { requireSelfOrAdmin(c, id(c)); const m = await c.repo.updateMember(id(c), await c.body()); await c.broadcast("members"); return m; });
del("/api/members/{id}", async c => { requireSelfOrAdmin(c, id(c)); await c.repo.deleteMember(id(c)); await c.broadcast("members"); return ok(); });
get("/api/members/{id}/xp", async c => c.repo.xpLog(id(c)));
get("/api/members/{id}/avatar", async c => {
  const data = await c.repo.avatar(id(c));
  if (!data) return Response.redirect(new URL("/img/avatar-default.svg", c.url).toString(), 302);
  return new Response(data as unknown as BodyInit, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=3600" } });
});
post("/api/members/{id}/avatar", async c => {
  requireSelfOrAdmin(c, id(c));
  let bytes: ArrayBuffer;
  const ct = c.req.headers.get("Content-Type") ?? "";
  if (ct.startsWith("multipart/")) {
    const form = await c.req.formData();
    const f = [...form.values()].find(v => v instanceof File) as File | undefined;
    if (!f) throw new BadRequest("Kein Bild übermittelt");
    bytes = await f.arrayBuffer();
  } else bytes = await c.req.arrayBuffer();
  if (!bytes.byteLength) throw new BadRequest("Kein Bild übermittelt");
  if (bytes.byteLength > 900_000) throw new BadRequest("Bild ist zu groß (max. 900 KB, die App verkleinert normalerweise auf 512 px)");
  await c.repo.setAvatar(id(c), bytes); await c.broadcast("members"); return ok(id(c));
});

// ---------------- Spiele
get("/api/games", async c => c.repo.games());
post("/api/games", async c => { const g = await c.repo.createGame(await c.body(), actor(c)); await c.broadcast("games"); return g; });
put("/api/games/{id}", async c => { const g = await c.repo.updateGame(id(c), await c.body()); await c.broadcast("games"); return g; });
del("/api/games/{id}", async c => { await c.repo.deleteGame(id(c)); await c.broadcast("games"); return ok(); });
post("/api/games/{id}/select", async c => { await c.repo.selectGame(id(c), !!(await c.body<{ selected: boolean }>()).selected); await c.broadcast("games"); return ok(); });

// ---------------- Freigaben: der PC lädt seine Ordnerliste per Skript hoch
get("/api/shares", async c => c.repo.shares());
post("/api/shares", async c => { const s = await c.repo.createShare(await c.body(), actor(c), randomCode(20)); await c.broadcast("shares"); return s; });
del("/api/shares/{id}", async c => { await c.repo.deleteShare(id(c), session(c).member.id, isAdmin(c)); await c.broadcast("shares"); await c.broadcast("games"); return ok(); });
post("/api/shares/{id}/folders", async c => {
  // Ohne Login, aber mit dem Upload-Schlüssel der Freigabe (steht im Skript)
  const share = await c.repo.shareByUploadKey(id(c), c.req.headers.get("X-Share-Key") ?? "");
  const r = await c.body<{ folders: string[] }>();
  if (!Array.isArray(r.folders)) throw new BadRequest("folders fehlt");
  const res = await c.repo.applyFolders(share, r.folders);
  await c.broadcast("games"); await c.broadcast("shares");
  return res;
});
get("/api/shares/wizard", async c => ({ clientIp: c.req.headers.get("CF-Connecting-IP") ?? "", clientIsHostPhone: false, hostAddresses: [], mode: "cloud", base: c.url.origin }));

// ---------------- Runden
get("/api/sessions", async c => c.repo.sessions(eventId(c)));
post("/api/sessions", async c => { const s = await c.repo.startSession(await c.body()); await c.broadcast("sessions"); await c.broadcast("games"); return s; });
put("/api/sessions/{id}", async c => { const r = await c.body<{ participantIds: number[]; note?: string }>(); const s = await c.repo.updateSession(id(c), r.participantIds, r.note ?? ""); await c.broadcast("sessions"); await c.broadcast("members"); return s; });
post("/api/sessions/{id}/end", async c => { const s = await c.repo.endSession(id(c)); await c.broadcast("sessions"); return s; });
del("/api/sessions/{id}", async c => { await c.repo.deleteSession(id(c)); await c.broadcast("sessions"); await c.broadcast("games"); return ok(); });

// ---------------- Glücksrad & Abstimmung
get("/api/wheel/state", async c => { const s = await c.repo.lastSpin(); return s ?? new Response(null, { status: 204 }); });
post("/api/wheel/spin", async c => { const r = await c.body<{ excludePlayed?: boolean; onlySelected?: boolean }>(); const s = await c.repo.spin(!!r.excludePlayed, r.onlySelected ?? true, actor(c)); await c.broadcast("wheel", s); return s; });
get("/api/polls/current", async c => (await c.repo.currentPoll()) ?? new Response(null, { status: 204 }));
post("/api/polls", async c => { const p = await c.repo.openPoll(); await c.broadcast("poll"); return p; });
post("/api/polls/{id}/vote", async c => { const p = await c.repo.votePoll(id(c), actor(c), Number((await c.body<{ gameId: number }>()).gameId)); await c.broadcast("poll"); return p; });
post("/api/polls/{id}/close", async c => { const p = await c.repo.closePoll(id(c)); await c.broadcast("poll"); return p; });

// ---------------- Vorschläge
get("/api/suggestions", async c => c.repo.suggestions(actor(c)));
post("/api/suggestions", async c => { const s = await c.repo.createSuggestion(await c.body(), actor(c)); await c.broadcast("suggestions"); return s; });
put("/api/suggestions/{id}", async c => { const s = await c.repo.updateSuggestion(id(c), await c.body(), actor(c)); await c.broadcast("suggestions"); return s; });
del("/api/suggestions/{id}", async c => { await c.repo.deleteSuggestion(id(c)); await c.broadcast("suggestions"); return ok(); });
post("/api/suggestions/{id}/vote", async c => { await c.repo.voteSuggestion(id(c), actor(c), Number((await c.body<{ value: number }>()).value)); await c.broadcast("suggestions"); return ok(); });
post("/api/suggestions/{id}/comments", async c => { await c.repo.commentSuggestion(id(c), actor(c), (await c.body<{ text: string }>()).text); await c.broadcast("suggestions"); return ok(); });
del("/api/suggestions/comments/{id}", async c => { await c.repo.deleteSuggestionComment(id(c)); await c.broadcast("suggestions"); return ok(); });
post("/api/suggestions/{id}/adopt", async c => { const g = await c.repo.adoptSuggestion(id(c), actor(c)); await c.broadcast("suggestions"); await c.broadcast("games"); return g; });

// ---------------- Forum
get("/api/forum", async c => c.repo.forum());
post("/api/forum", async c => { const p = await c.repo.createPost(await c.body(), actor(c)); await c.broadcast("forum"); return p; });
put("/api/forum/{id}", async c => { const p = await c.repo.updatePost(id(c), await c.body()); await c.broadcast("forum"); return p; });
del("/api/forum/{id}", async c => { await c.repo.deletePost(id(c)); await c.broadcast("forum"); return ok(); });
post("/api/forum/{id}/comments", async c => { await c.repo.commentPost(id(c), actor(c), (await c.body<{ text: string }>()).text); await c.broadcast("forum"); return ok(); });
del("/api/forum/comments/{id}", async c => { await c.repo.deleteForumComment(id(c)); await c.broadcast("forum"); return ok(); });

// ---------------- LAN-Party-Ausgaben
get("/api/events", async c => c.repo.events());
post("/api/events", async c => { const e = await c.repo.createEvent(await c.body()); await c.broadcast("events"); await c.broadcast("equipment"); await c.broadcast("suggestions"); return e; });
put("/api/events/{id}", async c => { const e = await c.repo.updateEvent(id(c), await c.body()); await c.broadcast("events"); return e; });
post("/api/events/{id}/activate", async c => { await c.repo.activateEvent(id(c)); await c.broadcast("events"); return ok(); });
del("/api/events/{id}", async c => { await c.repo.deleteEvent(id(c)); await c.broadcast("events"); return ok(); });

// ---------------- Kosten
get("/api/costs", async c => c.repo.costs(eventId(c)));
put("/api/costs/attendance", async c => { await c.repo.setAttendance(eventId(c), await c.body()); await c.broadcast("costs"); await c.broadcast("members"); return ok(); });
post("/api/costs/expenses", async c => { const e = await c.repo.createExpense(eventId(c), await c.body()); await c.broadcast("costs"); return e; });
put("/api/costs/expenses/{id}", async c => { const e = await c.repo.updateExpense(id(c), await c.body()); await c.broadcast("costs"); return e; });
del("/api/costs/expenses/{id}", async c => { await c.repo.deleteExpense(id(c)); await c.broadcast("costs"); return ok(); });
post("/api/costs/payments", async c => { const p = await c.repo.createPayment(eventId(c), await c.body()); await c.broadcast("costs"); return p; });
del("/api/costs/payments/{id}", async c => { await c.repo.deletePayment(id(c)); await c.broadcast("costs"); return ok(); });

// ---------------- Ausrüstung
get("/api/equipment", async c => c.repo.equipment(eventId(c)));
post("/api/equipment", async c => { const e = await c.repo.createEquipment(eventId(c), await c.body()); await c.broadcast("equipment"); return e; });
put("/api/equipment/{id}", async c => { const e = await c.repo.updateEquipment(id(c), await c.body()); await c.broadcast("equipment"); return e; });
del("/api/equipment/{id}", async c => { await c.repo.deleteEquipment(id(c)); await c.broadcast("equipment"); return ok(); });
post("/api/equipment/{id}/claim", async c => { const r = await c.body<{ memberId?: number | null }>(); const e = await c.repo.claimEquipment(id(c), r.memberId ?? null); await c.broadcast("equipment"); return e; });
post("/api/equipment/{id}/done", async c => { const e = await c.repo.setEquipmentDone(id(c), !!(await c.body<{ done: boolean }>()).done); await c.broadcast("equipment"); await c.broadcast("members"); return e; });
post("/api/equipment/template", async c => { const n = await c.repo.applyEquipmentTemplate((await c.body<{ fromEventId?: number | null }>()).fromEventId ?? null); await c.broadcast("equipment"); return ok(n); });

// ---------------- Klänge
const SOUND_KINDS = new Set(["spin", "winner"]);
const soundKind = (c: Ctx) => { const k = c.params.kind; if (!SOUND_KINDS.has(k)) throw new NotFound("Unbekannter Klang"); return k; };
get("/api/sounds", async c => c.repo.sounds());
get("/api/sounds/{kind}", async c => {
  const s = await c.repo.sound(soundKind(c));
  if (!s) throw new NotFound("Kein eigener Klang hinterlegt");
  return new Response(s.data as unknown as BodyInit, { headers: { "Content-Type": s.contentType, "Cache-Control": "public, max-age=86400" } });
});
post("/api/sounds/{kind}", async c => {
  requireAdmin(c);
  const kind = soundKind(c);
  const ct = c.req.headers.get("Content-Type") ?? "";
  if (!ct.startsWith("audio/")) throw new BadRequest("Bitte eine Audiodatei hochladen (MP3, OGG, WAV, M4A)");
  const data = await c.req.arrayBuffer();
  if (!data.byteLength) throw new BadRequest("Datei ist leer");
  if (data.byteLength > 1_500_000) throw new BadRequest("Datei ist zu groß (max. 1,5 MB) – kurzen Clip nehmen");
  await c.repo.setSound(kind, data, ct.split(";")[0], decodeURIComponent(c.req.headers.get("X-File-Name") ?? kind));
  await c.broadcast("sounds");
  return c.repo.sounds();
});
del("/api/sounds/{kind}", async c => { requireAdmin(c); await c.repo.deleteSound(soundKind(c)); await c.broadcast("sounds"); return c.repo.sounds(); });

// ---------------- Steam
get("/api/steam/search", async c => { try { return await steamSearch(c.url.searchParams.get("q") ?? ""); } catch (e) { throw new BadRequest(`Steam nicht erreichbar: ${(e as Error).message}`); } });
get("/api/steam/app/{id}", async c => { let d; try { d = await steamDetails(id(c)); } catch (e) { throw new BadRequest(`Steam nicht erreichbar: ${(e as Error).message}`); } if (!d) throw new NotFound("Steam-App nicht gefunden"); return d; });
get("/api/steam/parse", async c => { const a = steamAppIdFromUrl(c.url.searchParams.get("url") ?? ""); if (!a) throw new BadRequest("Keine Steam-App-ID im Link gefunden"); return { appId: a }; });

// ---------------- Export / Import (Datenumzug vom Handy)
const TABLES = ["events", "members", "auth_tokens", "games", "shares", "sessions", "session_participants", "suggestions", "suggestion_votes", "suggestion_comments", "forum_posts", "forum_comments", "attendance", "expenses", "expense_shares", "payments", "equipment", "polls", "poll_votes", "xp_log"] as const;
interface ExportData { format: string; exportedAt: number; tables: Record<string, Record<string, unknown>[]>; avatars?: Record<string, string> }
async function exportAll(c: Ctx): Promise<ExportData> {
  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const t of TABLES) {
    const rows = await c.db.all(t === "members" ? "SELECT id, name, motto, color, hasAvatar, createdAt, password, isAdmin, avatarUpdatedAt FROM members" : `SELECT * FROM ${t}`);
    tables[t] = rows;
  }
  const avatars: Record<string, string> = {};
  for (const m of await c.db.all<{ id: number; avatar: ArrayBuffer | number[] | null }>("SELECT id, avatar FROM members WHERE avatar IS NOT NULL")) {
    if (m.avatar) { const b = toBytes(m.avatar); let s = ""; for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192)); avatars[String(m.id)] = btoa(s); }
  }
  return { format: "binary-brotherhood/1", exportedAt: Date.now(), tables, avatars };
}
/** Ersetzt den gesamten Datenbestand durch den Export (z. B. aus der Android-App). Tokens werden nicht übernommen. */
async function importAll(c: Ctx, data: ExportData) {
  if (data?.format !== "binary-brotherhood/1" || !data.tables) throw new BadRequest("Kein gültiger Export");
  const stmts: { sql: string; params?: unknown[] }[] = [];
  for (const t of TABLES) stmts.push({ sql: `DELETE FROM ${t}` });
  let count = 0;
  for (const t of TABLES) {
    if (t === "auth_tokens") continue;
    for (const row of data.tables[t] ?? []) {
      const r: Record<string, unknown> = { ...row };
      if (t === "members") { delete r.avatar; r.isAdmin = r.isAdmin ?? 0; }
      if (t === "shares") { delete r.username; delete r.password; delete r.domain; r.uploadKey = r.uploadKey ?? randomCode(20); }
      const cols = Object.keys(r);
      stmts.push({ sql: `INSERT INTO ${t} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`, params: cols.map(k => r[k] === undefined ? null : r[k]) });
      count++;
    }
  }
  await c.db.batch(stmts);
  for (const [mid, b64] of Object.entries(data.avatars ?? {})) {
    const bytes = Uint8Array.from(atob(b64), ch => ch.charCodeAt(0));
    await c.db.run("UPDATE members SET avatar = ?, hasAvatar = 1, avatarUpdatedAt = ? WHERE id = ?", bytes.buffer, Date.now(), Number(mid));
  }
  // Ohne Admin wäre niemand handlungsfähig: der Importierende bleibt Admin, sonst das erste Mitglied
  if ((await c.repo.adminCount()) === 0) {
    const self = await c.db.first<{ id: number }>("SELECT id FROM members WHERE id = ?", c.session!.member.id);
    const first = self ?? (await c.db.first<{ id: number }>("SELECT id FROM members ORDER BY id LIMIT 1"));
    if (first) await c.db.run("UPDATE members SET isAdmin = 1 WHERE id = ?", first.id);
  }
  return { ok: true, rows: count };
}

// ---------------- Dispatcher
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      const stub = env.HUB.get(env.HUB.idFromName("hub"));
      return stub.fetch(req);
    }
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);

    const db = new Db(env.DB);
    const repo = new Repo(db);
    const token = req.headers.get("Authorization")?.replace(/^Bearer\s*/i, "").trim() ?? null;
    const sess = await resolveSession(db, token);
    const isAvatarGet = req.method === "GET" && (/^\/api\/members\/\d+\/avatar$/.test(url.pathname) || /^\/api\/sounds(\/\w+)?$/.test(url.pathname));
    const isFolderUpload = req.method === "POST" && /^\/api\/shares\/\d+\/folders$/.test(url.pathname);
    if (!sess && !PUBLIC.has(url.pathname) && !isAvatarGet && !isFolderUpload) return json({ error: "Bitte anmelden" }, 401);

    const broadcast = async (topic: string, payload?: unknown) => {
      await repo.touch(topic);
      const msg = JSON.stringify({ type: "change", topic, ts: Date.now(), ...(payload !== undefined ? { payload } : {}) });
      try { await env.HUB.get(env.HUB.idFromName("hub")).fetch("https://hub/broadcast", { method: "POST", body: msg }); } catch (e) { console.warn("broadcast", e); }
    };
    const ctx: Ctx = { req, env, db, repo, session: sess, params: {}, url, body: async () => { try { return await req.json(); } catch { throw new BadRequest("Ungültiges JSON"); } }, broadcast };

    try {
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = r.pattern.exec(url.pathname);
        if (!m) continue;
        r.keys.forEach((k, i) => (ctx.params[k] = decodeURIComponent(m[i + 1])));
        const result = await r.handler(ctx);
        return result instanceof Response ? result : json(result);
      }
      return json({ error: "Unbekannter Endpunkt" }, 404);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: (e as Error).message || "Interner Fehler" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
