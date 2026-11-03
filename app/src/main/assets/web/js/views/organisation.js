// LAN-Party-Ausgaben verwalten, Host-Informationen.
import { h, mount, modal, confirmDialog, empty, toast, input, field, checkbox, fmtDate } from "../ui.js";
import { api } from "../api.js";
import { store, on } from "../store.js";

export async function renderOrganisation(main) {
  const content = h("div");
  let host = null;

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
        h("p", { class: "small muted" }, "Startet eine neue Ausgabe: Spielhistorie, Kosten und Ausrüstung beginnen frisch. Die Ausrüstungsliste wird auf Wunsch mit den Zusagen der aktuellen LAN vorausgefüllt, Vorschläge „für nächstes Jahr“ werden zu Vorschlägen für die neue LAN."),
        h("button", { class: "btn primary", onClick: () => editEvent(null) }, "+ Neue LAN-Party")),
      others.length ? h("div", { class: "card" }, h("h3", {}, "Frühere / weitere Ausgaben"),
        others.map(e => h("div", { class: "row", style: { padding: "8px 0", borderBottom: "1px solid var(--line)" } },
          h("div", { class: "grow" }, h("strong", {}, e.name), h("div", { class: "small muted" }, `${e.startDate} · ${e.days} Tage`)),
          h("button", { class: "btn sm", onClick: async () => { if (await confirmDialog("Ausgabe aktivieren?", `„${e.name}“ wird zur aktuellen LAN-Party.`, { okLabel: "Aktivieren", danger: false })) await api.post(`/api/events/${e.id}/activate`); } }, "Aktivieren"),
          h("button", { class: "btn sm ghost", onClick: () => editEvent(e) }, "✎"),
          h("button", { class: "btn sm ghost danger", onClick: async () => { if (await confirmDialog("Ausgabe löschen?", "Historie, Kosten und Ausrüstung dieser Ausgabe gehen verloren.")) await api.del(`/api/events/${e.id}`); } }, "✕")))) : null,
      h("div", { class: "card" }, h("h3", {}, "Host & Verbindung"),
        host ? h("div", { class: "stack", style: { marginTop: "8px" } },
          h("div", { class: "url-box" }, host.addresses.length ? `http://${host.addresses[0]}:${host.port}` : "Keine WLAN-Adresse gefunden"),
          host.addresses.length > 1 ? h("div", { class: "small muted" }, "Weitere: " + host.addresses.slice(1).map(a => `http://${a}:${host.port}`).join(", ")) : null,
          h("dl", { class: "kv" }, h("dt", {}, "Verbundene Geräte"), h("dd", {}, String(host.clients)), h("dt", {}, "Version"), h("dd", {}, host.version), h("dt", {}, "Datenbank"), h("dd", { class: "small mono" }, host.dbPath)),
          h("p", { class: "small muted" }, "Alle Daten liegen ausschließlich auf dem Host-Handy. Teilnehmer öffnen die Adresse im Browser desselben WLANs. Tipp: „Zum Startbildschirm hinzufügen“ für ein App-Gefühl."),
        ) : h("div", { class: "muted small" }, "Lade …")),
    );
  };

  mount(main, h("div", { class: "page-head" }, h("h2", {}, "LAN-Party")), content);
  draw();
  api.get("/api/host", { silent: true }).then(hh => { host = hh; draw(); }).catch(() => {});
  const offs = [on("events", draw), on("connection", () => api.get("/api/host", { silent: true }).then(hh => { host = hh; draw(); }).catch(() => {}))];
  return () => offs.forEach(f => f());
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
