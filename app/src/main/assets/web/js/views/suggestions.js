// Spielvorschläge: aktuelle LAN vs. nächstes Jahr, Abstimmung, Kommentare, Übernahme in die Spieleliste.
import { h, mount, modal, confirmDialog, avatar, empty, timeAgo, toast, input, linkify } from "../ui.js";
import { api } from "../api.js";
import { store, on } from "../store.js";
import { gameForm } from "../steam.js";
import { requireMe } from "../app.js";

let scope = "current";

export async function renderSuggestions(main, params) {
  if (params[0] === "next" || params[0] === "current") scope = params[0];
  let list = [];
  const content = h("div");
  const tabsEl = h("div", { class: "tabs" });
  const open = new Set(); // aufgeklappte Kommentare

  const load = async () => { list = await api.get("/api/suggestions"); draw(); };

  const draw = () => {
    const cur = list.filter(s => s.scope === "current"), next = list.filter(s => s.scope === "next");
    mount(tabsEl,
      h("button", { class: scope === "current" ? "active" : "", onClick: () => { scope = "current"; location.hash = "#/suggestions/current"; draw(); } }, `Für diese LAN (${cur.length})`),
      h("button", { class: scope === "next" ? "active" : "", onClick: () => { scope = "next"; location.hash = "#/suggestions/next"; draw(); } }, `Für nächstes Jahr (${next.length})`),
    );
    const shown = (scope === "current" ? cur : next).slice().sort((a, b) => (b.score - a.score) || (b.createdAt - a.createdAt));
    mount(content,
      h("p", { class: "muted small" }, scope === "current"
        ? "Was sollen wir auf dieser LAN spielen? Stimme ab und diskutiere. Gute Vorschläge wandern in die Spieleliste."
        : "Ideen für die nächste LAN-Party. Bleiben dauerhaft gespeichert und werden beim Anlegen der nächsten Ausgabe übernommen."),
      shown.length ? h("div", { class: "stack" }, shown.map(card)) : empty("💡", "Noch keine Vorschläge. Mach den Anfang!",
        h("button", { class: "btn primary", onClick: () => editSuggestion(null, scope) }, "+ Vorschlag")),
    );
  };

  const card = (s) => {
    const mine = store.me && store.me.id === s.authorId;
    return h("div", { class: `card ${s.adoptedGameId ? "" : ""}` },
      h("div", { class: "suggestion" },
        h("div", { class: "vote-box" },
          h("button", { class: s.myVote > 0 ? "on" : "", title: "Dafür", onClick: () => vote(s, s.myVote > 0 ? 0 : 1) }, "▲"),
          h("div", { class: `score ${s.score > 0 ? "green" : s.score < 0 ? "red" : "muted"}` }, s.score > 0 ? `+${s.score}` : String(s.score)),
          h("button", { class: s.myVote < 0 ? "on down" : "", title: "Dagegen", onClick: () => vote(s, s.myVote < 0 ? 0 : -1) }, "▼"),
        ),
        s.imageUrl ? h("div", { class: "cover", style: { backgroundImage: `url("${s.imageUrl}")` } }) : null,
        h("div", { class: "grow" },
          h("div", { class: "row wrap" }, h("strong", {}, s.title),
            s.adoptedGameId ? h("a", { class: "chip green", href: "#/games" }, "✓ in Spieleliste") : null),
          h("div", { class: "author small muted", style: { marginTop: "2px" } }, avatar(s, "xs"), `${s.authorName} · ${timeAgo(s.createdAt)}`),
          s.description ? h("p", { class: "small", style: { marginTop: "6px", color: "var(--text-2)", whiteSpace: "pre-wrap" } }, linkify(s.description)) : null,
          h("div", { class: "row wrap", style: { marginTop: "6px" } },
            s.steamUrl ? h("a", { class: "btn sm", href: s.steamUrl, target: "_blank", rel: "noopener" }, "Steam") : null,
            h("button", { class: "btn sm ghost", onClick: () => { open.has(s.id) ? open.delete(s.id) : open.add(s.id); draw(); } }, `💬 ${s.comments.length}`),
            !s.adoptedGameId ? h("button", { class: "btn sm ghost gold", onClick: async () => {
              if (await confirmDialog("In Spieleliste übernehmen?", `„${s.title}“ wird als Spiel angelegt.`, { okLabel: "Übernehmen", danger: false })) { await api.post(`/api/suggestions/${s.id}/adopt`); toast("Übernommen!", "success"); }
            } }, "→ Übernehmen") : null,
            (mine || store.isAdmin) ? h("button", { class: "btn sm ghost", onClick: () => editSuggestion(s) }, "✎") : null,
            (mine || store.isAdmin) ? h("button", { class: "btn sm ghost danger", onClick: async () => { if (await confirmDialog("Vorschlag löschen?", s.title)) await api.del(`/api/suggestions/${s.id}`); } }, "✕") : null,
          ),
        ),
      ),
      open.has(s.id) ? comments(s) : null,
    );
  };

  const comments = (s) => {
    const inp = input({ placeholder: "Kommentar schreiben …", maxlength: 1000 });
    const send = async () => {
      if (!inp.value.trim()) return;
      if (!(await requireMe())) return;
      await api.post(`/api/suggestions/${s.id}/comments`, { text: inp.value.trim() });
      inp.value = "";
    };
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); send(); } });
    return h("div", { class: "comments" },
      s.comments.map(c => h("div", { class: "comment" }, avatar(c, "sm"),
        h("div", { class: "bubble" }, h("div", { class: "meta" }, h("strong", {}, c.authorName), timeAgo(c.createdAt),
          (store.isAdmin || (store.me && store.me.id === c.authorId)) ? h("a", { href: "#", class: "muted", onClick: async (e) => { e.preventDefault(); if (await confirmDialog("Kommentar löschen?", "")) await api.del(`/api/suggestions/comments/${c.id}`); } }, "löschen") : null),
          h("div", { style: { whiteSpace: "pre-wrap" } }, linkify(c.text))))),
      h("div", { class: "comment-form" }, inp, h("button", { class: "btn", onClick: send }, "Senden")),
    );
  };

  const vote = async (s, value) => {
    if (!(await requireMe())) return;
    await api.post(`/api/suggestions/${s.id}/vote`, { value });
  };

  mount(main,
    h("div", { class: "page-head" }, h("h2", {}, "Spielvorschläge"), h("button", { class: "btn primary", onClick: () => editSuggestion(null, scope) }, "+ Vorschlag")),
    tabsEl, content,
    h("button", { class: "btn primary fab", onClick: () => editSuggestion(null, scope), "aria-label": "Vorschlag" }, "+"),
  );
  await load();
  const offs = [on("suggestions", load), on("me", load)];
  return () => offs.forEach(f => f());
}

function editSuggestion(s, defaultScope = "current") {
  const form = gameForm(s || {}, { showPlayers: false });
  const scopeSel = h("div", { class: "seg", style: { marginBottom: "12px" } });
  let sc = s ? s.scope : defaultScope;
  const drawScope = () => mount(scopeSel,
    h("button", { class: sc === "current" ? "active" : "", onClick: () => { sc = "current"; drawScope(); } }, "Diese LAN"),
    h("button", { class: sc === "next" ? "active" : "", onClick: () => { sc = "next"; drawScope(); } }, "Nächstes Jahr"));
  drawScope();
  modal({
    title: s ? "Vorschlag bearbeiten" : "Spiel vorschlagen",
    body: h("div", {}, scopeSel, form.el),
    buttons: [{ label: "Abbrechen" }, { label: s ? "Speichern" : "Vorschlagen", class: "primary", onClick: async () => {
      if (!form.validate()) return false;
      if (!(await requireMe())) return false;
      const v = form.values();
      const body = { scope: sc, title: v.title, description: v.description, steamUrl: v.steamUrl, steamAppId: v.steamAppId, imageUrl: v.imageUrl };
      if (s) await api.put(`/api/suggestions/${s.id}`, body); else await api.post("/api/suggestions", body);
      toast(s ? "Gespeichert" : "Vorschlag eingereicht (+15 XP)", "success");
    } }],
  });
}
