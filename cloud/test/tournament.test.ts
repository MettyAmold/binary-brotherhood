import { roundRobin, standings, swissPairing, knockoutBracket, seedOrder, nextSlot, swissRounds, type MatchRow } from "../src/tournamentLogic.ts";
import assert from "node:assert/strict";

let ok = 0; const t = (name: string, fn: () => void) => { fn(); ok++; console.log("✓", name); };

t("Liga 4 Teams: 3 Runden, 6 Spiele, jeder gegen jeden einmal", () => {
  const m = roundRobin([1, 2, 3, 4]);
  assert.equal(m.length, 6); assert.equal(Math.max(...m.map(x => x.round)), 3);
  const pairs = new Set(m.map(x => [x.teamA, x.teamB].sort().join("-"))); assert.equal(pairs.size, 6);
  for (let r = 1; r <= 3; r++) { const ids = m.filter(x => x.round === r).flatMap(x => [x.teamA, x.teamB]); assert.equal(new Set(ids).size, 4); }
});
t("Liga 5 Teams: 10 Spiele, pro Runde setzt einer aus", () => {
  const m = roundRobin([1, 2, 3, 4, 5]); assert.equal(m.length, 10); assert.equal(Math.max(...m.map(x => x.round)), 5);
  assert.equal(new Set(m.map(x => [x.teamA, x.teamB].sort().join("-"))).size, 10);
});
t("Tabelle: Punkte, Unentschieden, Tordifferenz", () => {
  const rows: MatchRow[] = [
    { id: 1, round: 1, slot: 0, teamA: 1, teamB: 2, scoreA: 3, scoreB: 1, status: "done" },
    { id: 2, round: 1, slot: 1, teamA: 3, teamB: 4, scoreA: 2, scoreB: 2, status: "done" },
  ];
  const s = standings([1, 2, 3, 4], rows);
  assert.equal(s[0].teamId, 1); assert.equal(s[0].points, 3); assert.equal(s[0].diff, 2);
  assert.equal(s.find(x => x.teamId === 3)!.points, 1); assert.equal(s[s.length - 1].teamId, 2);
});
t("Swiss: Runde 2 ohne Wiederholung, Freilos bei ungerader Zahl nur einmal", () => {
  const teams = [1, 2, 3, 4, 5];
  const r1 = swissPairing(teams, [], 1);
  assert.equal(r1.filter(x => x.teamB == null).length, 1);
  let id = 1;
  const done: MatchRow[] = r1.map(x => ({ ...x, id: id++, scoreA: x.teamB == null ? null : 1, scoreB: x.teamB == null ? null : 0, status: x.teamB == null ? "bye" : "done" }));
  const r2 = swissPairing(teams, done, 2);
  const firstBye = r1.find(x => x.teamB == null)!.teamA;
  assert.notEqual(r2.find(x => x.teamB == null)!.teamA, firstBye);
  const playedBefore = new Set(done.filter(x => x.teamB != null).map(x => [x.teamA, x.teamB].sort().join("-")));
  for (const m of r2.filter(x => x.teamB != null)) assert.ok(!playedBefore.has([m.teamA, m.teamB].sort().join("-")));
  assert.equal(swissRounds(5), 3); assert.equal(swissRounds(8), 3); assert.equal(swissRounds(2), 1);
});
t("K.o.: Setzliste 8 und Baum für 6 Teams mit 2 Freilosen", () => {
  assert.deepEqual(seedOrder(8), [1, 8, 4, 5, 2, 7, 3, 6]);
  const b = knockoutBracket([11, 12, 13, 14, 15, 16]);
  assert.equal(b.filter(x => x.round === 1).length, 4); assert.equal(b.filter(x => x.round === 2).length, 2); assert.equal(b.filter(x => x.round === 3).length, 1);
  const byes = b.filter(x => x.round === 1 && (x.teamA == null || x.teamB == null));
  assert.equal(byes.length, 2); assert.deepEqual(byes.map(x => x.teamA).sort(), [11, 12]); // Top-Setzungen bekommen die Freilose
  assert.deepEqual(nextSlot(1, 3), { round: 2, slot: 1, side: "B" });
});
console.log(`${ok} Tests grün`);
