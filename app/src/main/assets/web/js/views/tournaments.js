// Turniere: Liga, Swiss und K.o. mit Teams, Tabelle, Turnierbaum und Ergebniseingabe.
import { h, mount, modal, confirmDialog, avatar, empty, toast, input, field, fmtDate } from "../ui.js";
import { api } from "../api.js";
import { store, on } from "../store.js";

const FORMATS = {
  league: { label: "Liga", icon: "📊", hint: "Jeder spielt gegen jeden. Sieg 3, Unentschieden 1 Punkt." },
  swiss: { label: "Swiss", icon: "♟️", hint: "Mehrere Runden, Gegner mit ähnlichem Punktestand, keine Wiederholungen. Gut bei vielen Teams." },
  knockout: { label: "K.o.", icon: "🏆", hint: "Turnierbaum, wer verliert, ist raus. Freilose bei ungerader Teamzahl." },
};
const STATUS = { draft: ["Entwurf", ""], running: ["läuft", "green live"], done: ["beendet", "gold"] };

let openId = null;

export async function renderTournaments(main, params) {
  if (params[0]) openId = Number(params[0]); else openId = null;
  let list = [];
  const content = h("div");
  const load = async () => { list = await api.get("/api/tournaments"); draw(); };
  const draw = () => {
    const t = openId ? list.find(x => x.id === openId) : null;
    if (openId && !t) { openId = null; }
    mount(content, t ? detail(t) : overview());
  };

  const overview = () => h("div", {},
    h("div", { class: "page-head" }, h("h2", {}, "Turniere"), h("button", { class: "btn primary", onClick: () => editTournament() }, "+ Turnier")),
    list.length ? h("div", { class: "grid" }, list.map(t => {
      const winner = t.teams.find(x => x.id === t.winnerTeamId);
      return h("div", { class: "card tour-card", onClick: () => { location.hash = `#/tournaments/${t.id}`; } },
        h("div", { class: "row between" }, h("strong", {}, t.name), h("span", { class: `chip ${STATUS[t.status][1]}` }, STATUS[t.status][0])),
        h("div", { class: "small muted", style: { marginTop: "4px" } }, `${FORMATS[t.format].icon} ${FORMATS[t.format].label} · ${t.teams.length} Teams`, t.gameName ? ` · ${t.gameName}` : ""),
        winner ? h("div", { class: "small gold", style: { marginTop: "6px" } }, `🏆 ${winner.name}`) : null);
    })) : empty("🏆", "Noch kein Turnier. Leg das erste an!", h("button", { class: "btn primary", onClick: () => editTournament() }, "+ Turnier")),
  );

  const canManage = (t) => store.isAdmin || (store.me && store.me.id === t.createdBy);
  const myTeamIds = (t) => new Set(t.teams.filter(x => x.members.some(m => store.me && m.id === store.me.id)).map(x => x.id));
  const canReport = (t, m) => canManage(t) || myTeamIds(t).has(m.teamA) || myTeamIds(t).has(m.teamB);

  const detail = (t) => {
    const team = (id) => t.teams.find(x => x.id === id);
    const winner = team(t.winnerTeamId);
    const manage = canManage(t);
    const lastRound = Math.max(0, ...t.matches.map(m => m.round));
    const roundOpen = t.matches.some(m => m.round === lastRound && m.status === "pending");
    return h("div", {},
      h("div", { class: "page-head" },
        h("a", { class: "btn ghost", href: "#/tournaments" }, "← Alle"), h("h2", {}, t.name),
        h("span", { class: `chip ${STATUS[t.status][1]}` }, STATUS[t.status][0])),
      h("div", { class: "small muted" }, `${FORMATS[t.format].icon} ${FORMATS[t.format].label}`, t.format === "swiss" ? ` · ${t.rounds} Runden` : "", t.gameName ? ` · ${t.gameName}` : "", t.createdByName ? ` · Leitung: ${t.createdByName}` : ""),
      winner ? h("div", { class: "card gold", style: { marginTop: "12px", textAlign: "center" } }, h("div", { style: { fontSize: "32px" } }, "🏆"), h("h3", {}, winner.name), h("div", { class: "small muted" }, winner.members.map(m => m.name).join(", "), " · +100 XP")) : null,
      manage ? h("div", { class: "row wrap", style: { marginTop: "12px" } },
        t.status === "draft" ? h("button", { class: "btn primary", onClick: async () => { await api.post(`/api/tournaments/${t.id}/start`); toast("Turnier gestartet!", "success"); } }, "▶ Turnier starten") : null,
        t.status === "draft" ? h("button", { class: "btn", onClick: () => editTournament(t) }, "✎ Bearbeiten") : null,
        t.format === "swiss" && t.status === "running" && !roundOpen && lastRound < t.rounds ? h("button", { class: "btn primary", onClick: async () => { await api.post(`/api/tournaments/${t.id}/next-round`); toast(`Runde ${lastRound + 1} ausgelost`, "success"); } }, `🎲 Runde ${lastRound + 1} auslosen`) : null,
        h("button", { class: "btn danger", onClick: async () => { if (await confirmDialog("Turnier löschen?", `„${t.name}“ wird mit allen Ergebnissen entfernt.`)) { await api.del(`/api/tournaments/${t.id}`); location.hash = "#/tournaments"; } } }, "🗑 Turnier löschen")) : null,
      t.status === "draft" ? h("p", { class: "small muted", style: { marginTop: "10px" } }, "Entwurf: Teams lassen sich noch ändern. Mit „Turnier starten“ wird der Spielplan erstellt.") : null,
      t.format === "knockout" && t.status !== "draft" ? bracket(t, team) : null,
      t.format !== "knockout" && t.status !== "draft" ? table(t, team) : null,
      t.format !== "knockout" && t.status !== "draft" ? rounds(t, team) : null,
      teamsCard(t),
    );
  };

  const teamLabel = (tm, winner) => tm ? h("span", { class: winner ? "gold" : "" }, tm.name) : h("span", { class: "muted" }, "offen");

  const matchRow = (t, m, team) => {
    const a = team(m.teamA), b = team(m.teamB);
    if (m.status === "bye") return h("div", { class: "match bye" }, teamLabel(a || b), h("span", { class: "small muted" }, "Freilos"));
    const done = m.status === "done";
    const winA = done && m.scoreA > m.scoreB, winB = done && m.scoreB > m.scoreA;
    const editable = t.status !== "draft" && a && b && canReport(t, m);
    return h("div", { class: `match ${done ? "done" : ""} ${editable ? "editable" : ""}`, onClick: editable ? () => reportDialog(t, m, a, b) : null },
      h("div", { class: "side" }, teamLabel(a, winA), h("strong", { class: winA ? "gold" : "" }, done ? m.scoreA : "–")),
      h("div", { class: "side" }, teamLabel(b, winB), h("strong", { class: winB ? "gold" : "" }, done ? m.scoreB : "–")));
  };

  const bracket = (t, team) => {
    const byRound = new Map();
    for (const m of t.matches) (byRound.get(m.round) || byRound.set(m.round, []).get(m.round)).push(m);
    return h("div", { class: "card", style: { marginTop: "12px" } }, h("h3", {}, "Turnierbaum"),
      h("div", { class: "bracket" }, [...byRound.entries()].map(([r, ms]) => h("div", { class: "bracket-round" },
        h("div", { class: "small muted round-title" }, ms[0].roundName),
        h("div", { class: "bracket-matches" }, ms.map(m => matchRow(t, m, team)))))));
  };

  const table = (t, team) => h("div", { class: "card", style: { marginTop: "12px" } }, h("h3", {}, "Tabelle"),
    h("div", { class: "table-wrap" }, h("table", { class: "standings" },
      h("thead", {}, h("tr", {}, h("th", {}, "#"), h("th", { class: "l" }, "Team"), h("th", {}, "Sp"), h("th", {}, "S"), h("th", {}, "U"), h("th", {}, "N"), h("th", {}, "+/−"), t.format === "swiss" ? h("th", { title: "Buchholz: Punkte der Gegner" }, "BH") : null, h("th", {}, "Pkt"))),
      h("tbody", {}, t.standings.map((s, i) => h("tr", { class: myTeamIds(t).has(s.teamId) ? "mine" : "" },
        h("td", {}, i + 1), h("td", { class: "l" }, team(s.teamId)?.name ?? "?"), h("td", {}, s.played), h("td", {}, s.won), h("td", {}, s.drawn), h("td", {}, s.lost),
        h("td", {}, `${s.scored}:${s.conceded}`), t.format === "swiss" ? h("td", {}, s.buchholz) : null, h("td", {}, h("strong", {}, s.points))))))));

  const rounds = (t, team) => {
    const byRound = new Map();
    for (const m of t.matches) (byRound.get(m.round) || byRound.set(m.round, []).get(m.round)).push(m);
    return h("div", { class: "card", style: { marginTop: "12px" } }, h("h3", {}, "Spielplan"),
      h("div", { class: "small muted" }, "Tippe auf ein Spiel, um das Ergebnis einzutragen."),
      [...byRound.entries()].map(([r, ms]) => h("div", { style: { marginTop: "10px" } }, h("div", { class: "small muted round-title" }, `Runde ${r}`),
        h("div", { class: "match-list" }, ms.map(m => matchRow(t, m, team))))));
  };

  const teamsCard = (t) => h("div", { class: "card", style: { marginTop: "12px" } }, h("h3", {}, `Teams (${t.teams.length})`),
    h("div", { class: "stack", style: { marginTop: "8px" } }, t.teams.map(tm => h("div", { class: "row wrap" },
      h("strong", { style: { minWidth: "110px" } }, tm.name),
      h("div", { class: "avatar-stack" }, tm.members.map(m => avatar(m, "xs"))),
      h("span", { class: "small muted" }, tm.members.map(m => m.name).join(", "))))));

  mount(main, content);
  await load();
  const offs = [on("tournaments", load), on("members", draw)];
  return () => offs.forEach(f => f());
}

function reportDialog(t, m, a, b) {
  const sa = input({ type: "number", min: 0, value: m.scoreA ?? "", inputmode: "numeric", style: { textAlign: "center", fontSize: "22px" } });
  const sb = input({ type: "number", min: 0, value: m.scoreB ?? "", inputmode: "numeric", style: { textAlign: "center", fontSize: "22px" } });
  const quick = (x, y) => h("button", { class: "btn sm", type: "button", onClick: () => { sa.value = x; sb.value = y; } }, `${x}:${y}`);
  modal({
    title: `${m.roundName}: Ergebnis`,
    body: h("div", {},
      h("div", { class: "score-entry" }, h("div", {}, h("div", { class: "small" }, a.name), sa), h("div", { class: "vs" }, ":"), h("div", {}, h("div", { class: "small" }, b.name), sb)),
      h("div", { class: "row wrap", style: { marginTop: "10px", justifyContent: "center" } }, h("span", { class: "small muted" }, "Schnell:"), quick(1, 0), quick(0, 1), t.format !== "knockout" ? quick(1, 1) : null, quick(2, 1), quick(1, 2)),
      t.format === "knockout" ? h("p", { class: "small muted", style: { marginTop: "8px" } }, "Im K.o. gibt es kein Unentschieden, der Sieger rückt automatisch weiter.") : null),
    buttons: [
      m.status === "done" ? { label: "Ergebnis löschen", class: "danger", onClick: async () => { await api.put(`/api/tournaments/${t.id}/matches/${m.id}`, { scoreA: null, scoreB: null }); } } : null,
      { label: "Abbrechen" },
      { label: "Speichern", class: "primary", onClick: async () => {
        if (sa.value === "" || sb.value === "") { toast("Beide Ergebnisse eintragen", "error"); return false; }
        const r = await api.put(`/api/tournaments/${t.id}/matches/${m.id}`, { scoreA: Number(sa.value), scoreB: Number(sb.value) });
        if (r.status === "done") toast(`🏆 ${r.teams.find(x => x.id === r.winnerTeamId)?.name} gewinnt das Turnier!`, "success", 6000); else toast("Ergebnis gespeichert", "success");
      } },
    ].filter(Boolean),
  });
}

/** Turnier anlegen oder (im Entwurf) bearbeiten: Name, Spiel, Art, Teams. */
async function editTournament(t) {
  const games = await api.get("/api/games").catch(() => []);
  let attendance = {};
  if (store.lan) try { attendance = (await api.get("/api/costs", { silent: true })).attendance || {}; } catch { /* egal */ }
  const day = store.currentDay();
  const present = new Set(!store.lan ? store.members.filter(m => store.isOnline(m.id)).map(m => m.id) : day ? store.members.filter(m => (attendance[m.id] || []).includes(day)).map(m => m.id) : []);

  const name = input({ value: t ? t.name : "", placeholder: "z. B. CS2 Nacht-Cup", maxlength: 80 });
  const game = h("select", { class: "select" }, h("option", { value: "" }, "– ohne Spiel –"), games.map(g => h("option", { value: g.id, selected: t && t.gameId === g.id }, g.name)));
  game.addEventListener("change", () => { if (!name.value.trim() && game.value) name.value = `${game.selectedOptions[0].textContent}-Turnier`; });
  let format = t ? t.format : "knockout";
  const formatBox = h("div", { class: "pick-list" });
  const roundsInput = input({ type: "number", min: 1, max: 20, value: t && t.format === "swiss" ? t.rounds : "", placeholder: "automatisch", inputmode: "numeric" });
  const roundsField = field("Swiss-Runden", roundsInput, "Leer lassen für die empfohlene Anzahl.");
  const drawFormats = () => {
    mount(formatBox, Object.entries(FORMATS).map(([k, f]) => h("label", { class: `it ${format === k ? "active" : ""}` },
      h("input", { type: "radio", name: "tformat", checked: format === k, onChange: () => { format = k; drawFormats(); } }),
      h("div", { class: "grow" }, h("div", {}, `${f.icon} ${f.label}`), h("div", { class: "small muted" }, f.hint)))));
    roundsField.classList.toggle("hidden", format !== "swiss");
  };
  drawFormats();

  // Teams: Zuordnung je Mitglied (0 = nicht dabei)
  let solo = t ? t.teams.every(x => x.members.length === 1) : true;
  let teamNames = t ? t.teams.map(x => x.name) : ["Team 1", "Team 2"];
  const assign = new Map();
  if (t) t.teams.forEach((tm, i) => tm.members.forEach(m => assign.set(m.id, i + 1)));
  else store.members.forEach((m, i) => { if (present.size ? present.has(m.id) : true) assign.set(m.id, solo ? 1 : 0); });
  const teamSize = input({ type: "number", min: 1, max: 10, value: 2, inputmode: "numeric", style: { width: "70px" } });
  const teamsBox = h("div");
  const modeBox = h("div", { class: "seg", style: { marginBottom: "8px" } });

  const drawTeams = () => {
    mount(modeBox,
      h("button", { type: "button", class: solo ? "active" : "", onClick: () => { solo = true; drawTeams(); } }, "👤 Einzelspieler"),
      h("button", { type: "button", class: !solo ? "active" : "", onClick: () => { solo = false; if (teamNames.length < 2) teamNames = ["Team 1", "Team 2"]; [...assign.keys()].forEach(k => { if (assign.get(k) > teamNames.length) assign.set(k, 0); }); drawTeams(); } }, "👥 Teams"));
    if (solo) {
      mount(teamsBox,
        h("div", { class: "small muted", style: { marginBottom: "6px" } }, present.size ? `Vorausgewählt: die ${present.size} ${store.lan ? "heute Anwesenden" : "gerade Online"}.` : "Wer spielt mit?"),
        h("div", { class: "pick-list" }, store.members.map(m => h("label", { class: "it" },
          h("input", { type: "checkbox", checked: assign.get(m.id) > 0, onChange: (e) => { if (e.target.checked) assign.set(m.id, 1); else assign.delete(m.id); } }),
          avatar(m, "xs"), h("span", { class: "grow" }, m.name), present.has(m.id) ? h("span", { class: "chip green" }, store.lan ? "heute da" : "online") : null))));
      return;
    }
    const counts = teamNames.map((_, i) => [...assign.values()].filter(v => v === i + 1).length);
    mount(teamsBox,
      h("div", { class: "row wrap", style: { marginBottom: "8px" } },
        h("span", { class: "small" }, "Teamgröße"), teamSize,
        h("button", { type: "button", class: "btn sm primary", onClick: () => {
          const pool = store.members.filter(m => present.size ? present.has(m.id) : true).map(m => m.id);
          const size = Math.max(1, Number(teamSize.value) || 2);
          for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
          const n = Math.max(2, Math.ceil(pool.length / size));
          teamNames = Array.from({ length: n }, (_, i) => teamNames[i] || `Team ${i + 1}`);
          assign.clear(); pool.forEach((id, i) => assign.set(id, (i % n) + 1));
          drawTeams(); toast(`${n} Teams ausgelost`, "success");
        } }, present.size ? (store.lan ? "🎲 Anwesende auslosen" : "🎲 Online-Leute auslosen") : "🎲 Alle auslosen"),
        h("button", { type: "button", class: "btn sm", onClick: () => { teamNames.push(`Team ${teamNames.length + 1}`); drawTeams(); } }, "+ Team")),
      h("div", { class: "team-names" }, teamNames.map((n, i) => h("div", { class: "row" },
        h("input", { class: "input", value: n, maxlength: 40, onInput: (e) => { teamNames[i] = e.target.value; } }),
        h("span", { class: "chip" }, counts[i]),
        teamNames.length > 2 ? h("button", { type: "button", class: "btn sm ghost danger", onClick: () => {
          teamNames.splice(i, 1); for (const [k, v] of assign) { if (v === i + 1) assign.set(k, 0); else if (v > i + 1) assign.set(k, v - 1); } drawTeams();
        } }, "✕") : null))),
      h("div", { class: "pick-list", style: { marginTop: "8px" } }, store.members.map(m => h("div", { class: "it" }, avatar(m, "xs"), h("span", { class: "grow" }, m.name),
        present.has(m.id) ? h("span", { class: "chip green" }, store.lan ? "da" : "online") : null,
        h("select", { class: "select", style: { width: "auto" }, onChange: (e) => { assign.set(m.id, Number(e.target.value)); drawTeams(); } },
          h("option", { value: 0, selected: !assign.get(m.id) }, "– nicht dabei –"),
          teamNames.map((n, i) => h("option", { value: i + 1, selected: assign.get(m.id) === i + 1 }, n)))))));
  };
  drawTeams();

  modal({
    title: t ? "Turnier bearbeiten" : "Neues Turnier",
    wide: true,
    body: h("div", {},
      h("div", { class: "form-row" }, field("Name *", name), field("Spiel", game)),
      field("Turnierart", formatBox), roundsField,
      field("Teilnehmer", h("div", {}, modeBox, teamsBox))),
    buttons: [{ label: "Abbrechen" }, { label: t ? "Speichern" : "Anlegen", class: "primary", onClick: async () => {
      if (!name.value.trim()) { toast("Name fehlt", "error"); return false; }
      let teams;
      if (solo) teams = store.members.filter(m => assign.get(m.id) > 0).map(m => ({ name: m.name, memberIds: [m.id] }));
      else teams = teamNames.map((n, i) => ({ name: n.trim() || `Team ${i + 1}`, memberIds: store.members.filter(m => assign.get(m.id) === i + 1).map(m => m.id) })).filter(x => x.memberIds.length);
      if (teams.length < 2) { toast("Mindestens zwei Teilnehmer bzw. Teams mit Mitgliedern", "error"); return false; }
      const body = { name: name.value.trim(), gameId: game.value ? Number(game.value) : null, format, rounds: roundsInput.value ? Number(roundsInput.value) : undefined, teams };
      const r = t ? await api.put(`/api/tournaments/${t.id}`, body) : await api.post("/api/tournaments", body);
      toast(t ? "Gespeichert" : "Turnier angelegt – jetzt starten", "success");
      location.hash = `#/tournaments/${r.id}`;
    } }],
  });
}
