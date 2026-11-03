// Ausrüstung & Organisation: Wer bringt was mit? Vorlage aus der letzten LAN.
import { h, mount, modal, confirmDialog, avatar, empty, toast, input, field, select, checkbox } from "../ui.js";
import { api } from "../api.js";
import { store, on } from "../store.js";
import { requireMe } from "../app.js";

const CATEGORIES = ["Konsolen", "Technik", "Kabel", "Netzwerk", "Getränke", "Verpflegung", "Sonstiges"];
let onlyOpen = false;

export async function renderEquipment(main) {
  let items = [];
  const content = h("div");
  const head = h("div");

  const load = async () => { items = await api.get("/api/equipment"); draw(); };

  const draw = () => {
    const open = items.filter(i => !i.bringerId);
    const mine = store.me ? items.filter(i => i.bringerId === store.me.id) : [];
    mount(head,
      h("div", { class: "row wrap", style: { marginBottom: "12px" } },
        h("span", { class: `chip ${open.length ? "red" : "green"}` }, open.length ? `${open.length} noch offen` : "Alles vergeben ✓"),
        mine.length ? h("span", { class: "chip gold" }, `Du bringst ${mine.length} mit`) : null,
        h("div", { class: "grow" }),
        checkbox("Nur offene", { checked: onlyOpen, onChange: (e) => { onlyOpen = e.target.checked; draw(); } }),
        h("button", { class: "btn sm", onClick: applyTemplate }, "⟳ Vorlage: letzte LAN"),
      ));
    const shown = onlyOpen ? open : items;
    if (!shown.length) { mount(content, empty("🎒", onlyOpen ? "Nichts mehr offen – alles ist vergeben!" : "Noch keine Ausrüstung eingetragen.",
      h("div", { class: "row wrap", style: { justifyContent: "center" } }, h("button", { class: "btn primary", onClick: () => editItem() }, "+ Gegenstand"), h("button", { class: "btn", onClick: applyTemplate }, "Vorlage übernehmen")))); return; }
    const groups = new Map();
    for (const it of shown) { if (!groups.has(it.category)) groups.set(it.category, []); groups.get(it.category).push(it); }
    const order = [...groups.keys()].sort((a, b) => (CATEGORIES.indexOf(a) + 100 * (CATEGORIES.indexOf(a) < 0)) - (CATEGORIES.indexOf(b) + 100 * (CATEGORIES.indexOf(b) < 0)) || a.localeCompare(b));
    mount(content, order.map(cat => h("div", {}, h("div", { class: "cat-head" }, cat, h("span", { class: "chip" }, String(groups.get(cat).length))),
      h("div", { class: "card" }, groups.get(cat).map(row)))));
  };

  const row = (it) => {
    const bringer = it.bringerId ? store.member(it.bringerId) : null;
    const mine = store.me && it.bringerId === store.me.id;
    return h("div", { class: `equip ${it.done ? "done" : ""}` },
      h("input", { type: "checkbox", class: "chk", checked: it.done, disabled: !it.bringerId, title: it.bringerId ? "Mitgebracht / erledigt" : "Zuerst jemanden zuordnen", onChange: async (e) => {
        await api.post(`/api/equipment/${it.id}/done`, { done: e.target.checked });
        if (e.target.checked) toast("Erledigt – XP vergeben!", "success");
      } }),
      h("div", { class: "grow" },
        h("div", { class: "n" }, it.name, it.quantity > 1 ? h("span", { class: "muted" }, ` × ${it.quantity}`) : null),
        it.note ? h("div", { class: "small muted" }, it.note) : null,
        bringer ? h("div", { class: "row small", style: { marginTop: "3px" } }, avatar(bringer, "xs"), h("span", {}, bringer.name, it.done ? " ✓" : " bringt es mit"))
          : it.bringerName ? h("div", { class: "small muted" }, it.bringerName) : h("div", { class: "open" }, "Noch niemand zugesagt"),
      ),
      !it.bringerId ? h("button", { class: "btn sm primary", onClick: async () => { const me = await requireMe(); if (me) await api.post(`/api/equipment/${it.id}/claim`, { memberId: me.id }); } }, "Ich bring's")
        : mine ? h("button", { class: "btn sm", onClick: () => api.post(`/api/equipment/${it.id}/claim`, { memberId: null }) }, "Doch nicht")
        : h("button", { class: "btn sm ghost", title: "Jemand anderem zuordnen", onClick: () => assign(it) }, "⇄"),
      h("button", { class: "btn sm ghost", onClick: () => editItem(it) }, "✎"),
      h("button", { class: "btn sm ghost danger", onClick: async () => { if (await confirmDialog("Gegenstand löschen?", it.name)) await api.del(`/api/equipment/${it.id}`); } }, "✕"),
    );
  };

  const assign = (it) => {
    const ctx = modal({ title: `Wer bringt „${it.name}“ mit?`, body: h("div", { class: "pick-list" },
      h("div", { class: "it", onClick: async () => { await api.post(`/api/equipment/${it.id}/claim`, { memberId: null }); ctx.close(); } }, h("span", { class: "muted" }, "– niemand (offen) –")),
      store.members.map(m => h("div", { class: "it", onClick: async () => { await api.post(`/api/equipment/${it.id}/claim`, { memberId: m.id }); ctx.close(); } }, avatar(m, "sm"), h("span", {}, m.name)))),
      buttons: [{ label: "Abbrechen" }] });
  };

  const applyTemplate = async () => {
    const prev = store.events.filter(e => !e.isCurrent);
    if (!prev.length) { toast("Es gibt noch keine frühere LAN-Party als Vorlage. Lege unter „LAN-Party“ eine neue Ausgabe an, dann wird die aktuelle Liste zur Vorlage.", "error", 6000); return; }
    const sel = select(prev.map(e => ({ value: e.id, label: e.name })), { value: prev[0].id });
    modal({ title: "Vorlage übernehmen", body: h("div", {}, h("p", { class: "muted small" }, "Alle Gegenstände der gewählten LAN-Party werden übernommen. Wer damals etwas mitgebracht hat, ist wieder vorausgefüllt. Bereits vorhandene Einträge bleiben unberührt."), field("Quelle", sel)),
      buttons: [{ label: "Abbrechen" }, { label: "Übernehmen", class: "primary", onClick: async () => {
        const r = await api.post("/api/equipment/template", { fromEventId: Number(sel.value) });
        toast(`${r.id} Gegenstände übernommen`, "success");
      } }] });
  };

  mount(main,
    h("div", { class: "page-head" }, h("h2", {}, "Ausrüstung"), h("button", { class: "btn primary", onClick: () => editItem() }, "+ Gegenstand")),
    head, content,
    h("button", { class: "btn primary fab", onClick: () => editItem(), "aria-label": "Gegenstand" }, "+"),
  );
  await load();
  const offs = [on("equipment", load), on("members", draw), on("me", draw), on("events", load)];
  return () => offs.forEach(f => f());
}

function editItem(it) {
  const name = input({ value: it ? it.name : "", placeholder: "z. B. Beamer", maxlength: 80 });
  const cat = select(CATEGORIES.map(c => ({ value: c, label: c })), { value: it ? it.category : "Technik" });
  const qty = input({ type: "number", min: 1, value: it ? it.quantity : 1 });
  const note = input({ value: it ? it.note : "", placeholder: "z. B. inkl. HDMI-Kabel", maxlength: 200 });
  modal({
    title: it ? "Gegenstand bearbeiten" : "Gegenstand hinzufügen",
    body: h("div", {}, field("Bezeichnung *", name), h("div", { class: "form-row" }, field("Kategorie", cat), field("Anzahl", qty)), field("Notiz", note)),
    buttons: [{ label: "Abbrechen" }, { label: it ? "Speichern" : "Hinzufügen", class: "primary", onClick: async () => {
      if (!name.value.trim()) { toast("Bezeichnung fehlt", "error"); return false; }
      const body = { name: name.value.trim(), category: cat.value, quantity: Number(qty.value) || 1, note: note.value.trim() };
      if (it) await api.put(`/api/equipment/${it.id}`, body); else await api.post("/api/equipment", body);
    } }],
  });
}
