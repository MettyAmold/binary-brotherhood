// Kostenaufteilung à la Splitwise: Anwesenheitstage, Einkäufe, faire Aufteilung, Schulden, Ausgleich.
import { h, mount, modal, confirmDialog, avatar, empty, toast, input, field, select, fmtEuro, parseEuro, dayLabel, fmtDate } from "../ui.js";
import { api } from "../api.js";
import { store, on } from "../store.js";

let tab = "overview";

export async function renderCosts(main, params) {
  if (params[0]) tab = params[0];
  let data = null;
  const content = h("div");
  const tabsEl = h("div", { class: "tabs" });

  const load = async () => { data = await api.get("/api/costs"); draw(); };

  const draw = () => {
    if (!data) return;
    const tabs = [["overview", "Übersicht"], ["expenses", `Einkäufe (${data.expenses.length})`], ["attendance", "Anwesenheit"], ["payments", `Ausgleich (${data.payments.length})`]];
    mount(tabsEl, tabs.map(([id, l]) => h("button", { class: id === tab ? "active" : "", onClick: () => { tab = id; location.hash = `#/costs/${id}`; draw(); } }, l)));
    if (tab === "expenses") mount(content, expensesView());
    else if (tab === "attendance") mount(content, attendanceView());
    else if (tab === "payments") mount(content, paymentsView());
    else mount(content, overview());
  };

  const name = (id) => store.member(id)?.name ?? "Unbekannt";
  const av = (id, s = "sm") => avatar(store.member(id) || { name: "?" }, s);

  // ---- Übersicht: Salden + wer schuldet wem
  const overview = () => {
    const maxAbs = Math.max(1, ...data.balances.map(b => Math.abs(b.netCents)));
    const withActivity = data.balances.filter(b => b.paidCents || b.owedCents || b.netCents);
    return h("div", { class: "stack" },
      h("div", { class: "card gold row wrap" },
        h("div", { class: "grow" }, h("div", { class: "small muted" }, "Gesamtausgaben dieser LAN"), h("div", { style: { fontSize: "28px", fontWeight: 800, color: "var(--gold-2)" } }, fmtEuro(data.totalCents))),
        h("div", {}, h("div", { class: "small muted" }, "Einkäufe"), h("div", { style: { fontSize: "22px", fontWeight: 700 } }, String(data.expenses.length))),
        h("button", { class: "btn primary", onClick: () => editExpense(null, data) }, "+ Einkauf")),
      h("div", { class: "card" }, h("h3", {}, "Wer schuldet wem?"),
        data.transfers.length ? h("div", { class: "stack", style: { marginTop: "10px" } }, data.transfers.map(t => h("div", { class: "transfer" },
          av(t.fromId), h("strong", {}, name(t.fromId)), h("span", { class: "muted" }, "→"), av(t.toId), h("strong", {}, name(t.toId)),
          h("div", { class: "grow" }), h("span", { class: "amt" }, fmtEuro(t.cents)),
          h("button", { class: "btn sm primary", onClick: async () => {
            if (await confirmDialog("Als bezahlt markieren?", `${name(t.fromId)} hat ${fmtEuro(t.cents)} an ${name(t.toId)} gezahlt.`, { okLabel: "Ja, bezahlt", danger: false })) {
              await api.post("/api/costs/payments", { fromId: t.fromId, toId: t.toId, amountCents: t.cents }); toast("Ausgleich gespeichert", "success");
            }
          } }, "✓ Bezahlt"),
        ))) : h("div", { class: "muted small", style: { marginTop: "8px" } }, data.expenses.length ? "Alles ausgeglichen. 🎉" : "Noch keine Einkäufe eingetragen.")),
      h("div", { class: "card" }, h("h3", {}, "Salden"),
        h("p", { class: "small muted" }, "Grün: bekommt Geld · Rot: schuldet"),
        withActivity.length ? withActivity.sort((a, b) => b.netCents - a.netCents).map(b => h("div", { class: "balance" },
          av(b.memberId), h("div", { style: { minWidth: "90px" } }, h("div", { class: "ellipsis" }, name(b.memberId)), h("div", { class: "small muted nowrap" }, `bezahlt ${fmtEuro(b.paidCents)} · Anteil ${fmtEuro(b.owedCents)}`)),
          h("div", { class: "bar" }, h("i", { class: b.netCents >= 0 ? "pos" : "neg", style: { width: `${Math.abs(b.netCents) / maxAbs * 50}%` } })),
          h("div", { class: `amt ${b.netCents > 0 ? "green" : b.netCents < 0 ? "red" : "muted"}` }, (b.netCents > 0 ? "+" : "") + fmtEuro(b.netCents)),
        )) : h("div", { class: "muted small" }, "Noch keine Daten.")),
    );
  };

  // ---- Einkäufe
  const recalc = () => recalcDialog(data);
  const weightOf = (e, id) => e.participants?.find(p => p.memberId === id)?.weight;
  const expensesView = () => h("div", { class: "stack" },
    h("div", { class: "row" }, h("div", { class: "grow" }),
      h("button", { class: "btn", title: "Aufteilung aus der aktuellen Anwesenheit neu berechnen – mit Vorschau", onClick: recalc }, "↻ Neu berechnen"),
      h("button", { class: "btn primary", onClick: () => editExpense(null, data) }, "+ Einkauf")),
    data.expenses.length ? data.expenses.map(e => h("div", { class: "card" },
      h("div", { class: "expense" },
        av(e.paidById, ""),
        h("div", { class: "grow" },
          h("div", { class: "row wrap" }, h("strong", {}, e.title), e.day ? h("span", { class: "chip blue" }, dayLabel(store.event?.startDate, e.day)) : h("span", { class: "chip" }, "ganze LAN")),
          h("div", { class: "small muted" }, `${e.paidByName} hat bezahlt · ${fmtDate(e.createdAt)}`),
          e.note ? h("div", { class: "small" }, e.note) : null,
          h("div", { class: "shares" }, e.shares.map(s => {
            const w = !e.day ? weightOf(e, s.memberId) : null;
            return h("span", { class: "chip" }, `${name(s.memberId)} ${fmtEuro(s.cents)}` + (w != null ? ` · ${fmtDays(w)}` : ""));
          })),
        ),
        h("div", { class: "amt gold" }, fmtEuro(e.amountCents)),
        h("div", { class: "col" }, h("button", { class: "btn sm ghost", onClick: () => editExpense(e, data) }, "✎"),
          h("button", { class: "btn sm ghost danger", onClick: async () => { if (await confirmDialog("Einkauf löschen?", e.title)) await api.del(`/api/costs/expenses/${e.id}`); } }, "✕")),
      ))) : empty("🧾", "Noch keine Einkäufe.", h("button", { class: "btn primary", onClick: () => editExpense(null, data) }, "+ Einkauf")),
  );

  // ---- Anwesenheit
  const attendanceView = () => {
    const days = data.days, ev = store.event;
    const grid = h("div", { class: "att-grid", style: { gridTemplateColumns: `minmax(120px, 1.4fr) repeat(${days}, minmax(52px, 1fr))` } });
    grid.append(h("div"), ...Array.from({ length: days }, (_, i) => h("div", { class: "cell small muted", style: { textAlign: "center" } }, dayLabel(ev?.startDate, i + 1))));
    for (const m of store.members) {
      const mine = new Set(data.attendance[m.id] || []);
      grid.append(h("div", { class: "row" }, avatar(m, "xs"), h("span", { class: "ellipsis small" }, m.name)));
      for (let d = 1; d <= days; d++) {
        grid.append(h("div", { class: "cell" }, h("button", { class: `day-btn ${mine.has(d) ? "on" : ""}`, onClick: async () => {
          const next = new Set(mine); next.has(d) ? next.delete(d) : next.add(d);
          await api.put("/api/costs/attendance", { memberId: m.id, days: [...next] });
        } }, mine.has(d) ? "✓" : "–")));
      }
    }
    return h("div", { class: "card" }, h("h3", {}, "Wer ist an welchem Tag dabei?"),
      h("p", { class: "small muted" }, `${ev?.name ?? ""} · ${days} Tage ab ${ev?.startDate ?? ""} · +30 XP pro Tag`),
      h("p", { class: "small muted" }, "Früher abgereist oder falsch eingetragen? Tage hier korrigieren. Bestehende Einkäufe ändern sich dadurch nicht automatisch – über „↻ Neu berechnen“ siehst du, was sich ändern würde, und kannst es übernehmen."),
      h("div", { class: "row" }, h("div", { class: "grow" }), h("button", { class: "btn", onClick: recalc }, "↻ Neu berechnen")),
      h("div", { class: "scroll-x" }, grid));
  };

  // ---- Ausgleichszahlungen
  const paymentsView = () => h("div", { class: "stack" },
    h("div", { class: "row" }, h("div", { class: "grow" }), h("button", { class: "btn", onClick: () => newPayment() }, "+ Zahlung erfassen")),
    data.payments.length ? h("div", { class: "card" }, data.payments.map(p => h("div", { class: "transfer", style: { border: 0, borderBottom: "1px solid var(--line)", borderRadius: 0 } },
      av(p.fromId), h("span", {}, name(p.fromId)), h("span", { class: "muted" }, "→"), av(p.toId), h("span", {}, name(p.toId)),
      h("div", { class: "grow small muted" }, fmtDate(p.createdAt)), h("span", { class: "amt" }, fmtEuro(p.amountCents)),
      h("button", { class: "btn sm ghost danger", onClick: async () => { if (await confirmDialog("Zahlung löschen?", "")) await api.del(`/api/costs/payments/${p.id}`); } }, "✕")))) : empty("🤝", "Noch keine Ausgleichszahlungen."),
  );

  const newPayment = () => {
    const opts = store.members.map(m => ({ value: m.id, label: m.name }));
    const from = select(opts, { value: store.me?.id }), to = select(opts), amt = input({ placeholder: "0,00", inputmode: "decimal" });
    modal({ title: "Zahlung erfassen", body: h("div", {}, h("div", { class: "form-row" }, field("Von", from), field("An", to)), field("Betrag (€)", amt)),
      buttons: [{ label: "Abbrechen" }, { label: "Speichern", class: "primary", onClick: async () => {
        const c = parseEuro(amt.value); if (!c || c <= 0) { toast("Ungültiger Betrag", "error"); return false; }
        await api.post("/api/costs/payments", { fromId: Number(from.value), toId: Number(to.value), amountCents: c });
      } }] });
  };

  mount(main, h("div", { class: "page-head" }, h("h2", {}, "Kosten"), store.event ? h("span", { class: "chip" }, store.event.name) : null), tabsEl, content,
    h("button", { class: "btn primary fab", onClick: () => editExpense(null, data), "aria-label": "Einkauf" }, "+"));
  await load();
  const offs = [on("costs", load), on("members", draw), on("events", load)];
  return () => offs.forEach(f => f());
}

function editExpense(e, data) {
  if (!store.members.length) { toast("Zuerst Mitglieder anlegen", "error"); return; }
  const ev = store.event;
  const title = input({ value: e ? e.title : "", placeholder: "z. B. Getränke-Großeinkauf", maxlength: 120 });
  const amt = input({ value: e ? (e.amountCents / 100).toFixed(2).replace(".", ",") : "", placeholder: "0,00", inputmode: "decimal" });
  const payer = select(store.members.map(m => ({ value: m.id, label: m.name })), { value: e ? e.paidById : (store.me?.id ?? store.members[0].id) });
  const day = select([{ value: "", label: "Ganze LAN (nach Anwesenheitstagen)" }, ...Array.from({ length: data.days }, (_, i) => ({ value: i + 1, label: `Nur ${dayLabel(ev?.startDate, i + 1)} (Anwesende dieses Tags)` }))], { value: e && e.day ? e.day : "" });
  const note = input({ value: e ? e.note : "", placeholder: "optional", maxlength: 200 });
  const curDay = () => day.value ? Number(day.value) : null;
  const attDays = (id) => presentDays(data, id).length;
  const defaultWeight = (id) => curDay() ? 1 : (attDays(id) || 1);
  // Teilnehmer → Tage (Gewicht); kein Eintrag = nicht dabei. Wird beim Speichern fest übernommen.
  let weights = e?.participants?.length ? new Map(e.participants.map(p => [p.memberId, p.weight])) : suggestedWeights(data, e?.day ?? null);
  const box = h("div", { style: { marginTop: "4px" } });
  const preview = h("div", { class: "shares", style: { marginTop: "8px" } });
  const drawPreview = () => {
    const c = parseEuro(amt.value);
    if (!c || c <= 0) { mount(preview, h("span", { class: "small muted" }, "Betrag eingeben, um die Aufteilung zu sehen.")); return; }
    mount(preview, h("span", { class: "small muted" }, "Aufteilung:"), ...splitCents(c, Number(payer.value), weights).map(s => h("span", { class: "chip" }, `${memberName(s.memberId)} ${fmtEuro(s.cents)}`)));
  };
  const draw = () => {
    mount(box, h("div", { class: "row wrap", style: { marginBottom: "6px" } },
      h("button", { class: "btn sm ghost", onClick: () => { store.members.forEach(m => weights.has(m.id) || weights.set(m.id, defaultWeight(m.id))); draw(); } }, "Alle"),
      h("button", { class: "btn sm ghost", onClick: () => { weights.clear(); draw(); } }, "Keiner"),
      h("button", { class: "btn sm ghost", title: "Teilnehmer und Tage aus der Anwesenheit vorschlagen", onClick: () => { weights = suggestedWeights(data, curDay()); draw(); } }, "↻ Aus Anwesenheit")),
      h("div", { class: "small muted", style: { marginBottom: "6px" } }, "Tage = Gewicht: Wer 2 Tage da war, zahlt doppelt so viel wie jemand mit 1 Tag. Halbe Tage (0,5) gehen auch."),
      h("div", { class: "pick-list" }, store.members.map(m => {
        const on = weights.has(m.id);
        const days = daysInput(on ? weights.get(m.id) : defaultWeight(m.id), (v) => { weights.set(m.id, v); drawPreview(); });
        days.disabled = !on;
        return h("div", { class: "it" },
          h("label", { class: "row grow", style: { cursor: "pointer" } },
            h("input", { type: "checkbox", checked: on, onChange: (ev2) => { ev2.target.checked ? weights.set(m.id, Number(days.value) || defaultWeight(m.id)) : weights.delete(m.id); draw(); } }),
            avatar(m, "xs"), h("span", { class: "grow" }, m.name), h("span", { class: "small muted nowrap" }, `${attDays(m.id)} T. anwesend`)),
          days, h("span", { class: "small muted" }, "Tage"));
      })));
    drawPreview();
  };
  amt.addEventListener("input", drawPreview);
  payer.addEventListener("change", drawPreview);
  day.addEventListener("change", () => { weights = suggestedWeights(data, curDay()); draw(); });
  draw();
  modal({
    title: e ? "Einkauf bearbeiten" : "Neuer Einkauf",
    body: h("div", {}, field("Bezeichnung *", title), h("div", { class: "form-row" }, field("Betrag (€) *", amt), field("Bezahlt von", payer)), field("Betrifft", day),
      field("Wer zahlt mit – und für wie viele Tage?", box), preview, field("Notiz", note)),
    buttons: [{ label: "Abbrechen" }, { label: "Speichern", class: "primary", onClick: async () => {
      const c = parseEuro(amt.value);
      if (!title.value.trim()) { toast("Bezeichnung fehlt", "error"); return false; }
      if (!c || c <= 0) { toast("Ungültiger Betrag", "error"); return false; }
      if (![...weights.values()].some(w => w > 0)) { toast("Mindestens ein Teilnehmer mit mehr als 0 Tagen", "error"); return false; }
      const body = { title: title.value.trim(), amountCents: c, paidById: Number(payer.value), day: curDay(), note: note.value.trim(), participants: toParticipants(weights) };
      if (e) await api.put(`/api/costs/expenses/${e.id}`, body); else await api.post("/api/costs/expenses", body);
      toast("Einkauf gespeichert", "success");
    } }],
  });
}

/** Neu berechnen: schlägt je Einkauf Teilnehmer/Tage aus der aktuellen Anwesenheit vor, zeigt alt → neu und lässt nachschärfen. */
function recalcDialog(data) {
  const items = data.expenses.map(e => ({
    e, current: new Map((e.participants || []).map(p => [p.memberId, p.weight])), proposed: suggestedWeights(data, e.day),
    oldCents: new Map(e.shares.map(s => [s.memberId, s.cents])), apply: true,
  })).filter(it => !sameWeights(it.current, it.proposed));
  if (!items.length) { toast("Alles passt – die Anwesenheit ergibt keine Änderungen", "success"); return; }

  const newCents = (it) => new Map(splitCents(it.e.amountCents, it.e.paidById, it.proposed).map(s => [s.memberId, s.cents]));
  const diffEl = (cents) => h("span", { class: `nowrap ${cents > 0 ? "red" : cents < 0 ? "green" : "muted"}`, style: { fontWeight: 700 } }, cents ? (cents > 0 ? "+" : "−") + fmtEuro(Math.abs(cents)) : "±0");
  const summary = h("div", { class: "shares" });
  const drawSummary = () => {
    const total = new Map();
    for (const it of items.filter(x => x.apply)) {
      const nc = newCents(it);
      for (const id of new Set([...it.oldCents.keys(), ...nc.keys()])) total.set(id, (total.get(id) ?? 0) + (nc.get(id) ?? 0) - (it.oldCents.get(id) ?? 0));
    }
    const rows = [...total].filter(([, c]) => c !== 0).sort((a, b) => b[1] - a[1]);
    mount(summary, rows.length ? rows.map(([id, c]) => h("span", { class: "chip" }, `${memberName(id)} `, diffEl(c))) : h("span", { class: "small muted" }, "Keine Betragsänderung."));
  };

  const card = (it) => {
    const { e } = it;
    const ids = () => [...new Set([...it.current.keys(), ...it.proposed.keys()])].sort((a, b) => memberName(a).localeCompare(memberName(b)));
    const table = h("div", { class: "recalc-grid" });
    const addSel = h("select", { class: "select", style: { maxWidth: "220px" } });
    const drawTable = () => {
      mount(table, h("div", { class: "small muted" }, "Wer"), h("div", { class: "small muted" }, "Tage"), h("div", { class: "small muted r" }, "bisher"), h("div", { class: "small muted r" }, "neu"), h("div", { class: "small muted r" }, "Δ"),
        ...ids().flatMap(id => {
          const was = it.current.get(id), old = it.oldCents.get(id) ?? 0, now = newCents(it).get(id) ?? 0;
          const newCell = h("div", { class: "r nowrap" }, fmtEuro(now)), dCell = h("div", { class: "r" }, diffEl(now - old));
          const inp = daysInput(it.proposed.get(id) ?? 0, (v) => {
            v > 0 ? it.proposed.set(id, v) : it.proposed.delete(id);
            const nc = newCents(it);
            // alle Zeilen dieses Einkaufs ändern sich mit – Zellen neu befüllen, ohne den Fokus zu verlieren
            for (const row of rowsById.values()) { const n = nc.get(row.id) ?? 0; row.newCell.textContent = fmtEuro(n); mount(row.dCell, diffEl(n - row.old)); }
            drawSummary();
          });
          rowsById.set(id, { id, old, newCell, dCell });
          return [h("div", { class: "row", style: { minWidth: 0 } }, avatar(store.member(id) || { name: "?" }, "xs"), h("span", { class: "ellipsis small" }, memberName(id))),
            h("div", { class: "row nowrap" }, h("span", { class: "small muted" }, was != null ? `${fmtNum(was)} →` : "neu →"), inp),
            h("div", { class: "r small muted nowrap" }, fmtEuro(old)), newCell, dCell];
        }));
      const others = store.members.filter(m => !ids().includes(m.id));
      mount(addSel, h("option", { value: "" }, "+ Person hinzufügen"), ...others.map(m => h("option", { value: m.id }, m.name)));
      addSel.classList.toggle("hidden", !others.length);
    };
    const rowsById = new Map();
    const redraw = () => { rowsById.clear(); drawTable(); drawSummary(); };
    addSel.addEventListener("change", () => { if (addSel.value) { it.proposed.set(Number(addSel.value), 1); redraw(); } });
    drawTable();
    const body = h("div", { style: { marginTop: "8px" } }, h("div", { class: "scroll-x" }, table),
      h("div", { class: "row wrap", style: { marginTop: "6px" } }, addSel,
        h("button", { class: "btn sm ghost", onClick: () => { it.proposed = new Map(it.current); redraw(); } }, "Bisherige Tage"),
        h("button", { class: "btn sm ghost", onClick: () => { it.proposed = suggestedWeights(data, e.day); redraw(); } }, "↻ Vorschlag")));
    return h("div", { class: "card", style: { padding: "10px 12px" } },
      h("label", { class: "row wrap", style: { cursor: "pointer" } },
        h("input", { type: "checkbox", checked: it.apply, onChange: (ev2) => { it.apply = ev2.target.checked; body.classList.toggle("hidden", !it.apply); drawSummary(); } }),
        h("strong", { class: "grow" }, e.title), e.day ? h("span", { class: "chip blue" }, dayLabel(store.event?.startDate, e.day)) : h("span", { class: "chip" }, "ganze LAN"),
        h("span", { class: "gold nowrap", style: { fontWeight: 800 } }, fmtEuro(e.amountCents))),
      body);
  };

  const cards = items.map(card);
  drawSummary();
  modal({
    title: "Neu berechnen", wide: true,
    body: h("div", { class: "stack" },
      h("p", { class: "small muted" }, `Vorschlag aus der aktuellen Anwesenheit für ${items.length} Einkauf/Einkäufe. Tage kannst du hier noch anpassen; übernommen werden nur angehakte Einkäufe.`),
      h("div", { class: "card gold" }, h("div", { class: "small muted", style: { marginBottom: "6px" } }, "Auswirkung je Person (+ zahlt mehr, − zahlt weniger)"), summary),
      ...cards),
    buttons: [{ label: "Abbrechen" }, { label: "Übernehmen", class: "primary", onClick: async () => {
      const chosen = items.filter(it => it.apply);
      if (!chosen.length) { toast("Kein Einkauf ausgewählt", "error"); return false; }
      const bad = chosen.find(it => ![...it.proposed.values()].some(w => w > 0));
      if (bad) { toast(`„${bad.e.title}“: mindestens ein Teilnehmer nötig`, "error"); return false; }
      const r = await api.post("/api/costs/recalculate", { expenses: chosen.map(it => ({ id: it.e.id, participants: toParticipants(it.proposed) })) });
      toast(`${r.updated} Einkauf/Einkäufe neu berechnet`, "success");
    } }],
  });
}

const memberName = (id) => store.member(id)?.name ?? "Unbekannt";
const fmtNum = (w) => String(w).replace(".", ",");
const fmtDays = (w) => `${fmtNum(w)} ${w === 1 ? "Tag" : "Tage"}`;
const toParticipants = (weights) => [...weights].filter(([, w]) => w > 0).map(([memberId, weight]) => ({ memberId, weight }));
const presentDays = (data, id) => (data.attendance[id] || []).filter(d => d >= 1 && d <= data.days);
const sameWeights = (a, b) => a.size === b.size && [...a].every(([id, w]) => b.get(id) === w);
function daysInput(value, onChange) {
  return input({ type: "number", min: 0, max: 99, step: 0.5, inputmode: "decimal", value, style: { width: "68px" },
    onInput: (ev) => { const v = Number(String(ev.target.value).replace(",", ".")); if (Number.isFinite(v) && v >= 0) onChange(v); } });
}

/** Vorschlag aus der Anwesenheit: ganze LAN = Anwesenheitstage, ein Tag = 1 für alle Anwesenden dieses Tags. */
function suggestedWeights(data, day) {
  const ids = store.members.map(m => m.id), w = new Map();
  if (day) {
    let present = ids.filter(id => presentDays(data, id).includes(day));
    if (!present.length) present = ids.filter(id => presentDays(data, id).length);
    present.forEach(id => w.set(id, 1));
  } else ids.forEach(id => { const n = presentDays(data, id).length; if (n) w.set(id, n); });
  if (!w.size) ids.forEach(id => w.set(id, 1));
  return w;
}

/** Gleiche Rechnung wie splitExpense im Worker (Restcents nach größtem Nachkommaanteil). */
function splitCents(amountCents, paidById, weights) {
  const list = [...weights].filter(([, w]) => w > 0).sort((a, b) => a[0] - b[0]);
  if (!list.length) return [{ memberId: paidById, cents: amountCents }];
  const total = list.reduce((a, [, w]) => a + w, 0);
  const raw = list.map(([id, w]) => [id, (amountCents * w) / total]);
  const out = raw.map(([id, v]) => [id, Math.floor(v)]);
  let rest = amountCents - out.reduce((a, [, v]) => a + v, 0);
  const order = raw.map((_, i) => i).sort((a, b) => (raw[b][1] - Math.floor(raw[b][1])) - (raw[a][1] - Math.floor(raw[a][1])));
  for (let i = 0; rest > 0; i++, rest--) out[order[i % order.length]][1]++;
  return out.map(([memberId, cents]) => ({ memberId, cents }));
}
