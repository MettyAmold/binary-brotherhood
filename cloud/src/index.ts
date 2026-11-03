// Einstieg des Workers: statische Web-App, Konten (gelten für alle Realms), Realm-Verzeichnis, Super-Admin-Verwaltung
// und Weiterleitung aller übrigen API-Aufrufe an das Durable Object des gewählten Realms (eigene Datenbank je Realm).
import { Env } from "./db";
import { Accounts, AuthInfo, UserRow, userDto } from "./accounts";
import { RealmRow, publicRealm, realmRow, realmHeaders, realmStub, callRealm } from "./realmClient";
import { HttpError, BadRequest, Forbidden, NotFound, Unauthorized } from "./logic";
import { toBytes } from "./repo";
import realmsSql from "../migrations/0005_realms.sql";
import accountsSql from "../migrations/0006_accounts.sql";
export { Realm } from "./realm";

/** Ohne Angabe (z. B. ältere Freigabe-Skripte) gilt der erste Realm. */
const DEFAULT_REALM = "binary-brotherhood";

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

const slugify = (name: string) => name.toLowerCase()
  .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
  .normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "realm";

/** Realm aus Header (fetch), Query (Skripte, WebSocket) oder Cookie (Bilder, Audio); sonst der erste Realm. */
function realmSlug(req: Request, url: URL): string {
  const fromCookie = /(?:^|;\s*)bb_realm=([^;]+)/.exec(req.headers.get("Cookie") ?? "")?.[1];
  return (req.headers.get("X-Realm") || url.searchParams.get("realm") || (fromCookie && decodeURIComponent(fromCookie)) || DEFAULT_REALM).toLowerCase();
}

/** D1-Schema beim ersten Aufruf je Isolate anlegen (idempotent; `wrangler d1 migrations apply --remote` geht mit dem Token nicht). */
let ready: Promise<unknown> | null = null;
const ensureReady = (env: Env) => (ready ??= (async () => {
  for (const file of [realmsSql, accountsSql])
    for (const stmt of file.replace(/--.*$/gm, "").split(";").map(x => x.trim()).filter(Boolean)) await env.DB.prepare(stmt).run();
})().catch(e => { ready = null; throw e; }));

const allRealms = async (env: Env) => (await env.DB.prepare("SELECT * FROM realms ORDER BY legacy DESC, name COLLATE NOCASE").all<RealmRow>()).results ?? [];

const authOf = (u: UserRow): AuthInfo => ({ userId: u.id, name: u.name, superAdmin: u.isSuperAdmin === 1 });

async function accountMe(acc: Accounts, env: Env, u: UserRow) {
  const mine = await acc.realmsOf(u.id);
  const all = await allRealms(env);
  const mineSlugs = new Set(mine.map(r => r.slug));
  return { user: userDto(u), realms: all.filter(r => mineSlugs.has(r.slug)).map(publicRealm), otherRealms: all.filter(r => !mineSlugs.has(r.slug)).map(publicRealm) };
}

type Route = (req: Request, env: Env, url: URL, m: RegExpExecArray) => Promise<unknown>;
const routes: [string, RegExp, Route][] = [];
const route = (method: string, path: string, fn: Route) => routes.push([method, new RegExp("^" + path.replace(/\{\w+\}/g, "([^/]+)") + "$"), fn]);
const body = async <T = any>(req: Request): Promise<T> => { try { return await req.json(); } catch { throw new BadRequest("Ungültiges JSON"); } };
const bearer = (req: Request, url: URL) => req.headers.get("Authorization")?.replace(/^Bearer\s*/i, "").trim() || url.searchParams.get("token") || null;
async function requireUser(req: Request, env: Env, url: URL) {
  const s = await new Accounts(env).resolve(bearer(req, url));
  if (!s) throw new Unauthorized();
  return s;
}
async function requireSuper(req: Request, env: Env, url: URL) {
  const s = await requireUser(req, env, url);
  if (s.user.isSuperAdmin !== 1) throw new Forbidden("Nur Super-Admins dürfen das");
  return s;
}

// ---------------- Konto
route("POST", "/api/account/register", async (req, env) => {
  const r = await body<{ name: string; password: string }>(req);
  const acc = new Accounts(env);
  const u = await acc.register(r.name, String(r.password ?? ""));
  return { token: await acc.issueToken(u.id, req.headers.get("User-Agent") ?? ""), ...(await accountMe(acc, env, u)) };
});
route("POST", "/api/account/login", async (req, env) => {
  const r = await body<{ name: string; password: string }>(req);
  const acc = new Accounts(env);
  const u = await acc.login(r.name, String(r.password ?? ""));
  return { token: await acc.issueToken(u.id, req.headers.get("User-Agent") ?? ""), ...(await accountMe(acc, env, u)) };
});
route("GET", "/api/account/me", async (req, env, url) => { const s = await requireUser(req, env, url); return accountMe(new Accounts(env), env, s.user); });
route("POST", "/api/account/logout", async (req, env, url) => { const s = await requireUser(req, env, url); await new Accounts(env).logout(s.tokenHash); return { ok: true }; });
route("POST", "/api/account/password", async (req, env, url) => {
  const s = await requireUser(req, env, url); const r = await body<{ oldPassword?: string; newPassword: string }>(req);
  const acc = new Accounts(env);
  await acc.changePassword(s.user.id, r.oldPassword ?? "", r.newPassword);
  return { token: await acc.issueToken(s.user.id, req.headers.get("User-Agent") ?? "") };
});

// ---------------- Realms
route("GET", "/api/realms", async (_req, env) => (await allRealms(env)).map(publicRealm));
route("POST", "/api/realms", async (req, env, url) => {
  const s = await requireUser(req, env, url);
  const r = await body<{ name?: string; kind?: string }>(req);
  const name = String(r.name ?? "").trim().slice(0, 60);
  if (name.length < 3) throw new BadRequest("Der Name braucht mindestens 3 Zeichen");
  const kind = r.kind === "online" ? "online" : "lan";
  if (await env.DB.prepare("SELECT slug FROM realms WHERE lower(name) = lower(?)").bind(name).first()) throw new HttpError(409, "Einen Realm mit diesem Namen gibt es schon");
  const base = slugify(name);
  let slug = base;
  for (let i = 2; await realmRow(env, slug); i++) slug = `${base}-${i}`;
  await env.DB.prepare("INSERT INTO realms (slug, name, kind, createdAt, legacy) VALUES (?, ?, ?, ?, 0)").bind(slug, name, kind, Date.now()).run();
  await callRealm(env, slug, "join", { userId: s.user.id, bypass: true, admin: true });
  return { slug, name, kind };
});
/** Beitreten mit Einladungscode; Super-Admins brauchen keinen. */
route("POST", "/api/realms/{slug}/join", async (req, env, url, m) => {
  const s = await requireUser(req, env, url);
  const slug = decodeURIComponent(m[1]).toLowerCase();
  const row = await realmRow(env, slug);
  if (!row) throw new NotFound("Diesen Realm gibt es nicht (mehr)");
  const r = await body<{ inviteCode?: string }>(req);
  const res = await callRealm(env, slug, "join", { userId: s.user.id, inviteCode: r.inviteCode, bypass: s.user.isSuperAdmin === 1 });
  return { ...publicRealm(row), ...res };
});

// ---------------- Super-Admin: alle Konten und Realms
route("GET", "/api/super/overview", async (req, env, url) => {
  await requireSuper(req, env, url);
  const users = (await env.DB.prepare("SELECT id, name, password, color, motto, avatarUpdatedAt, isSuperAdmin, createdAt FROM users ORDER BY name COLLATE NOCASE").all<UserRow>()).results ?? [];
  const links = (await env.DB.prepare("SELECT realmSlug, userId FROM realm_members").all<{ realmSlug: string; userId: number }>()).results ?? [];
  const realms = await allRealms(env);
  return {
    users: users.map(u => ({ ...userDto(u), createdAt: u.createdAt, realms: links.filter(l => l.userId === u.id).map(l => l.realmSlug) })),
    realms: realms.map(r => ({ ...publicRealm(r), legacy: r.legacy === 1, createdAt: r.createdAt, members: links.filter(l => l.realmSlug === r.slug).length })),
  };
});
route("POST", "/api/super/users/{id}/reset", async (req, env, url, m) => { await requireSuper(req, env, url); await new Accounts(env).resetPassword(Number(m[1])); return { ok: true }; });
route("POST", "/api/super/users/{id}/super", async (req, env, url, m) => {
  const s = await requireSuper(req, env, url);
  const on = !!(await body<{ on: boolean }>(req)).on, uid = Number(m[1]);
  if (!on) {
    const n = (await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE isSuperAdmin = 1").first<{ n: number }>())!.n;
    if (n <= 1) throw new BadRequest("Der letzte Super-Admin kann nicht entfernt werden");
  }
  await env.DB.prepare("UPDATE users SET isSuperAdmin = ? WHERE id = ?").bind(on ? 1 : 0, uid).run();
  return { ok: true, self: uid === s.user.id };
});
route("DELETE", "/api/super/users/{id}", async (req, env, url, m) => {
  const s = await requireSuper(req, env, url);
  const uid = Number(m[1]);
  if (uid === s.user.id) throw new BadRequest("Das eigene Konto kann hier nicht gelöscht werden");
  for (const r of await new Accounts(env).realmsOf(uid)) await callRealm(env, r.slug, "kick", { userId: uid });
  await env.DB.batch([env.DB.prepare("DELETE FROM user_tokens WHERE userId = ?").bind(uid), env.DB.prepare("DELETE FROM realm_members WHERE userId = ?").bind(uid), env.DB.prepare("DELETE FROM users WHERE id = ?").bind(uid)]);
  return { ok: true };
});
route("DELETE", "/api/super/realms/{slug}", async (req, env, url, m) => {
  await requireSuper(req, env, url);
  const slug = decodeURIComponent(m[1]).toLowerCase();
  const row = await realmRow(env, slug);
  if (!row) throw new NotFound("Diesen Realm gibt es nicht");
  if (row.legacy === 1) throw new BadRequest("Der erste Realm kann nicht gelöscht werden");
  await callRealm(env, slug, "destroy");
  await env.DB.batch([env.DB.prepare("DELETE FROM realm_members WHERE realmSlug = ?").bind(slug), env.DB.prepare("DELETE FROM realms WHERE slug = ?").bind(slug)]);
  return { ok: true };
});
/** Avatar eines Kontos (für die Realm-Auswahl und die Verwaltung). */
route("GET", "/api/account/avatar/{id}", async (_req, env, _url, m) => {
  const a = await new Accounts(env).avatar(Number(m[1]));
  if (!a) return Response.redirect(new URL("/img/avatar-default.svg", _url).toString(), 302);
  return new Response(toBytes(a) as unknown as BodyInit, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=3600" } });
});

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname !== "/ws" && !url.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);
    try {
      await ensureReady(env);
      for (const [method, re, fn] of routes) {
        if (method !== req.method) continue;
        const m = re.exec(url.pathname);
        if (!m) continue;
        const r = await fn(req, env, url, m);
        return r instanceof Response ? r : json(r);
      }

      // ---- alles andere gehört einem Realm
      const row = await realmRow(env, realmSlug(req, url));
      if (!row) return json({ error: "Diesen Realm gibt es nicht (mehr)", realmMissing: true }, 404);
      const s = await new Accounts(env).resolve(bearer(req, url));
      return realmStub(env, row.slug).fetch(new Request(req, { headers: realmHeaders(req.headers, row, s ? authOf(s.user) : null) }));
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      const st = (e as { status?: number }).status;
      if (st) return json({ error: (e as Error).message }, st);
      console.error(e);
      return json({ error: (e as Error).message || "Interner Fehler" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
