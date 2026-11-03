// Aufrufe vom Worker oder von einem Realm an das Durable Object eines (anderen) Realms.
import { Env } from "./db";
import type { RealmInfo } from "./api";
import type { AuthInfo } from "./accounts";

export interface RealmRow { slug: string; name: string; kind: string; createdAt: number; legacy: number }
export const publicRealm = (r: RealmRow): RealmInfo => ({ slug: r.slug, name: r.name, kind: r.kind === "online" ? "online" : "lan" });
export const realmRow = (env: Env, slug: string) => env.DB.prepare("SELECT * FROM realms WHERE slug = ?").bind(slug).first<RealmRow>();

/** Header, mit denen das Realm-Objekt weiß, welcher Realm es ist und wer anfragt. Client-Header werden überschrieben. */
export function realmHeaders(base: HeadersInit | undefined, row: RealmRow, auth: AuthInfo | null) {
  const headers = new Headers(base);
  headers.set("X-Realm-Info", encodeURIComponent(JSON.stringify({ ...publicRealm(row), legacy: row.legacy === 1 })));
  headers.delete("X-Auth");
  if (auth) headers.set("X-Auth", encodeURIComponent(JSON.stringify(auth)));
  return headers;
}

export const realmStub = (env: Env, slug: string) => env.REALM.get(env.REALM.idFromName(slug));

/** Interner Aufruf (POST /internal/...) mit JSON-Antwort; wirft bei Fehlern mit der Meldung des Realms. */
export async function callRealm<T = any>(env: Env, slug: string, path: string, body: unknown = {}, auth: AuthInfo | null = null): Promise<T> {
  const row = await realmRow(env, slug);
  if (!row) throw new Error("Realm nicht gefunden");
  const res = await realmStub(env, slug).fetch(`https://realm/internal/${path}`, { method: "POST", headers: realmHeaders({ "Content-Type": "application/json" }, row, auth), body: JSON.stringify(body) });
  const data = await res.json<any>().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || `Realm-Fehler ${res.status}`) as Error & { status?: number }; e.status = res.status; throw e; }
  return data as T;
}
