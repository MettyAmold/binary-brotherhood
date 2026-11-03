// Passwörter (PBKDF2-HMAC-SHA256 über WebCrypto) und Geräte-Tokens, kompatibel zum Format der Android-App
// ("pbkdf2:<Iterationen>:<Salt-Base64>:<Hash-Base64>"), damit exportierte Hashes weiter gelten.
import { Db, now } from "./db";
import { BadRequest, NotFound, Unauthorized } from "./logic";

// Workers (Free-Tarif) haben wenig CPU-Zeit pro Aufruf; 20.000 Iterationen reichen für eine LAN-Party-App.
const ITERATIONS = 20_000;

const b64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const b64url = (buf: Uint8Array) => b64(buf).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations }, key, 256);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2:${ITERATIONS}:${b64(salt)}:${b64(await pbkdf2(password, salt, ITERATIONS))}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(":");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number(parts[1]);
  if (!iterations) return false;
  const expected = unb64(parts[3]);
  const got = new Uint8Array(await pbkdf2(password, unb64(parts[2]), iterations));
  if (got.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ expected[i];
  return diff === 0;
}

export async function sha256Hex(s: string): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export function validatePassword(pw: string) {
  if (!pw || pw.length < 4) throw new BadRequest("Passwort muss mindestens 4 Zeichen haben");
  if (pw.length > 128) throw new BadRequest("Passwort ist zu lang");
}

export interface MemberRow { id: number; name: string; motto: string; color: string; hasAvatar: number; createdAt: number; password: string; isAdmin: number; avatarUpdatedAt: number | null }
export interface Session { member: MemberRow; tokenHash: string }

export async function resolveSession(db: Db, token: string | null): Promise<Session | null> {
  if (!token) return null;
  const hash = await sha256Hex(token);
  const t = await db.first<{ memberId: number; lastUsedAt: number }>("SELECT memberId, lastUsedAt FROM auth_tokens WHERE tokenHash = ?", hash);
  if (!t) return null;
  const member = await db.first<MemberRow>("SELECT id, name, motto, color, hasAvatar, createdAt, password, isAdmin, avatarUpdatedAt FROM members WHERE id = ?", t.memberId);
  if (!member) { await db.run("DELETE FROM auth_tokens WHERE tokenHash = ?", hash); return null; }
  if (now() - t.lastUsedAt > 10 * 60_000) await db.run("UPDATE auth_tokens SET lastUsedAt = ? WHERE tokenHash = ?", now(), hash);
  return { member, tokenHash: hash };
}

export async function issueToken(db: Db, memberId: number, device: string): Promise<string> {
  const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
  await db.run("INSERT INTO auth_tokens (tokenHash, memberId, device, createdAt, lastUsedAt) VALUES (?, ?, ?, ?, ?)", await sha256Hex(token), memberId, device.slice(0, 120), now(), now());
  return token;
}

/** Login; Profile ohne Passwort legen es beim ersten Login fest. */
export async function login(db: Db, memberId: number, password: string): Promise<MemberRow> {
  const m = await db.first<MemberRow>("SELECT * FROM members WHERE id = ?", memberId);
  if (!m) throw new NotFound("Profil nicht gefunden");
  if (!m.password) {
    validatePassword(password);
    await db.run("UPDATE members SET password = ? WHERE id = ?", await hashPassword(password), m.id);
  } else if (!(await verifyPassword(password, m.password))) {
    throw new Unauthorized("Falsches Passwort");
  }
  return m;
}

export async function changePassword(db: Db, memberId: number, oldPw: string, newPw: string) {
  const m = await db.first<MemberRow>("SELECT * FROM members WHERE id = ?", memberId);
  if (!m) throw new NotFound("Profil nicht gefunden");
  if (m.password && !(await verifyPassword(oldPw, m.password))) throw new Unauthorized("Altes Passwort ist falsch");
  validatePassword(newPw);
  await db.run("UPDATE members SET password = ? WHERE id = ?", await hashPassword(newPw), memberId);
  await db.run("DELETE FROM auth_tokens WHERE memberId = ?", memberId);
}

export async function resetPassword(db: Db, memberId: number) {
  await db.run("UPDATE members SET password = '' WHERE id = ?", memberId);
  await db.run("DELETE FROM auth_tokens WHERE memberId = ?", memberId);
}

export const randomCode = (n = 8) => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return [...crypto.getRandomValues(new Uint8Array(n))].map(b => chars[b % chars.length]).join("");
};
