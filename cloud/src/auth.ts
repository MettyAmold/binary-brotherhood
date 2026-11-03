// Passwörter (PBKDF2-HMAC-SHA256 über WebCrypto) und Geräte-Tokens, kompatibel zum Format der Android-App
// ("pbkdf2:<Iterationen>:<Salt-Base64>:<Hash-Base64>"), damit exportierte Hashes weiter gelten.
import { Db, now } from "./db";
import { BadRequest } from "./logic";

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
export interface Session { member: MemberRow; auth: { userId: number; name: string; superAdmin: boolean } }

/** Realm-Profil des angemeldeten Kontos (der Worker hat das Token bereits geprüft). */
export async function resolveMember(db: Db, auth: Session["auth"] | null): Promise<Session | null> {
  if (!auth) return null;
  const member = await db.first<MemberRow>("SELECT id, name, motto, color, hasAvatar, createdAt, password, isAdmin, avatarUpdatedAt FROM members WHERE userId = ?", auth.userId);
  return member ? { member, auth } : null;
}

export const randomCode = (n = 8) => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return [...crypto.getRandomValues(new Uint8Array(n))].map(b => chars[b % chars.length]).join("");
};
