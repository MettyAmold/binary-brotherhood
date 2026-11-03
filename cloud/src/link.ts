// Verbindung zwischen Realm-Profilen (members) und Konten (D1 users): Beitritt und Profil-Abgleich.
import { Db, Env, now } from "./db";
import type { RealmInfo } from "./api";
import { BadRequest, Forbidden } from "./logic";
import { toBytes } from "./repo";
import { callRealm } from "./realmClient";

interface MemberFull { id: number; name: string; color: string; motto: string; avatar: ArrayBuffer | null; hasAvatar: number; avatarUpdatedAt: number | null; isAdmin: number; createdAt: number; userId: number | null }

/** Konto tritt dem Realm bei. Ohne `bypass` ist der Einladungscode nötig (außer für das allererste Profil). */
export async function joinRealm(db: Db, env: Env, realm: RealmInfo, req: { userId: number; inviteCode?: string; bypass?: boolean; admin?: boolean }, inviteCode: () => Promise<string>) {
  const existing = await db.first<{ id: number }>("SELECT id FROM members WHERE userId = ?", req.userId);
  if (existing) return { memberId: existing.id, already: true };
  const u = await env.DB.prepare("SELECT id, name, color, motto, avatar, avatarUpdatedAt FROM users WHERE id = ?").bind(req.userId).first<{ id: number; name: string; color: string; motto: string; avatar: ArrayBuffer | number[] | null; avatarUpdatedAt: number | null }>();
  if (!u) throw new BadRequest("Konto nicht gefunden");
  const count = (await db.first<{ n: number }>("SELECT COUNT(*) AS n FROM members"))!.n;
  if (count > 0 && !req.bypass && String(req.inviteCode ?? "").trim().toUpperCase() !== (await inviteCode())) throw new Forbidden("Einladungscode fehlt oder ist falsch. Frag einen Admin des Realms.");
  let name = u.name;
  for (let i = 2; await db.first("SELECT id FROM members WHERE name = ? COLLATE NOCASE", name); i++) name = `${u.name} ${i}`;
  const avatar = u.avatar ? toBytes(u.avatar) : null;
  const id = await db.insert("INSERT INTO members (name, motto, color, createdAt, isAdmin, userId, avatar, hasAvatar, avatarUpdatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    name, u.motto ?? "", u.color, now(), count === 0 || req.admin ? 1 : 0, u.id, avatar, avatar ? 1 : 0, avatar ? u.avatarUpdatedAt : null);
  await env.DB.prepare("INSERT OR REPLACE INTO realm_members (realmSlug, userId, memberId, joinedAt) VALUES (?, ?, ?, ?)").bind(realm.slug, u.id, id, now()).run();
  return { memberId: id, already: false };
}

/** Profil aus dem Konto übernehmen (nach einer Änderung in einem anderen Realm). */
export async function applyProfile(db: Db, env: Env, userId: number) {
  const u = await env.DB.prepare("SELECT name, color, motto, avatar, avatarUpdatedAt FROM users WHERE id = ?").bind(userId).first<{ name: string; color: string; motto: string; avatar: ArrayBuffer | number[] | null; avatarUpdatedAt: number | null }>();
  if (!u) return false;
  const m = await db.first<{ id: number; avatarUpdatedAt: number | null }>("SELECT id, avatarUpdatedAt FROM members WHERE userId = ?", userId);
  if (!m) return false;
  let name = u.name;
  for (let i = 2; await db.first("SELECT id FROM members WHERE name = ? COLLATE NOCASE AND id != ?", name, m.id); i++) name = `${u.name} ${i}`;
  await db.run("UPDATE members SET name = ?, color = ?, motto = ? WHERE id = ?", name, u.color, u.motto ?? "", m.id);
  if (u.avatarUpdatedAt !== m.avatarUpdatedAt) {
    const avatar = u.avatar ? toBytes(u.avatar) : null;
    await db.run("UPDATE members SET avatar = ?, hasAvatar = ?, avatarUpdatedAt = ? WHERE id = ?", avatar, avatar ? 1 : 0, u.avatarUpdatedAt, m.id);
  }
  return true;
}

/** Nach einer Profiländerung in diesem Realm: Konto aktualisieren und alle anderen Realms des Kontos nachziehen. */
export async function pushProfile(db: Db, env: Env, realm: RealmInfo, memberId: number, withAvatar: boolean) {
  const m = await db.first<MemberFull>("SELECT * FROM members WHERE id = ?", memberId);
  if (!m || !m.userId) return;
  const dup = await env.DB.prepare("SELECT id FROM users WHERE name = ? COLLATE NOCASE AND id != ?").bind(m.name, m.userId).first();
  if (dup) throw new BadRequest("Den Namen hat schon ein anderes Konto");
  await env.DB.prepare("UPDATE users SET name = ?, color = ?, motto = ? WHERE id = ?").bind(m.name, m.color, m.motto ?? "", m.userId).run();
  if (withAvatar) await env.DB.prepare("UPDATE users SET avatar = ?, avatarUpdatedAt = ? WHERE id = ?").bind(m.avatar ? toBytes(m.avatar) : null, m.avatarUpdatedAt, m.userId).run();
  const others = (await env.DB.prepare("SELECT realmSlug FROM realm_members WHERE userId = ? AND realmSlug != ?").bind(m.userId, realm.slug).all<{ realmSlug: string }>()).results ?? [];
  await Promise.all(others.map(o => callRealm(env, o.realmSlug, "profile", { userId: m.userId }).catch(e => console.warn("profile sync", o.realmSlug, e))));
}
