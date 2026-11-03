// Spieleverwaltung: Liste, aktuell gespielte Spiele, Historie, Auswahl für die nächste Runde.
import { h, mount, modal, confirmDialog, avatar, empty, fmtDate, fmtTime, duration, toast, checkbox, textarea, field, copyText } from "../ui.js";
import { api } from "../api.js";
import { store, on } from "../store.js";
import { gameForm } from "../steam.js";
import { requireMe } from "../app.js";
import { sharesDialog } from "./shares.js";

let tab = "all";

export async function renderGames(main, params) {
  if (params[0]) tab = params[0];
  let games = [], sessions = [];
  const content = h("div");
  const tabsEl = h("div", { class: "tabs" });
  let query = "";
  const search = h("input", { class: "input search-input", type: "search", placeholder: "🔍 Spiele durchsuchen …", autocomplete: "off",
    onInput: (e) => { query = e.target.value; draw(); } });
  const norm = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const matches = (g) => { const q = norm(query).trim(); if (!q) return true; const hay = norm(`${g.name} ${g.description} ${g.addedByName || ""} ${g.players}`); return q.split(/\s+/).every(w => hay.includes(w)); };

  const load = async () => {
    [games, sessions] = await Promise.all([api.get("/api/games"), api.get("/api/sessions")]);
    draw();
  };

  const draw = () => {
    const running = sessions.filter(s => !s.endedAt);
    const selected = games.filter(g => g.selectedForNext);
    const tabs = [
      ["all", `Alle (${games.length})`], ["selected", `Nächste Runde (${selected.length})`],
      ["running", `Läuft gerade (${running.length})`], ["history", "Historie"],
    ];
    mount(tabsEl, tabs.map(([id, label]) => h("button", { class: id === tab ? "active" : "", onClick: () => { tab = id; location.hash = `#/games/${id}`; draw(); } }, label)));
    if (tab === "running") mount(content, runningView(running));
    else if (tab === "history") mount(content, historyView(sessions.filter(s => s.endedAt)));
    else mount(content, listView((tab === "selected" ? selected : games).filter(matches)));
    search.classList.toggle("hidden", tab === "running" || tab === "history");
  };

  const listView = (list) => {
    if (!list.length && query.trim()) return empty("🔍", `Kein Spiel passt zu „${query.trim()}“.`, h("button", { class: "btn", onClick: () => { query = ""; search.value = ""; draw(); } }, "Suche leeren"));
    if (!list.length) return empty("🎮", tab === "selected" ? "Kein Spiel markiert." : "Noch keine Spiele. Füge das erste hinzu!",
      h("button", { class: "btn primary", onClick: () => editGame() }, "+ Spiel hinzufügen"));
    return h("div", { class: "grid" }, list.map(gameCard));
  };

  const gameCard = (g) => h("div", { class: "card game-card" },
    h("div", { class: "cover", style: g.imageUrl ? { backgroundImage: `url("${g.imageUrl}")` } : {} },
      !g.imageUrl ? h("div", { class: "ph" }, g.name.slice(0, 2).toUpperCase()) : null,
      h("div", { class: "badges" },
        g.playedThisEvent ? h("span", { class: "chip green" }, "✓ diese LAN gespielt") : null,
        g.timesPlayed ? h("span", { class: "chip" }, `${g.timesPlayed}× gespielt`) : null,
      ),
      h("button", { class: `star ${g.selectedForNext ? "on" : ""}`, title: "Für nächste Runde auswählen", onClick: async () => {
        await api.post(`/api/games/${g.id}/select`, { selected: !g.selectedForNext });
      } }, g.selectedForNext ? "★" : "☆"),
    ),
    h("div", { class: "body" },
      h("div", { class: "title" }, g.name),
      h("div", { class: "row wrap small muted" },
        g.players ? h("span", {}, "👥 " + g.players) : null,
        g.addedByName ? h("span", {}, "von " + g.addedByName) : null,
        g.lastPlayedAt ? h("span", {}, "zuletzt " + fmtDate(g.lastPlayedAt, { hour: undefined, minute: undefined })) : null,
      ),
      g.description ? h("div", { class: "clamp-3 small", style: { color: "var(--text-2)" } }, g.description) : null,
      g.sharePath ? h("div", { class: "share-row", title: "Ordner auf einer Freigabe im LAN" },
        h("span", {}, "💾"), h("code", { class: "share-path" }, g.sharePath),
        h("button", { class: "btn sm ghost", onClick: async () => toast((await copyText(g.sharePath)) ? "Pfad kopiert – im Explorer einfügen" : "Kopieren nicht möglich", "success") }, "Kopieren")) : null,
      h("div", { class: "actions" },
        h("button", { class: "btn sm primary", onClick: () => startSession(g) }, "▶ Jetzt spielen"),
        g.steamUrl ? h("a", { class: "btn sm", href: g.steamUrl, target: "_blank", rel: "noopener" }, "Steam") : null,
        h("button", { class: "btn sm ghost", onClick: () => editGame(g) }, "Bearbeiten"),
        h("button", { class: "btn sm ghost danger", onClick: async () => {
          if (await confirmDialog("Spiel löschen?", `„${g.name}“ wird samt Verknüpfungen entfernt.`)) await api.del(`/api/games/${g.id}`);
        } }, "✕"),
      ),
    ),
  );

  const runningView = (running) => {
    if (!running.length) return empty("⏸", "Gerade läuft nichts.",
      h("a", { class: "btn primary", href: "#/wheel" }, "Zum Glücksrad"));
    return h("div", { class: "stack" }, running.map(s => h("div", { class: "card gold session" },
      h("div", { class: "thumb", style: s.imageUrl ? { backgroundImage: `url("${s.imageUrl}")` } : {} }),
      h("div", { class: "grow" },
        h("div", { class: "row wrap" }, h("strong", {}, s.gameName), h("span", { class: "chip green live" }, "● läuft seit " + fmtTime(s.startedAt)), chosenChip(s.chosenBy)),
        h("div", { class: "row", style: { marginTop: "6px" } },
          h("div", { class: "avatar-stack" }, s.participants.map(p => avatar(p, "sm"))),
          h("span", { class: "small muted" }, s.participants.length ? s.participants.map(p => p.name).join(", ") : "Keine Teilnehmer eingetragen"),
        ),
        s.note ? h("div", { class: "small muted" }, s.note) : null,
      ),
      h("div", { class: "col" },
        h("button", { class: "btn sm", onClick: () => editSession(s) }, "Teilnehmer"),
        h("button", { class: "btn sm primary", onClick: async () => { await api.post(`/api/sessions/${s.id}/end`); toast("Runde beendet – XP verteilt!", "success"); } }, "■ Beenden"),
      ),
    )));
  };

  const historyView = (done) => {
    if (!done.length) return empty("📜", "Die Spielhistorie ist noch leer.");
    const byEvent = new Map();
    for (const s of done) { if (!byEvent.has(s.eventId)) byEvent.set(s.eventId, []); byEvent.get(s.eventId).push(s); }
    return h("div", {}, [...byEvent.entries()].map(([eventId, list]) => {
      const ev = store.events.find(e => e.id === eventId);
      return h("div", { style: { marginBottom: "22px" } },
        h("div", { class: "cat-head" }, ev ? ev.name : "Frühere LAN", h("span", { class: "chip" }, `${list.length} Runden`)),
        h("div", { class: "timeline" }, list.map(s => h("div", { class: "card session" },
          h("div", { class: "thumb", style: s.imageUrl ? { backgroundImage: `url("${s.imageUrl}")` } : {} }),
          h("div", { class: "grow" },
            h("div", { class: "row wrap" }, h("strong", {}, s.gameName), chosenChip(s.chosenBy)),
            h("div", { class: "small muted" }, `${fmtDate(s.startedAt)} · ${duration(s.startedAt, s.endedAt)}`),
            h("div", { class: "row", style: { marginTop: "4px" } }, h("div", { class: "avatar-stack" }, s.participants.map(p => avatar(p, "xs"))),
              h("span", { class: "small muted" }, s.participants.map(p => p.name).join(", "))),
            s.note ? h("div", { class: "small" }, s.note) : null,
          ),
          h("div", { class: "col" },
            h("button", { class: "btn sm ghost", onClick: () => editSession(s) }, "✎"),
            h("button", { class: "btn sm ghost danger", onClick: async () => { if (await confirmDialog("Runde löschen?", "Die XP der Teilnehmer werden zurückgenommen.")) await api.del(`/api/sessions/${s.id}`); } }, "✕"),
          ),
        ))),
      );
    }));
  };

  mount(main,
    h("div", { class: "page-head" }, h("h2", {}, "Spiele"),
      store.lan ? h("button", { class: "btn", onClick: sharesDialog }, "💾 Freigaben") : null,
      h("button", { class: "btn primary", onClick: () => editGame() }, "+ Spiel")),
    tabsEl, search, content,
    h("button", { class: "btn primary fab", onClick: () => editGame(), "aria-label": "Spiel hinzufügen" }, "+"),
  );
  await load();
  const offs = [on("games", load), on("sessions", load), on("events", load)];
  return () => offs.forEach(f => f());
}

export function chosenChip(chosenBy) {
  if (chosenBy === "wheel") return h("span", { class: "chip gold" }, "🎡 Glücksrad");
  if (chosenBy === "vote") return h("span", { class: "chip purple" }, "🗳 Abstimmung");
  return null;
}

export function editGame(g) {
  const form = gameForm(g || {});
  modal({
    title: g ? "Spiel bearbeiten" : "Spiel hinzufügen",
    body: form.el,
    buttons: [
      { label: "Abbrechen" },
      { label: g ? "Speichern" : "Hinzufügen", class: "primary", onClick: async () => {
        if (!form.validate()) return false;
        if (!g) await requireMe();
        const v = form.values();
        if (g) await api.put(`/api/games/${g.id}`, v); else await api.post("/api/games", v);
        toast(g ? "Gespeichert" : "Spiel hinzugefügt", "success");
      } },
    ],
  });
}

/**
 * Teilnehmerauswahl: standardmäßig nur, wer für den heutigen LAN-Tag als anwesend eingetragen ist
 * (Kosten → Anwesenheit). Fehlt die Eintragung oder ist heute kein LAN-Tag, werden alle gezeigt.
 * Liefert { el, ids() }.
 */
async function participantPicker(preselected) {
  let attendance = {};
  if (store.lan) try { attendance = (await api.get("/api/costs", { silent: true })).attendance || {}; } catch { /* dann alle */ }
  const day = store.currentDay();
  // Online-Realm: statt „heute anwesend“ zählt „gerade online“
  const present = !store.lan ? store.members.filter(m => store.isOnline(m.id)) : day ? store.members.filter(m => (attendance[m.id] || []).includes(day)) : [];
  const pre = preselected ? new Set(preselected) : null;
  let showAll = !present.length;
  const checks = store.members.map(m => ({ m, present: present.includes(m), box: h("input", { type: "checkbox", checked: pre ? pre.has(m.id) : present.includes(m) || !present.length }) }));
  const list = h("div", { class: "pick-list" });
  const hint = h("div", { class: "small muted", style: { marginBottom: "6px" } });
  const toggle = h("button", { class: "btn sm ghost", onClick: () => { showAll = !showAll; draw(); } });
  const draw = () => {
    const visible = checks.filter(c => showAll || c.present || (pre && pre.has(c.m.id)));
    mount(list, visible.map(({ m, box, present: isP }) => h("label", { class: "it" }, box, avatar(m, "sm"), h("span", { class: "grow" }, m.name), isP ? h("span", { class: "chip green" }, store.lan ? "heute da" : "online") : null)));
    hint.textContent = !store.lan ? (!present.length ? "Niemand online – alle angezeigt."
        : showAll ? `Alle · ${present.length} online` : `${present.length} online`)
      : !day ? "Heute kein LAN-Tag – alle angezeigt."
      : !present.length ? `Für Tag ${day} niemand eingetragen – alle angezeigt.`
      : showAll ? `Alle · ${present.length} heute da` : `${present.length} heute da`;
    toggle.textContent = showAll ? "Nur Anwesende" : "Alle Mitglieder zeigen";
    toggle.classList.toggle("hidden", !present.length);
  };
  draw();
  const el = h("div", {}, hint,
    h("div", { class: "row wrap", style: { marginBottom: "8px" } },
      h("button", { class: "btn sm ghost", onClick: () => checks.forEach(c => { if (showAll || c.present) c.box.checked = true; }) }, "Alle"),
      h("button", { class: "btn sm ghost", onClick: () => checks.forEach(c => c.box.checked = false) }, "Keiner"), toggle),
    list);
  return { el, ids: () => checks.filter(c => c.box.checked).map(c => c.m.id) };
}

/** Dialog: Spiel starten mit Teilnehmerauswahl. */
export async function startSession(game, chosenBy = "manual") {
  const picker = await participantPicker(null);
  const note = textarea({ placeholder: "Notiz (optional), z. B. Ergebnis oder Modus", style: { minHeight: "60px" } });
  modal({
    title: `„${game.name}“ starten`,
    body: h("div", {},
      h("p", { class: "muted small" }, "Wer spielt mit?"),
      picker.el,
      h("div", { style: { marginTop: "10px" } }, field("Notiz", note)),
    ),
    buttons: [
      { label: "Abbrechen" },
      { label: "▶ Los geht's", class: "primary", onClick: async () => {
        await api.post("/api/sessions", { gameId: game.id, participantIds: picker.ids(), chosenBy, note: note.value });
        toast(`${game.name} läuft!`, "success");
        location.hash = "#/games/running";
      } },
    ],
  });
}

async function editSession(s) {
  const picker = await participantPicker(s.participants.map(p => p.id));
  const note = textarea({ value: s.note, style: { minHeight: "60px" } });
  modal({
    title: `Teilnehmer: ${s.gameName}`,
    body: h("div", {}, picker.el, h("div", { style: { marginTop: "10px" } }, field("Notiz", note))),
    buttons: [{ label: "Abbrechen" }, { label: "Speichern", class: "primary", onClick: async () => {
      await api.put(`/api/sessions/${s.id}`, { participantIds: picker.ids(), note: note.value });
    } }],
  });
}
