// Einstieg des Workers: statische Web-App, Realm-Verzeichnis und Weiterleitung aller übrigen API-Aufrufe
// an das Durable Object des gewählten Realms (eigene Datenbank je Realm).
import { Env } from "./db";
import type { RealmInfo } from "./api";
export { Realm } from "./realm";

const DEFAULT_REALM = "binary-brotherhood";
interface RealmRow { slug: string; name: string; kind: string; createdAt: number; legacy: number }

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

export const slugify = (name: string) => name.toLowerCase()
  .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
  .normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "realm";

const publicRealm = (r: RealmRow): RealmInfo => ({ slug: r.slug, name: r.name, kind: r.kind === "online" ? "online" : "lan" });

/** Realm aus Header (fetch), Query (Skripte, WebSocket) oder Cookie (Bilder, Audio); sonst der erste Realm. */
function realmSlug(req: Request, url: URL): string {
  const fromCookie = /(?:^|;\s*)bb_realm=([^;]+)/.exec(req.headers.get("Cookie") ?? "")?.[1];
  return (req.headers.get("X-Realm") || url.searchParams.get("realm") || (fromCookie && decodeURIComponent(fromCookie)) || DEFAULT_REALM).toLowerCase();
}

/** Realm-Verzeichnis anlegen, falls die D1-Migration (0005) noch nicht gelaufen ist – idempotent, einmal je Isolate. */
let registryReady: Promise<unknown> | null = null;
const ensureRegistry = (env: Env) => (registryReady ??= env.DB.batch([
  env.DB.prepare("CREATE TABLE IF NOT EXISTS realms (slug TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'lan', createdAt INTEGER NOT NULL, legacy INTEGER NOT NULL DEFAULT 0)"),
  env.DB.prepare("INSERT OR IGNORE INTO realms (slug, name, kind, createdAt, legacy) VALUES (?, 'BINARY BROTHERHOOD', 'lan', 0, 1)").bind(DEFAULT_REALM),
]).catch(e => { registryReady = null; throw e; }));

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname !== "/ws" && !url.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);
    await ensureRegistry(env);

    // ---- Realm-Verzeichnis (ohne Login)
    if (url.pathname === "/api/realms" && req.method === "GET") {
      const rows = (await env.DB.prepare("SELECT * FROM realms ORDER BY legacy DESC, name COLLATE NOCASE").all<RealmRow>()).results ?? [];
      return json(rows.map(publicRealm));
    }
    if (url.pathname === "/api/realms" && req.method === "POST") {
      let body: { name?: string; kind?: string };
      try { body = await req.json(); } catch { return json({ error: "Ungültiges JSON" }, 400); }
      const name = String(body.name ?? "").trim().slice(0, 60);
      if (name.length < 3) return json({ error: "Der Name braucht mindestens 3 Zeichen" }, 400);
      const kind = body.kind === "online" ? "online" : "lan";
      const base = slugify(name);
      const dup = await env.DB.prepare("SELECT slug FROM realms WHERE lower(name) = lower(?)").bind(name).first();
      if (dup) return json({ error: "Einen Realm mit diesem Namen gibt es schon" }, 409);
      let slug = base;
      for (let i = 2; await env.DB.prepare("SELECT slug FROM realms WHERE slug = ?").bind(slug).first(); i++) slug = `${base}-${i}`;
      await env.DB.prepare("INSERT INTO realms (slug, name, kind, createdAt, legacy) VALUES (?, ?, ?, ?, 0)").bind(slug, name, kind, Date.now()).run();
      return json({ slug, name, kind });
    }

    // ---- alles andere gehört einem Realm
    const slug = realmSlug(req, url);
    const row = await env.DB.prepare("SELECT * FROM realms WHERE slug = ?").bind(slug).first<RealmRow>();
    if (!row) return json({ error: "Diesen Realm gibt es nicht (mehr)", realmMissing: true }, 404);
    const info: RealmInfo & { legacy: boolean } = { ...publicRealm(row), legacy: row.legacy === 1 };
    const headers = new Headers(req.headers);
    headers.set("X-Realm-Info", encodeURIComponent(JSON.stringify(info)));
    const stub = env.REALM.get(env.REALM.idFromName(row.slug));
    return stub.fetch(new Request(req, { headers }));
  },
} satisfies ExportedHandler<Env>;
