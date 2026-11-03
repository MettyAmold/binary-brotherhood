// Realmübergreifende Konten in D1: Name + Passwort gelten überall, Profil (Name, Farbe, Motto, Avatar) ebenso.
// XP, Level und Realm-Admin-Rechte verwaltet jeder Realm selbst. Super-Admins dürfen alles in allen Realms.
import { Env } from "./db";
import { hashPassword, verifyPassword, sha256Hex, validatePassword } from "./auth";
import { BadRequest, NotFound, Unauthorized } from "./logic";

export interface UserRow { id: number; name: string; password: string; color: string; motto: string; avatarUpdatedAt: number | null; isSuperAdmin: number; createdAt: number }
/** Was der Worker dem Realm-Objekt über den Anfragenden mitteilt (Header X-Auth). */
export interface AuthInfo { userId: number; name: string; superAdmin: boolean }

const USER_COLS = "id, name, password, color, motto, avatarUpdatedAt, isSuperAdmin, createdAt";
const PALETTE = ["#C9A24D", "#D96C4F", "#4FA3D9", "#6BBF59", "#B05ED9", "#E0B04C", "#48C9B0", "#E05C8A", "#8E9BFF", "#F08A24", "#5DD39E", "#D64545"];
const b64url = (buf: Uint8Array) => btoa(String.fromCharCode(...buf)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export const userDto = (u: UserRow) => ({ id: u.id, name: u.name, color: u.color, motto: u.motto, hasAvatar: u.avatarUpdatedAt != null, isSuperAdmin: u.isSuperAdmin === 1, hasPassword: !!u.password });

export class Accounts {
  constructor(private env: Env) {}
  private get d1() { return this.env.DB; }

  async user(id: number) { return this.d1.prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?`).bind(id).first<UserRow>(); }
  async userByName(name: string) { return this.d1.prepare(`SELECT ${USER_COLS} FROM users WHERE name = ? COLLATE NOCASE`).bind(name.trim()).first<UserRow>(); }

  async resolve(token: string | null): Promise<{ user: UserRow; tokenHash: string } | null> {
    if (!token) return null;
    const hash = await sha256Hex(token);
    const t = await this.d1.prepare("SELECT userId, lastUsedAt FROM user_tokens WHERE tokenHash = ?").bind(hash).first<{ userId: number; lastUsedAt: number }>();
    if (!t) return null;
    const user = await this.user(t.userId);
    if (!user) { await this.d1.prepare("DELETE FROM user_tokens WHERE tokenHash = ?").bind(hash).run(); return null; }
    if (Date.now() - t.lastUsedAt > 10 * 60_000) await this.d1.prepare("UPDATE user_tokens SET lastUsedAt = ? WHERE tokenHash = ?").bind(Date.now(), hash).run();
    return { user, tokenHash: hash };
  }

  async issueToken(userId: number, device: string) {
    const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
    await this.d1.prepare("INSERT INTO user_tokens (tokenHash, userId, device, createdAt, lastUsedAt) VALUES (?, ?, ?, ?, ?)").bind(await sha256Hex(token), userId, device.slice(0, 120), Date.now(), Date.now()).run();
    return token;
  }

  async register(name: string, password: string) {
    name = String(name ?? "").trim();
    if (name.length < 2 || name.length > 40) throw new BadRequest("Der Name braucht 2 bis 40 Zeichen");
    validatePassword(password);
    if (await this.userByName(name)) throw new BadRequest("Den Namen gibt es schon. Wenn das dein Konto ist: anmelden.");
    const r = await this.d1.prepare("INSERT INTO users (name, password, color, createdAt) VALUES (?, ?, ?, ?)")
      .bind(name, await hashPassword(password), PALETTE[Math.floor(Math.random() * PALETTE.length)], Date.now()).run();
    return (await this.user(Number(r.meta.last_row_id)))!;
  }

  /** Konten ohne Passwort (aus der Zeit vor den Passwörtern) legen es beim ersten Login fest. */
  async login(name: string, password: string) {
    const u = await this.userByName(String(name ?? ""));
    if (!u) throw new Unauthorized("Name oder Passwort falsch");
    if (!u.password) {
      validatePassword(password);
      await this.d1.prepare("UPDATE users SET password = ? WHERE id = ?").bind(await hashPassword(password), u.id).run();
    } else if (!(await verifyPassword(String(password ?? ""), u.password))) throw new Unauthorized("Name oder Passwort falsch");
    return u;
  }

  async changePassword(userId: number, oldPw: string, newPw: string) {
    const u = await this.user(userId);
    if (!u) throw new NotFound("Konto nicht gefunden");
    if (u.password && !(await verifyPassword(oldPw, u.password))) throw new Unauthorized("Altes Passwort ist falsch");
    validatePassword(newPw);
    await this.d1.batch([
      this.d1.prepare("UPDATE users SET password = ? WHERE id = ?").bind(await hashPassword(newPw), userId),
      this.d1.prepare("DELETE FROM user_tokens WHERE userId = ?").bind(userId),
    ]);
  }

  async resetPassword(userId: number) {
    await this.d1.batch([
      this.d1.prepare("UPDATE users SET password = '' WHERE id = ?").bind(userId),
      this.d1.prepare("DELETE FROM user_tokens WHERE userId = ?").bind(userId),
    ]);
  }

  async logout(tokenHash: string) { await this.d1.prepare("DELETE FROM user_tokens WHERE tokenHash = ?").bind(tokenHash).run(); }

  /** Realms, in denen das Konto Mitglied ist. */
  async realmsOf(userId: number) {
    return (await this.d1.prepare("SELECT r.slug, r.name, r.kind, rm.memberId FROM realm_members rm JOIN realms r ON r.slug = rm.realmSlug WHERE rm.userId = ? ORDER BY r.legacy DESC, r.name COLLATE NOCASE").bind(userId).all<{ slug: string; name: string; kind: string; memberId: number }>()).results ?? [];
  }

  async avatar(userId: number) {
    const r = await this.d1.prepare("SELECT avatar FROM users WHERE id = ?").bind(userId).first<{ avatar: ArrayBuffer | number[] | null }>();
    return r?.avatar ?? null;
  }
}
