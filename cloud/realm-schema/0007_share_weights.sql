-- Jeder Einkauf hat feste Teilnehmer mit Gewicht (Tage). Änderungen an der Anwesenheit wirken erst nach „Neu berechnen“.
ALTER TABLE expense_shares ADD COLUMN weight REAL NOT NULL DEFAULT 1;

-- Bisher automatisch verteilte Einkäufe mit ihrer aktuellen Aufteilung festschreiben (Ergebnis bleibt gleich).
-- Ganze LAN: Gewicht = Anwesenheitstage
INSERT OR IGNORE INTO expense_shares (expenseId, memberId, weight)
SELECT e.id, a.memberId, COUNT(*) FROM expenses e
JOIN events ev ON ev.id = e.eventId
JOIN attendance a ON a.eventId = e.eventId AND a.day BETWEEN 1 AND ev.days
WHERE e.day IS NULL AND NOT EXISTS (SELECT 1 FROM expense_shares s WHERE s.expenseId = e.id)
GROUP BY e.id, a.memberId;
-- Ein Tag: alle Anwesenden dieses Tags
INSERT OR IGNORE INTO expense_shares (expenseId, memberId, weight)
SELECT DISTINCT e.id, a.memberId, 1 FROM expenses e
JOIN attendance a ON a.eventId = e.eventId AND a.day = e.day
WHERE e.day IS NOT NULL AND NOT EXISTS (SELECT 1 FROM expense_shares s WHERE s.expenseId = e.id);
-- Ein Tag ohne Anwesende: alle, die irgendwann da sind
INSERT OR IGNORE INTO expense_shares (expenseId, memberId, weight)
SELECT DISTINCT e.id, a.memberId, 1 FROM expenses e
JOIN events ev ON ev.id = e.eventId
JOIN attendance a ON a.eventId = e.eventId AND a.day BETWEEN 1 AND ev.days
WHERE e.day IS NOT NULL AND NOT EXISTS (SELECT 1 FROM expense_shares s WHERE s.expenseId = e.id);
