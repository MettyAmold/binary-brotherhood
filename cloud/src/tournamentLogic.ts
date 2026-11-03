// Reine Turnierlogik ohne Datenbank: Spielpläne für Liga, Swiss und K.o., Tabelle, Weiterrücken im Baum.

export type Format = "league" | "swiss" | "knockout";

export interface MatchSpec { round: number; slot: number; teamA: number | null; teamB: number | null }
export interface MatchRow extends MatchSpec { id: number; scoreA: number | null; scoreB: number | null; status: "pending" | "done" | "bye" }
export interface Standing { teamId: number; played: number; won: number; drawn: number; lost: number; scored: number; conceded: number; diff: number; points: number; buchholz: number }

/** Liga: jeder gegen jeden (Kreismethode); bei ungerader Anzahl setzt pro Runde einer aus. */
export function roundRobin(teamIds: number[]): MatchSpec[] {
  const ids: (number | null)[] = [...teamIds];
  if (ids.length % 2) ids.push(null);
  const n = ids.length, out: MatchSpec[] = [];
  for (let r = 0; r < n - 1; r++) {
    let slot = 0;
    for (let i = 0; i < n / 2; i++) {
      const a = ids[i], b = ids[n - 1 - i];
      if (a != null && b != null) out.push({ round: r + 1, slot: slot++, teamA: r % 2 ? b : a, teamB: r % 2 ? a : b });
    }
    ids.splice(1, 0, ids.pop()!); // alle außer dem ersten rotieren
  }
  return out;
}

/** Tabelle nach Punkten, dann Buchholz (Swiss), Tordifferenz, erzielten Punkten. Freilos zählt als Sieg ohne Tore. */
export function standings(teamIds: number[], matches: MatchRow[], pts = { win: 3, draw: 1 }): Standing[] {
  const s = new Map<number, Standing>(teamIds.map(id => [id, { teamId: id, played: 0, won: 0, drawn: 0, lost: 0, scored: 0, conceded: 0, diff: 0, points: 0, buchholz: 0 }]));
  const opp = new Map<number, number[]>(teamIds.map(id => [id, []]));
  for (const m of matches) {
    if (m.status === "bye") { const t = s.get((m.teamA ?? m.teamB)!); if (t) { t.won++; t.points += pts.win; } continue; }
    if (m.status !== "done" || m.teamA == null || m.teamB == null) continue;
    const a = s.get(m.teamA), b = s.get(m.teamB); if (!a || !b) continue;
    const sa = m.scoreA ?? 0, sb = m.scoreB ?? 0;
    a.played++; b.played++; a.scored += sa; a.conceded += sb; b.scored += sb; b.conceded += sa;
    if (sa > sb) { a.won++; b.lost++; a.points += pts.win; } else if (sb > sa) { b.won++; a.lost++; b.points += pts.win; } else { a.drawn++; b.drawn++; a.points += pts.draw; b.points += pts.draw; }
    opp.get(m.teamA)!.push(m.teamB); opp.get(m.teamB)!.push(m.teamA);
  }
  for (const t of s.values()) { t.diff = t.scored - t.conceded; t.buchholz = (opp.get(t.teamId) ?? []).reduce((n, o) => n + (s.get(o)?.points ?? 0), 0); }
  return [...s.values()].sort((x, y) => y.points - x.points || y.buchholz - x.buchholz || y.diff - x.diff || y.scored - x.scored || x.teamId - y.teamId);
}

/** Empfohlene Swiss-Rundenzahl: aufgerundeter Zweierlogarithmus, mindestens 1, höchstens Teams - 1. */
export const swissRounds = (n: number) => Math.max(1, Math.min(n - 1, Math.ceil(Math.log2(Math.max(2, n)))));

/**
 * Swiss-Paarung für die nächste Runde: nach Tabellenstand sortiert, Gegner möglichst ohne Wiederholung (Backtracking),
 * Freilos an den Tabellenletzten, der noch keines hatte.
 */
export function swissPairing(teamIds: number[], matches: MatchRow[], round: number): MatchSpec[] {
  const table = standings(teamIds, matches).map(s => s.teamId);
  const played = new Set<string>();
  const hadBye = new Set<number>();
  for (const m of matches) {
    if (m.status === "bye") hadBye.add((m.teamA ?? m.teamB)!);
    if (m.teamA != null && m.teamB != null) { played.add(`${m.teamA}-${m.teamB}`); played.add(`${m.teamB}-${m.teamA}`); }
  }
  let pool = [...table];
  const out: MatchSpec[] = [];
  if (pool.length % 2) {
    const bye = [...pool].reverse().find(t => !hadBye.has(t)) ?? pool[pool.length - 1];
    pool = pool.filter(t => t !== bye);
    out.push({ round, slot: Math.floor(pool.length / 2), teamA: bye, teamB: null });
  }
  const pair = (rest: number[]): [number, number][] | null => {
    if (!rest.length) return [];
    const [a, ...others] = rest;
    for (let i = 0; i < others.length; i++) {
      if (played.has(`${a}-${others[i]}`)) continue;
      const sub = pair(others.filter((_, j) => j !== i));
      if (sub) return [[a, others[i]], ...sub];
    }
    return null;
  };
  // Ohne Wiederholung nicht lösbar (sehr viele Runden) → Wiederholungen zulassen, Reihenfolge bleibt
  const pairs = pair(pool) ?? pool.reduce<[number, number][]>((acc, t, i) => (i % 2 ? acc : [...acc, [t, pool[i + 1]]]), []);
  pairs.forEach(([a, b], i) => out.push({ round, slot: i, teamA: a, teamB: b }));
  return out.sort((x, y) => x.slot - y.slot);
}

/** Setzreihenfolge für einen Baum der Größe n (Zweierpotenz): 1 trifft n, 2 trifft n-1 … erst im Finale. */
export function seedOrder(n: number): number[] {
  let order = [1, 2];
  while (order.length < n) { const len = order.length * 2; order = order.flatMap(x => [x, len + 1 - x]); }
  return order;
}

/** K.o.-Baum: alle Runden vorab, Runde 1 nach Setzliste befüllt, leere Plätze sind Freilose. */
export function knockoutBracket(seededTeamIds: number[]): MatchSpec[] {
  const n = seededTeamIds.length;
  if (n < 2) return [];
  const size = 2 ** Math.ceil(Math.log2(n));
  const order = seedOrder(size);
  const rounds = Math.log2(size);
  const out: MatchSpec[] = [];
  for (let i = 0; i < size / 2; i++) {
    const a = order[2 * i], b = order[2 * i + 1];
    out.push({ round: 1, slot: i, teamA: seededTeamIds[a - 1] ?? null, teamB: seededTeamIds[b - 1] ?? null });
  }
  for (let r = 2; r <= rounds; r++) for (let i = 0; i < size / 2 ** r; i++) out.push({ round: r, slot: i, teamA: null, teamB: null });
  return out;
}

/** Ziel im Baum für den Sieger von (round, slot). */
export const nextSlot = (round: number, slot: number) => ({ round: round + 1, slot: Math.floor(slot / 2), side: slot % 2 === 0 ? "A" as const : "B" as const });

export const roundName = (round: number, totalRounds: number) => {
  const left = totalRounds - round;
  return left === 0 ? "Finale" : left === 1 ? "Halbfinale" : left === 2 ? "Viertelfinale" : left === 3 ? "Achtelfinale" : `Runde ${round}`;
};
