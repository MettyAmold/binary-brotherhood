// LAN-Party-Ausgaben verwalten.
import { h, mount, modal, confirmDialog, toast, input, field, checkbox } from "../ui.js";
import { api } from "../api.js";
import { store, on } from "../store.js";

export async function renderOrganisation(main) {
  const content = h("div");

  const draw = () => {
    const cur = store.event;
    const others = store.events.filter(e => !e.isCurrent);
    mount(content,
      cur ? h("div", { class: "card gold" },
        h("div", { class: "row wrap" }, h("h3", { style: { fontFamily: "var(--display)", color: "var(--gold)", fontSize: "20px", letterSpacing: ".06em" } }, cur.name), h("span", { class: "chip green" }, "aktuell")),
        h("dl", { class: "kv", style: { marginTop: "8px" } }, h("dt", {}, "Jahr"), h("dd", {}, String(cur.year)), h("dt", {}, "Start"), h("dd", {}, cur.startDate), h("dt", {}, "Dauer"), h("dd", {}, `${cur.days} Tage`)),
        h("div", { class: "row wrap", style: { marginTop: "10px" } },
          h("button", { class: "btn", onClick: () => editEvent(cur) }, "✎ Bearbeiten"),
          h("a", { class: "btn", href: "#/costs/attendance" }, "Anwesenheit"),
          h("a", { class: "btn", href: "#/equipment" }, "Ausrüstung")),
      ) : null,
      h("div", { class: "card" }, h("h3", {}, "Nächste LAN-Party anlegen"),
        h("p", { class: "small muted" }, "Historie, Kosten und Ausrüstung beginnen leer."),
        h("button", { class: "btn primary", onClick: () => editEvent(null) }, "+ Neue LAN-Party")),
      others.length ? h("div", { class: "card" }, h("h3", {}, "Frühere / weitere Ausgaben"),
        others.map(e => h("div", { class: "row", style: { padding: "8px 0", borderBottom: "1px solid var(--line)" } },
          h("div", { class: "grow" }, h("strong", {}, e.name), h("div", { class: "small muted" }, `${e.startDate} · ${e.days} Tage`)),
          h("button", { class: "btn sm", onClick: async () => { if (await confirmDialog("Ausgabe aktivieren?", `„${e.name}“ wird zur aktuellen LAN-Party.`, { okLabel: "Aktivieren", danger: false })) await api.post(`/api/events/${e.id}/activate`); } }, "Aktivieren"),
          h("button", { class: "btn sm ghost", onClick: () => editEvent(e) }, "✎"),
          h("button", { class: "btn sm ghost danger", onClick: async () => { if (await confirmDialog("Ausgabe löschen?", "Historie, Kosten und Ausrüstung dieser Ausgabe werden gelöscht.")) await api.del(`/api/events/${e.id}`); } }, "✕")))) : null,
    );
  };

  mount(main, h("div", { class: "page-head" }, h("h2", {}, "LAN-Party")), content);
  draw();
  return on("events", draw);
}

function editEvent(e) {
  const now = new Date();
  const name = input({ value: e ? e.name : `LAN-Party ${now.getFullYear() + (e ? 0 : 1)}`, maxlength: 60 });
  const year = input({ type: "number", value: e ? e.year : now.getFullYear() + 1 });
  const start = input({ type: "date", value: e ? e.startDate : `${now.getFullYear() + 1}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}` });
  const days = input({ type: "number", min: 1, max: 14, value: e ? e.days : 3 });
  const copy = h("input", { type: "checkbox", checked: true });
  const activate = h("input", { type: "checkbox", checked: true });
  modal({
    title: e ? "LAN-Party bearbeiten" : "Neue LAN-Party",
    body: h("div", {}, field("Name", name), h("div", { class: "form-row" }, field("Jahr", year), field("Start", start)), field("Dauer in Tagen", days),
      !e ? h("div", { class: "stack" },
        h("label", { class: "check" }, copy, h("span", {}, "Ausrüstungsliste der aktuellen LAN als Vorlage übernehmen")),
        h("label", { class: "check" }, activate, h("span", {}, "Sofort als aktuelle LAN-Party aktivieren"))) : null),
    buttons: [{ label: "Abbrechen" }, { label: e ? "Speichern" : "Anlegen", class: "primary", onClick: async () => {
      if (!name.value.trim()) { toast("Name fehlt", "error"); return false; }
      const body = { name: name.value.trim(), year: Number(year.value) || now.getFullYear(), startDate: start.value || now.toISOString().slice(0, 10), days: Number(days.value) || 3, copyEquipment: copy.checked, activate: activate.checked };
      if (e) await api.put(`/api/events/${e.id}`, body); else await api.post("/api/events", body);
      toast(e ? "Gespeichert" : "LAN-Party angelegt", "success");
    } }],
  });
}
