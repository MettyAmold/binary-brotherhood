// Reine Geschäftslogik ohne Datenbank: XP-Regeln, Level, Kostenaufteilung, Freigabe-Pfade.
// 1:1-Port von domain/Xp.kt, domain/Costs.kt und domain/ShareScanner.kt der Android-App.

export const XP = {
  GAME_PLAYED: "game_played", GAME_ADDED: "game_added", SUGGESTION_CREATED: "suggestion", SUGGESTION_ADOPTED: "suggestion_adopted",
  FORUM_POST: "forum_post", FORUM_COMMENT: "forum_comment", SUGGESTION_COMMENT: "suggestion_comment", EQUIPMENT_BROUGHT: "equipment",
  EXPENSE_PAID: "expense", ATTENDANCE: "attendance", VOTE: "vote", TOURNAMENT_WIN: "tournament_win",
} as const;

const XP_AMOUNT: Record<string, number> = {
  game_played: 50, game_added: 20, suggestion: 15, suggestion_adopted: 40, forum_post: 10, forum_comment: 5,
  suggestion_comment: 5, equipment: 25, expense: 15, attendance: 30, vote: 5, tournament_win: 100,
};
const XP_LABEL: Record<string, string> = {
  game_played: "Spiel gespielt", game_added: "Spiel hinzugefügt", suggestion: "Vorschlag eingereicht", suggestion_adopted: "Vorschlag übernommen",
  forum_post: "Forum-Beitrag", forum_comment: "Forum-Kommentar", suggestion_comment: "Kommentar zu Vorschlag", equipment: "Ausrüstung mitgebracht",
  expense: "Einkauf vorgestreckt", attendance: "Anwesenheitstag", vote: "Abgestimmt", tournament_win: "Turnier gewonnen",
};
export const xpAmount = (type: string) => XP_AMOUNT[type] ?? 0;
export const xpLabel = (type: string) => XP_LABEL[type] ?? type;

export interface LevelInfo { level: number; rank: string; xp: number; xpForCurrentLevel: number; xpForNextLevel: number; progress: number }

const RANKS: [number, string][] = [[1, "Novize"], [3, "Laienbruder"], [5, "Bruder"], [8, "Mönch"], [11, "Prior"], [15, "Abt"], [20, "Erzabt"], [26, "Großmeister"], [33, "Binärer Erleuchteter"]];
export const thresholdFor = (level: number) => (level <= 1 ? 0 : 50 * (level - 1) * level);
export const rankFor = (level: number) => [...RANKS].reverse().find(([l]) => level >= l)![1];
export function levelForXp(xp: number): LevelInfo {
  let level = 1;
  while (thresholdFor(level + 1) <= xp) level++;
  const cur = thresholdFor(level), next = thresholdFor(level + 1);
  const progress = next > cur ? (xp - cur) / (next - cur) : 1;
  return { level, rank: rankFor(level), xp, xpForCurrentLevel: cur, xpForNextLevel: next, progress: Math.min(1, Math.max(0, progress)) };
}

// ---------- Kosten ----------
export interface ExpenseInput { id: number; amountCents: number; paidById: number; day: number | null; explicitParticipants: number[] }
export interface PaymentInput { fromId: number; toId: number; amountCents: number }
export interface ShareResult { memberId: number; cents: number }
export interface MemberBalance { memberId: number; paidCents: number; owedCents: number; settledOutCents: number; settledInCents: number; netCents: number }
export interface Transfer { fromId: number; toId: number; cents: number }
export interface CostSummary { totalCents: number; balances: MemberBalance[]; transfers: Transfer[]; shares: Map<number, ShareResult[]> }

/** Teilt einen Einkauf fair auf: explizite Teilnehmer gleich, Tages-Einkauf unter Anwesenden des Tags, ganze LAN nach Anwesenheitstagen gewichtet. */
export function splitExpense(e: ExpenseInput, attendance: Map<number, Set<number>>, allMemberIds: number[]): ShareResult[] {
  let weights = new Map<number, number>();
  if (e.explicitParticipants.length) {
    e.explicitParticipants.forEach(id => weights.set(id, 1));
  } else if (e.day != null) {
    const present = [...attendance.entries()].filter(([, days]) => days.has(e.day!)).map(([id]) => id);
    const any = [...attendance.entries()].filter(([, days]) => days.size > 0).map(([id]) => id);
    const base = present.length ? present : any.length ? any : [e.paidById];
    base.forEach(id => weights.set(id, 1));
  } else {
    [...attendance.entries()].filter(([, days]) => days.size > 0).forEach(([id, days]) => weights.set(id, days.size));
    if (!weights.size) weights.set(e.paidById, 1);
  }
  weights = new Map([...weights].filter(([id]) => allMemberIds.includes(id) || id === e.paidById));
  const total = [...weights.values()].reduce((a, b) => a + b, 0);
  if (total <= 0) return [{ memberId: e.paidById, cents: e.amountCents }];
  const ordered = [...weights.entries()].sort((a, b) => a[0] - b[0]);
  const raw = ordered.map(([id, w]) => [id, (e.amountCents * w) / total] as [number, number]);
  const floored = raw.map(([id, v]) => [id, Math.floor(v)] as [number, number]);
  let rest = e.amountCents - floored.reduce((a, [, v]) => a + v, 0);
  const byFraction = raw.map((_, i) => i).sort((a, b) => (raw[b][1] - Math.floor(raw[b][1])) - (raw[a][1] - Math.floor(raw[a][1])));
  let i = 0;
  while (rest > 0 && byFraction.length) { const idx = byFraction[i % byFraction.length]; floored[idx][1]++; rest--; i++; }
  return floored.map(([memberId, cents]) => ({ memberId, cents }));
}

export function summarizeCosts(memberIds: number[], expenses: ExpenseInput[], payments: PaymentInput[], attendance: Map<number, Set<number>>): CostSummary {
  const paid = new Map<number, number>(), owed = new Map<number, number>(), out = new Map<number, number>(), inn = new Map<number, number>();
  const add = (m: Map<number, number>, k: number, v: number) => m.set(k, (m.get(k) ?? 0) + v);
  const shares = new Map<number, ShareResult[]>();
  for (const e of expenses) {
    add(paid, e.paidById, e.amountCents);
    const s = splitExpense(e, attendance, memberIds);
    shares.set(e.id, s);
    for (const sh of s) add(owed, sh.memberId, sh.cents);
  }
  for (const p of payments) { add(out, p.fromId, p.amountCents); add(inn, p.toId, p.amountCents); }
  const ids = [...new Set([...memberIds, ...paid.keys(), ...owed.keys(), ...out.keys(), ...inn.keys()])];
  const balances: MemberBalance[] = ids.map(id => {
    const b = { memberId: id, paidCents: paid.get(id) ?? 0, owedCents: owed.get(id) ?? 0, settledOutCents: out.get(id) ?? 0, settledInCents: inn.get(id) ?? 0, netCents: 0 };
    b.netCents = b.paidCents - b.owedCents + b.settledOutCents - b.settledInCents;
    return b;
  });
  return { totalCents: expenses.reduce((a, e) => a + e.amountCents, 0), balances, transfers: settle(balances), shares };
}

/** Greedy-Ausgleich: größter Schuldner zahlt an größten Gläubiger. */
export function settle(balances: MemberBalance[]): Transfer[] {
  const creditors = balances.filter(b => b.netCents > 0).map(b => [b.memberId, b.netCents] as [number, number]).sort((a, b) => b[1] - a[1]);
  const debtors = balances.filter(b => b.netCents < 0).map(b => [b.memberId, -b.netCents] as [number, number]).sort((a, b) => b[1] - a[1]);
  const result: Transfer[] = [];
  let ci = 0, di = 0;
  while (ci < creditors.length && di < debtors.length) {
    const amt = Math.min(creditors[ci][1], debtors[di][1]);
    if (amt > 0) result.push({ fromId: debtors[di][0], toId: creditors[ci][0], cents: amt });
    creditors[ci][1] -= amt; debtors[di][1] -= amt;
    if (creditors[ci][1] === 0) ci++;
    if (debtors[di][1] === 0) di++;
  }
  return result;
}

// ---------- Freigaben ----------
export function parseUnc(input: string): { host: string; share: string; segments: string[] } {
  const s = input.trim().replace(/^smb:/i, "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!s) throw new BadRequest("Pfad fehlt");
  const parts = s.split("/").filter(Boolean);
  if (parts.length < 2) throw new BadRequest("Pfad muss Rechner und Freigabe enthalten, z. B. \\\\192.168.0.10\\Spiele");
  if (/[:\s]/.test(parts[0])) throw new BadRequest("Ungültiger Rechnername");
  return { host: parts[0], share: parts[1], segments: parts.slice(2) };
}
export const normalizeUnc = (input: string) => { const p = parseUnc(input); return ["\\\\" + p.host, p.share, ...p.segments].join("\\"); };
const SYSTEM_FOLDERS = new Set(["system volume information", "$recycle.bin", "recycler", "found.000", "windows", "program files", "program files (x86)"]);
export const isGameFolder = (name: string) => { const n = name.trim(); return !!n && !/^[.$_~]/.test(n) && !SYSTEM_FOLDERS.has(n.toLowerCase()); };
export const gameKey = (name: string) => name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
export const displayName = (folder: string) => folder.replace(/[_.]+/g, " ").replace(/\s+/g, " ").trim();

// ---------- Fehler ----------
export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
export class BadRequest extends HttpError { constructor(m: string) { super(400, m); } }
export class NotFound extends HttpError { constructor(m: string) { super(404, m); } }
export class Unauthorized extends HttpError { constructor(m = "Bitte anmelden") { super(401, m); } }
export class Forbidden extends HttpError { constructor(m = "Keine Berechtigung") { super(403, m); } }
