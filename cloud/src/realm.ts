// Durable Object je Realm: eigene SQLite-Datenbank, REST-API und Live-Verbindungen (WebSocket-Hibernation)
// dieser Gruppe. Realms sind vollständig voneinander getrennt – Mitglieder, Spiele, Forum, Einstellungen.
import { DurableObject } from "cloudflare:workers";
import { Db, Env } from "./db";
import { handleApi, RealmInfo } from "./api";
import { resolveMember } from "./auth";
import type { AuthInfo } from "./accounts";
import { linkUsers, joinRealm, applyProfile } from "./link";
import { Repo } from "./repo";
import { toBytes } from "./repo";
import s0001 from "../realm-schema/0001_init.sql";
import s0002 from "../realm-schema/0002_sounds.sql";
import s0003 from "../realm-schema/0003_media.sql";
import s0004 from "../realm-schema/0004_tournaments.sql";
import s0005 from "../realm-schema/0005_accounts.sql";

/** Schema-Stände je Realm; neue Änderungen hinten anhängen, nie bestehende ändern. */
const SCHEMA = [s0001, s0002, s0003, s0004, s0005];

/** Tabellen, die beim ersten Realm aus der alten D1-Datenbank übernommen werden. */
const LEGACY_TABLES = ["settings", "changes", "events", "members", "auth_tokens", "games", "shares", "sessions", "session_participants",
  "suggestions", "suggestion_votes", "suggestion_comments", "forum_posts", "forum_comments", "attendance", "expenses", "expense_shares",
  "payments", "equipment", "polls", "poll_votes", "xp_log", "sounds", "media", "tournaments", "tournament_teams", "tournament_matches"];
const BLOB_TABLES = new Set(["members", "sounds", "media"]);

interface Attachment { id: number | null; name: string }

export class Realm extends DurableObject<Env> {
  private db: Db;
  private legacyChecked = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.db = new Db(ctx.storage);
    ctx.blockConcurrencyWhile(async () => this.migrate());
  }

  private migrate() {
    const sql = this.ctx.storage.sql;
    sql.exec("CREATE TABLE IF NOT EXISTS _schema (version INTEGER NOT NULL)");
    const row = sql.exec("SELECT version FROM _schema").toArray()[0] as { version: number } | undefined;
    let v = row ? Number(row.version) : 0;
    if (!row) sql.exec("INSERT INTO _schema (version) VALUES (0)");
    while (v < SCHEMA.length) {
      this.ctx.storage.transactionSync(() => { sql.exec(SCHEMA[v]); sql.exec("UPDATE _schema SET version = ?", v + 1); });
      v++;
    }
  }

  /** Erster Realm: einmalig alles aus der alten, gemeinsamen D1-Datenbank holen (inkl. Logins). */
  private async importLegacy(realm: RealmInfo & { legacy?: boolean }) {
    if (this.legacyChecked || !realm.legacy) return;
    if (await this.db.setting("legacyImported")) { this.legacyChecked = true; return; }
    const hasData = await this.db.first("SELECT id FROM members LIMIT 1");
    if (!hasData) {
      for (const table of LEGACY_TABLES) {
        let offset = 0;
        const page = BLOB_TABLES.has(table) ? 5 : 500; // Medien bis 2 MB je Zeile
        for (;;) {
          let rows: Record<string, unknown>[];
          try { rows = (await this.env.DB.prepare(`SELECT * FROM ${table} LIMIT ? OFFSET ?`).bind(page, offset).all()).results ?? []; }
          catch { break; } // Tabelle gab es im Altbestand nicht
          if (!rows.length) break;
          const stmts = rows.map(r => {
            const cols = Object.keys(r);
            const vals = cols.map(c => (Array.isArray(r[c]) ? toBytes(r[c] as number[]) : r[c]));
            return { sql: `INSERT OR REPLACE INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`, params: vals };
          });
          await this.db.batch(stmts);
          offset += rows.length;
          if (rows.length < page) break;
        }
      }
    }
    await this.db.setSetting("legacyImported", String(Date.now()));
    this.legacyChecked = true;
  }

  async fetch(req: Request): Promise<Response> {
    const realm = JSON.parse(decodeURIComponent(req.headers.get("X-Realm-Info") ?? "%7B%7D")) as RealmInfo & { legacy?: boolean };
    const authHeader = req.headers.get("X-Auth");
    const auth = authHeader ? (JSON.parse(decodeURIComponent(authHeader)) as AuthInfo) : null;
    await this.ctx.blockConcurrencyWhile(() => this.importLegacy(realm));
    const url = new URL(req.url);
    if (url.pathname.startsWith("/internal/")) {
      try { return Response.json(await this.internal(url.pathname.slice(10), await req.json().catch(() => ({})), realm)); }
      catch (e) { const st = (e as { status?: number }).status ?? 500; return Response.json({ error: (e as Error).message }, { status: st }); }
    }
    if (url.pathname === "/ws" && req.headers.get("Upgrade") === "websocket") {
      const sess = await resolveMember(this.db, auth);
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      pair[1].serializeAttachment({ id: sess?.member.id ?? null, name: sess?.member.name ?? "" } satisfies Attachment);
      pair[1].send(JSON.stringify({ type: "hello", clients: this.ctx.getWebSockets().length }));
      this.sendPresence();
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    return handleApi(req, this.env, this.db, realm, auth, msg => this.send(msg));
  }

  /** Nur vom Worker oder anderen Realms erreichbar (der Worker leitet /internal nie weiter). */
  private async internal(op: string, body: any, realm: RealmInfo & { legacy?: boolean }) {
    const changed = () => this.send(JSON.stringify({ type: "change", topic: "members", ts: Date.now() }));
    switch (op) {
      case "link": { const r = await this.ctx.blockConcurrencyWhile(() => linkUsers(this.db, this.env, realm)); return r; }
      case "join": { const r = await joinRealm(this.db, this.env, realm, body, () => new Repo(this.db).inviteCode()); if (!r.already) changed(); return r; }
      case "profile": { if (await applyProfile(this.db, this.env, Number(body.userId))) changed(); return { ok: true }; }
      case "kick": {
        const m = await this.db.first<{ id: number }>("SELECT id FROM members WHERE userId = ?", Number(body.userId));
        if (m) { await new Repo(this.db).deleteMember(m.id); changed(); }
        await this.env.DB.prepare("DELETE FROM realm_members WHERE realmSlug = ? AND userId = ?").bind(realm.slug, Number(body.userId)).run();
        return { ok: true };
      }
      case "destroy": {
        for (const ws of this.ctx.getWebSockets()) { try { ws.close(4000, "Realm gelöscht"); } catch { /* egal */ } }
        await this.ctx.storage.deleteAll();
        return { ok: true };
      }
      case "summary": return { members: (await this.db.first<{ n: number }>("SELECT COUNT(*) AS n FROM members"))!.n };
      default: throw Object.assign(new Error("Unbekannt"), { status: 404 });
    }
  }

  private send(msg: string) {
    for (const ws of this.ctx.getWebSockets()) { try { ws.send(msg); } catch { /* Verbindung ist weg */ } }
  }

  /** Verbundene Mitglieder, je Mitglied einmal (mehrere Geräte zählen als eins). */
  private presence(except?: WebSocket): { id: number; name: string }[] {
    const seen = new Map<number, string>();
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue; // gerade schließende Verbindung nicht mehr mitzählen
      const a = ws.deserializeAttachment() as Attachment | null;
      if (a?.id) seen.set(a.id, a.name);
    }
    return [...seen.entries()].map(([id, name]) => ({ id, name })).sort((x, y) => x.name.localeCompare(y.name));
  }
  private sendPresence(except?: WebSocket) { this.send(JSON.stringify({ type: "presence", members: this.presence(except) })); }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (message === "ping") ws.send('{"type":"pong"}');
  }
  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    try { ws.close(code, reason); } catch { /* bereits zu */ }
    this.sendPresence(ws);
  }
  async webSocketError(ws: WebSocket) {
    try { ws.close(1011, "error"); } catch { /* bereits zu */ }
    this.sendPresence(ws);
  }
}
