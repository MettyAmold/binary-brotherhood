import { splitExpense } from "../src/logic.ts";
import assert from "node:assert/strict";

let ok = 0; const t = (name: string, fn: () => void) => { fn(); ok++; console.log("✓", name); };
// Mitglied 2 ist nur am ersten Tag da (frühere Abreise)
const att = new Map([[1, new Set([1, 2, 3])], [2, new Set([1])], [3, new Set([1, 2, 3])]]);
const cents = (r: { memberId: number; cents: number }[]) => Object.fromEntries(r.map(s => [s.memberId, s.cents]));

t("Ganze LAN: nach Anwesenheitstagen gewichtet", () => {
  assert.deepEqual(cents(splitExpense({ id: 1, amountCents: 700, paidById: 1, day: null, explicitParticipants: [] }, att, [1, 2, 3])), { 1: 300, 2: 100, 3: 300 });
});
t("Individuell: Tage je Teilnehmer als Gewicht", () => {
  const r = splitExpense({ id: 1, amountCents: 6000, paidById: 1, day: null, explicitParticipants: [{ memberId: 1, weight: 3 }, { memberId: 2, weight: 1 }, { memberId: 3, weight: 2 }] }, att, [1, 2, 3]);
  assert.deepEqual(cents(r), { 1: 3000, 2: 1000, 3: 2000 });
});
t("Individuell: halbe Tage, 0 Tage zahlt nichts, Summe stimmt", () => {
  const r = splitExpense({ id: 1, amountCents: 1001, paidById: 1, day: null, explicitParticipants: [{ memberId: 1, weight: 1.5 }, { memberId: 2, weight: 0 }, { memberId: 3, weight: 0.5 }] }, att, [1, 2, 3]);
  assert.equal(r.find(s => s.memberId === 2), undefined);
  assert.equal(r.reduce((a, s) => a + s.cents, 0), 1001);
  assert.deepEqual(cents(r), { 1: 751, 3: 250 });
});
t("Individuell: gleiche Gewichte wie bisher = gleich verteilt", () => {
  assert.deepEqual(cents(splitExpense({ id: 1, amountCents: 900, paidById: 1, day: null, explicitParticipants: [{ memberId: 1, weight: 1 }, { memberId: 2, weight: 1 }, { memberId: 3, weight: 1 }] }, att, [1, 2, 3])), { 1: 300, 2: 300, 3: 300 });
});
console.log(`${ok} Tests grün`);
