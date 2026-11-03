// Verbindung zwischen Realm-Profilen (members) und Konten (D1 users): Übernahme des Bestands, Beitritt,
// Profil-Abgleich in alle Realms des Kontos.
import { Db, Env, now } from "./db";
import type { RealmInfo } from "./api";
import { BadRequest, Forbidden } from "./logic";
import { toBytes } from "./repo";
import { callRealm } from "./realmClient";

interface MemberFull { id: number; name: string; password: string; color: string; motto: string; avatar: ArrayBuffer | null; hasAvatar: number; avatarUpdatedAt: number | null; isAdmin: number; createdAt: number; userId: number | null }

async function freeName(env: Env, wanted: string, realmName: string) {
  const taken = async (n: string) => !!(await env.DB.prepare("SELECT id FROM users WHERE name = ? COLLATE NOCASE").bind(n).first());
  if (!(await taken(wanted))) return wanted;
  for (let i = 1; ; i++) {
    const n = `${wanted.slice(0, 24)} (${i === 1 ? realmName.slice(0, 12) : `${realmName.slice(0, 9)} ${i}`})`;
    if (!(await taken(n))) return n;
  }
}

/**
 * Jedes Realm-Profil ohne Konto bekommt eins (Passwort-Hash, Farbe, Motto, Avatar und Logins werden übernommen).
 * Im ersten Realm werden Admins zu Super-Admins. Läuft nach Import/Zusammenführen erneut.
 */
export async function linkUsers(db: Db, env: Env, realm: RealmInfo & { legacy?: boolean }) {
  const members = await db.all<MemberFull>("SELECT * FROM members WHERE userId IS NULL ORDER BY id");
  for (const m of members) {
    // Nach einem Import: gleicher Name war schon Mitglied dieses Realms → gleiches Konto
    let user = await env.DB.prepare("SELECT u.id, u.name FROM realm_members rm JOIN users u ON u.id = rm.userId WHERE rm.realmSlug = ? AND u.name = ? COLLATE NOCASE")
      .bind(realm.slug, m.name).first<{ id: number; name: string }>();
    if (!user) {
      const name = await freeName(env, m.name, realm.name);
      const avatar = m.hasAvatar && m.avatar ? toBytes(m.avatar) : null;
      const r = await env.DB.prepare("INSERT INTO users (name, password, color, motto, avatar, avatarUpdatedAt, isSuperAdmin, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(name, m.password ?? "", m.color, m.motto ?? "", avatar, avatar ? (m.avatarUpdatedAt ?? m.createdAt) : null, realm.legacy && m.isAdmin === 1 ? 1 : 0, m.createdAt ?? now()).run();
      user = { id: Number(r.meta.last_row_id), name };
    }
    await env.DB.prepare("INSERT OR REPLACE INTO realm_members (realmSlug, userId, memberId, joinedAt) VALUES (?, ?, ?, ?)").bind(realm.slug, user.id, m.id, m.createdAt ?? now()).run();
    await db.run("UPDATE members SET userId = ?, name = ? WHERE id = ?", user.id, user.name, m.id);
    // laufende Logins mitnehmen, damit niemand neu anmelden muss
    const tokens = await db.all<{ tokenHash: string; device: string; createdAt: number; lastUsedAt: number }>("SELECT * FROM auth_tokens WHERE memberId = ?", m.id);
    if (tokens.length) await env.DB.batch(tokens.map(t => env.DB.prepare("INSERT OR IGNORE INTO user_tokens (tokenHash, userId, device, createdAt, lastUsedAt) VALUES (?, ?, ?, ?, ?)").bind(t.tokenHash, user!.id, t.device, t.createdAt, t.lastUsedAt)));
  }
  // Einträge für Profile, die es im Realm nicht mehr gibt, entfernen
  const ids = (await db.all<{ id: number }>("SELECT id FROM members")).map(r => r.id);
  const rows = (await env.DB.prepare("SELECT userId, memberId FROM realm_members WHERE realmSlug = ?").bind(realm.slug).all<{ userId: number; memberId: number }>()).results ?? [];
  const stale = rows.filter(r => !ids.includes(r.memberId));
  if (stale.length) await env.DB.batch(stale.map(r => env.DB.prepare("DELETE FROM realm_members WHERE realmSlug = ? AND userId = ?").bind(realm.slug, r.userId)));
  return { linked: members.length };
}

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
