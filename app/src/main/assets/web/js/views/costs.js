// Kostenaufteilung à la Splitwise: Anwesenheitstage, Einkäufe, faire Aufteilung, Schulden, Ausgleich.
import { h, mount, modal, confirmDialog, avatar, empty, toast, input, field, select, fmtEuro, parseEuro, dayLabel, fmtDate, checkbox } from "../ui.js";
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
        ))) : h("div", { class: "muted small", style: { marginTop: "8px" } }, data.expenses.length ? "Alles ausgeglichen – niemand schuldet jemandem etwas. 🎉" : "Noch keine Einkäufe eingetragen.")),
      h("div", { class: "card" }, h("h3", {}, "Salden"),
        h("p", { class: "small muted" }, "Grün = bekommt Geld zurück, Rot = schuldet noch. Berücksichtigt Anwesenheitstage und bereits erfolgte Ausgleichszahlungen."),
        withActivity.length ? withActivity.sort((a, b) => b.netCents - a.netCents).map(b => h("div", { class: "balance" },
          av(b.memberId), h("div", { style: { minWidth: "90px" } }, h("div", { class: "ellipsis" }, name(b.memberId)), h("div", { class: "small muted nowrap" }, `bezahlt ${fmtEuro(b.paidCents)} · Anteil ${fmtEuro(b.owedCents)}`)),
          h("div", { class: "bar" }, h("i", { class: b.netCents >= 0 ? "pos" : "neg", style: { width: `${Math.abs(b.netCents) / maxAbs * 50}%` } })),
          h("div", { class: `amt ${b.netCents > 0 ? "green" : b.netCents < 0 ? "red" : "muted"}` }, (b.netCents > 0 ? "+" : "") + fmtEuro(b.netCents)),
        )) : h("div", { class: "muted small" }, "Noch keine Daten.")),
    );
  };

  // ---- Einkäufe
  const expensesView = () => h("div", { class: "stack" },
    h("div", { class: "row" }, h("div", { class: "grow muted small" }, "Trage gemeinsame Einkäufe ein. Die Aufteilung passiert automatisch nach Anwesenheit, kann aber pro Einkauf angepasst werden."), h("button", { class: "btn primary", onClick: () => editExpense(null, data) }, "+ Einkauf")),
    data.expenses.length ? data.expenses.map(e => h("div", { class: "card" },
      h("div", { class: "expense" },
        av(e.paidById, ""),
        h("div", { class: "grow" },
          h("div", { class: "row wrap" }, h("strong", {}, e.title), e.day ? h("span", { class: "chip blue" }, dayLabel(store.event?.startDate, e.day)) : h("span", { class: "chip" }, "ganze LAN"), e.participantIds.length ? h("span", { class: "chip purple" }, "individuell") : null),
          h("div", { class: "small muted" }, `${e.paidByName} hat bezahlt · ${fmtDate(e.createdAt)}`),
          e.note ? h("div", { class: "small" }, e.note) : null,
          h("div", { class: "shares" }, e.shares.map(s => h("span", { class: "chip" }, `${name(s.memberId)} ${fmtEuro(s.cents)}`))),
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
      h("p", { class: "small muted" }, `${ev?.name ?? ""} · ${days} Tage ab ${ev?.startDate ?? ""}. Tage anpassen unter „LAN-Party“. Jeder Anwesenheitstag bringt 30 XP.`),
      h("div", { class: "scroll-x" }, grid));
  };

  // ---- Ausgleichszahlungen
  const paymentsView = () => h("div", { class: "stack" },
    h("div", { class: "row" }, h("div", { class: "grow muted small" }, "Erfolgte Ausgleichszahlungen zwischen Mitgliedern."), h("button", { class: "btn", onClick: () => newPayment() }, "+ Zahlung erfassen")),
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
  const day = select([{ value: "", label: "Ganze LAN (nach Anwesenheitstagen gewichtet)" }, ...Array.from({ length: data.days }, (_, i) => ({ value: i + 1, label: `Nur ${dayLabel(ev?.startDate, i + 1)} (Anwesende dieses Tags)` }))], { value: e && e.day ? e.day : "" });
  const note = input({ value: e ? e.note : "", placeholder: "optional", maxlength: 200 });
  let custom = !!(e && e.participantIds.length);
  const sel = new Set(e ? e.participantIds : store.members.map(m => m.id));
  const customBox = h("div", { class: custom ? "" : "hidden", style: { marginTop: "8px" } });
  const drawCustom = () => mount(customBox, h("div", { class: "row wrap", style: { marginBottom: "6px" } },
    h("button", { class: "btn sm ghost", onClick: () => { store.members.forEach(m => sel.add(m.id)); drawCustom(); } }, "Alle"),
    h("button", { class: "btn sm ghost", onClick: () => { sel.clear(); drawCustom(); } }, "Keiner")),
    h("div", { class: "pick-list" }, store.members.map(m => h("label", { class: "it" }, h("input", { type: "checkbox", checked: sel.has(m.id), onChange: (ev2) => ev2.target.checked ? sel.add(m.id) : sel.delete(m.id) }), avatar(m, "xs"), h("span", {}, m.name)))));
  drawCustom();
  modal({
    title: e ? "Einkauf bearbeiten" : "Neuer Einkauf",
    body: h("div", {}, field("Bezeichnung *", title), h("div", { class: "form-row" }, field("Betrag (€) *", amt), field("Bezahlt von", payer)), field("Betrifft", day),
      checkbox("Teilnehmer manuell auswählen (gleichmäßig unter den Gewählten)", { checked: custom, onChange: (ev2) => { custom = ev2.target.checked; customBox.classList.toggle("hidden", !custom); } }), customBox,
      field("Notiz", note)),
    buttons: [{ label: "Abbrechen" }, { label: e ? "Speichern" : "Speichern", class: "primary", onClick: async () => {
      const c = parseEuro(amt.value);
      if (!title.value.trim()) { toast("Bezeichnung fehlt", "error"); return false; }
      if (!c || c <= 0) { toast("Ungültiger Betrag", "error"); return false; }
      if (custom && !sel.size) { toast("Mindestens einen Teilnehmer wählen", "error"); return false; }
      const body = { title: title.value.trim(), amountCents: c, paidById: Number(payer.value), day: day.value ? Number(day.value) : null, note: note.value.trim(), participantIds: custom ? [...sel] : [] };
      if (e) await api.put(`/api/costs/expenses/${e.id}`, body); else await api.post("/api/costs/expenses", body);
      toast("Einkauf gespeichert", "success");
    } }],
  });
}
