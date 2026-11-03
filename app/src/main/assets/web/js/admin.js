// Admin-Dialoge: Realm-Einstellungen, Verwaltung (Super-Admin), Einladung, Klänge, Zurücksetzen, Änderungsprotokoll.
import { h, mount, avatar, modal, toast, field, input, confirmDialog, copyText } from "./ui.js";
import { store } from "./store.js";
import { api, authHeaders, currentRealm, setRealm } from "./api.js";
import { playSound } from "./notify.js";
import { renderRoute } from "./app.js";
import { kindPicker, KIND_LABEL } from "./account.js";

/** Admin: Realm umbenennen oder zwischen LAN-Party und Online umschalten. */
export function realmSettingsDialog() {
  const name = input({ value: store.realm?.name || "", maxlength: 60 });
  const kind = kindPicker(store.realm?.kind || "lan");
  modal({
    title: "Realm-Einstellungen",
    body: h("div", {},
      field("Name", name), h("div", { class: "field" }, h("label", {}, "Art"), kind.el),
      h("p", { class: "small muted" }, "LAN-Daten bleiben beim Umschalten erhalten.")),
    buttons: [{ label: "Abbrechen" }, { label: "Speichern", class: "primary", onClick: async () => {
      store.realm = await api.put("/api/realm", { name: name.value.trim(), kind: kind.value() });
      store.appName = store.realm.name;
      toast("Realm gespeichert", "success");
      renderRoute();
    } }],
  });
}

/** Super-Admin: alle Konten (Passwort zurücksetzen, Super-Admin, löschen) und Realms (löschen). */
export async function superAdminDialog() {
  const body = h("div", {});
  const load = async () => {
    const d = await api.get("/api/super/overview");
    const realmName = Object.fromEntries(d.realms.map(r => [r.slug, r.name]));
    const me = store.account?.user?.id;
    mount(body,
      h("h3", { style: { fontSize: "15px" } }, `Konten (${d.users.length})`),
      h("div", { class: "pick-list" }, d.users.map(u => h("div", { class: "it", style: { alignItems: "flex-start" } },
        avatar({ id: u.id, name: u.name, color: u.color, hasAvatar: u.hasAvatar, avatarUrl: `/api/account/avatar/${u.id}` }, "sm"),
        h("div", { class: "grow" },
          h("div", {}, u.name, " ", u.isSuperAdmin ? h("span", { class: "chip gold" }, "Super-Admin") : null, !u.hasPassword ? h("span", { class: "chip" }, "ohne Passwort") : null),
          h("div", { class: "small muted" }, u.realms.length ? u.realms.map(s => realmName[s] || s).join(", ") : "in keinem Realm"),
          h("div", { class: "row wrap", style: { marginTop: "6px" } },
            h("button", { class: "btn sm", onClick: async () => { if (await confirmDialog("Passwort zurücksetzen?", `${u.name} legt beim nächsten Login ein neues Passwort fest.`, { okLabel: "Zurücksetzen", danger: false })) { await api.post(`/api/super/users/${u.id}/reset`); toast("Passwort zurückgesetzt", "success"); load(); } } }, "🔑 Zurücksetzen"),
            h("button", { class: "btn sm", onClick: async () => { await api.post(`/api/super/users/${u.id}/super`, { on: !u.isSuperAdmin }); toast(u.isSuperAdmin ? "Super-Admin entzogen" : "Ist jetzt Super-Admin", "success"); if (u.id === me && u.isSuperAdmin) location.reload(); else load(); } }, u.isSuperAdmin ? "Super-Admin entziehen" : "Zum Super-Admin"),
            u.id !== me ? h("button", { class: "btn sm ghost danger", onClick: async () => { if (await confirmDialog("Konto löschen?", `${u.name} wird aus allen Realms entfernt.`, { okLabel: "Löschen" })) { await api.del(`/api/super/users/${u.id}`); toast("Konto gelöscht", "success"); load(); } } }, "Löschen") : null))))),
      h("h3", { style: { fontSize: "15px", marginTop: "16px" } }, `Realms (${d.realms.length})`),
      h("div", { class: "pick-list" }, d.realms.map(r => h("div", { class: "it" },
        h("div", { class: "grow" }, h("div", {}, r.name), h("div", { class: "small muted" }, `${KIND_LABEL[r.kind] || r.kind} · ${r.members} Mitglied${r.members === 1 ? "" : "er"}`)),
        r.legacy ? h("span", { class: "chip" }, "erster Realm") : h("button", { class: "btn sm ghost danger", onClick: async () => {
          if (await confirmDialog(`„${r.name}“ löschen?`, "Alle Daten des Realms werden gelöscht. Die Konten bleiben.", { okLabel: "Endgültig löschen" })) {
            await api.del(`/api/super/realms/${encodeURIComponent(r.slug)}`); toast("Realm gelöscht", "success");
            if (r.slug === currentRealm()) { setRealm(""); location.href = location.pathname; } else load();
          }
        } }, "Löschen")))));
  };
  modal({ title: "Verwaltung", wide: true, body, buttons: [{ label: "Schließen" }] });
  load();
}

/** Admin: aktuelle LAN-Party zurücksetzen – Spiele und Mitglieder bleiben, Auswahl was weg soll. */
export function resetDialog() {
  const opts = [
    ["sessions", true, "Gespielte Runden", "Runden, Markierungen, Abstimmungen"],
    ["costs", true, "Kosten und Anwesenheit", "Einkäufe, Zahlungen, Anwesenheit"],
    ["equipment", true, "Ausrüstung: Zusagen", "Zusagen und Haken, die Liste bleibt"],
    ["xp", false, "XP und Level aller Mitglieder", "Alle starten bei Level 1"],
    ["posts", false, "Vorschläge und Forum", "Alle Vorschläge, Beiträge und Kommentare"],
  ];
  const shown = store.lan ? opts : opts.filter(([key]) => key !== "costs" && key !== "equipment");
  const boxes = shown.map(([key, def, label, hint]) => ({ key, box: h("input", { type: "checkbox", checked: def }), label, hint }));
  modal({
    title: store.lan ? "LAN zurücksetzen" : "Daten zurücksetzen",
    body: h("div", {},
      h("p", { class: "small" }, "Spiele und Mitglieder bleiben.", store.lan ? ` Ausgabe: ${store.event?.name ?? ""}` : ""),
      h("div", { class: "pick-list" }, boxes.map(b => h("label", { class: "it" }, b.box, h("div", { class: "grow" }, h("div", {}, b.label), h("div", { class: "small muted" }, b.hint))))),
      h("p", { class: "small", style: { color: "#ff9a9a", marginTop: "10px" } }, "Das lässt sich nicht rückgängig machen.")),
    buttons: [{ label: "Abbrechen" }, { label: "Zurücksetzen", class: "danger", onClick: async () => {
      const body = Object.fromEntries(boxes.map(b => [b.key, b.box.checked]));
      if (!Object.values(body).some(Boolean)) { toast("Nichts ausgewählt", "error"); return false; }
      if (!(await confirmDialog("Wirklich zurücksetzen?", "Die gewählten Daten werden gelöscht.", { okLabel: "Ja, zurücksetzen" }))) return false;
      const r = await api.post("/api/admin/reset", body);
      toast(`${r.deleted} Einträge gelöscht`, "success", 5000);
      renderRoute();
    } }],
  });
}

/** Admin: eigene Klänge fürs Glücksrad hochladen, probehören, zurücksetzen. */
export async function soundsDialog() {
  const KINDS = [["spin", "Beim Drehen", "Standard: Glocken-Bimmeln"], ["winner", "Beim Gewinner", "Standard: kurze Fanfare"]];
  const list = h("div", { class: "stack" });
  const load = async () => {
    const sounds = await api.get("/api/sounds");
    store.refreshSounds();
    mount(list, KINDS.map(([kind, label, fallback]) => {
      const cur = sounds[kind];
      const file = h("input", { type: "file", accept: "audio/*", class: "hidden", onChange: async () => {
        const f = file.files[0]; if (!f) return;
        if (!f.type.startsWith("audio/")) { toast("Bitte eine Audiodatei wählen", "error"); return; }
        if (f.size > 1_500_000) { toast("Datei zu groß (max. 1,5 MB)", "error"); return; }
        toast("Lade hoch …");
        const res = await fetch(`/api/sounds/${kind}`, { method: "POST", headers: { ...authHeaders(), "Content-Type": f.type, "X-File-Name": encodeURIComponent(f.name) }, body: f });
        if (!res.ok) { let msg = "Upload fehlgeschlagen"; try { msg = (await res.json()).error || msg; } catch { /* kein JSON */ } toast(msg, "error"); return; }
        toast("Klang gespeichert", "success"); load();
      } });
      return h("div", { class: "card", style: { padding: "10px 12px" } },
        h("div", { class: "row between wrap" }, h("strong", {}, label), cur ? h("span", { class: "chip gold" }, cur.name) : h("span", { class: "chip" }, fallback)),
        h("div", { class: "row wrap", style: { marginTop: "8px" } },
          h("button", { class: "btn sm", onClick: () => playSound(kind) }, "▶ Probehören"),
          h("button", { class: "btn sm primary", onClick: () => file.click() }, cur ? "Andere Datei" : "Datei wählen"), file,
          cur ? h("button", { class: "btn sm ghost danger", onClick: async () => { await api.del(`/api/sounds/${kind}`); toast("Zurückgesetzt auf Standard"); load(); } }, "Zurücksetzen") : null));
    }));
  };
  modal({
    title: "Glücksrad-Sounds",
    body: h("div", {}, h("p", { class: "muted small" }, "MP3, OGG, WAV oder M4A, max. 1,5 MB."), list),
    buttons: [{ label: "Schließen" }],
  });
  load();
}

/** Admin: Einladungscode anzeigen, kopieren, neu erzeugen. */
export async function inviteDialog() {
  const codeEl = h("code", { style: { fontSize: "26px", letterSpacing: ".2em", color: "var(--gold)" } }, "…");
  const linkEl = h("code", { class: "small", style: { wordBreak: "break-all" } }, "…");
  const inviteLink = (code) => `${location.origin}/?realm=${encodeURIComponent(currentRealm())}&invite=${encodeURIComponent(code)}`;
  const show = (code) => { codeEl.textContent = code; linkEl.textContent = inviteLink(code); };
  const load = async () => show((await api.get("/api/admin/invite")).code);
  modal({
    title: "Einladungslink",
    body: h("div", { style: { textAlign: "center" } },
      h("p", { class: "muted small" }, "Der Link führt nach dem Login direkt in den Realm."),
      h("div", { class: "card", style: { padding: "8px 10px" } }, linkEl),
      h("button", { class: "btn primary", style: { marginTop: "8px" }, onClick: async () => { toast((await copyText(linkEl.textContent)) ? "Link kopiert" : "Kopieren nicht möglich", "success"); } }, "Link kopieren"),
      h("div", { style: { margin: "14px 0" } }, codeEl),
      h("div", { class: "row wrap", style: { justifyContent: "center" } },
        h("button", { class: "btn", onClick: async () => { toast((await copyText(codeEl.textContent)) ? "Code kopiert" : "Kopieren nicht möglich", "success"); } }, "Code kopieren"),
        h("button", { class: "btn ghost", onClick: async () => { show((await api.post("/api/admin/invite")).code); toast("Neuer Code – der alte gilt nicht mehr"); } }, "Neu erzeugen"))),
    buttons: [{ label: "Schließen" }],
  });
  load();
}

/** Änderungsprotokoll (aus der Git-Historie). */
export async function showChangelog(onlyNew) {
  let data; try { data = await api.get("/api/changelog", { silent: true }); } catch { return; }
  const fresh = data.entries.filter(e => e.ts > data.seen);
  if (onlyNew && (!fresh.length || !data.seen)) {
    // Erster Besuch: nicht mit der ganzen Historie überfallen, nur als gesehen markieren
    if (!data.seen) api.post("/api/changelog/seen", {}, { silent: true }).catch(() => {});
    return;
  }
  const list = onlyNew ? fresh : data.entries;
  modal({
    title: onlyNew ? `Neu seit deinem letzten Besuch (${fresh.length})` : "Änderungsprotokoll",
    wide: true,
    body: h("div", { class: "changelog" }, list.map(e => h("div", { class: `entry ${e.ts > data.seen ? "new" : ""}` },
      h("div", { class: "row between" }, h("strong", {}, e.subject), h("span", { class: "small muted" }, new Date(e.ts).toLocaleDateString("de-AT"))),
      e.items.length ? h("ul", { class: "small" }, e.items.map(i => h("li", {}, i))) : null))),
    onClose: () => api.post("/api/changelog/seen", {}, { silent: true }).catch(() => {}),
    buttons: [{ label: "Alles klar" }],
  });
}

