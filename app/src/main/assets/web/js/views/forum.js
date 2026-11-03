// Community-Forum: Beiträge, Kommentare, organisatorische Hinweise (angepinnt).
import { h, mount, modal, confirmDialog, avatar, empty, timeAgo, fmtDate, toast, input, textarea, field, checkbox, linkify } from "../ui.js";
import { api } from "../api.js";
import { store, on } from "../store.js";
import { requireMe } from "../app.js";

export async function renderForum(main) {
  let posts = [];
  const content = h("div");
  const open = new Set();

  const load = async () => { posts = await api.get("/api/forum"); draw(); };

  const draw = () => {
    mount(content, posts.length ? h("div", { class: "stack" }, posts.map(card)) : empty("💬", "Noch keine Beiträge. Schreib den ersten!",
      h("button", { class: "btn primary", onClick: () => editPost() }, "+ Beitrag")));
  };

  const card = (p) => h("div", { class: `card post ${p.pinned ? "pinned" : ""}` },
    h("div", { class: "row top" },
      h("div", { class: "author grow" }, avatar(p, ""), h("div", { class: "meta" }, h("span", { class: "n" }, p.authorName), h("span", { class: "t", title: fmtDate(p.createdAt) }, timeAgo(p.createdAt)))),
      p.pinned ? h("span", { class: "chip gold" }, "📌 Organisation") : null,
      (store.isAdmin || (store.me && store.me.id === p.authorId)) ? h("button", { class: "btn sm ghost", onClick: () => editPost(p) }, "✎") : null,
      store.isAdmin ? h("button", { class: "btn sm ghost danger", onClick: async () => { if (await confirmDialog("Beitrag löschen?", p.title || "")) await api.del(`/api/forum/${p.id}`); } }, "✕") : null,
    ),
    p.title ? h("h3", { style: { margin: "10px 0 4px" } }, p.title) : null,
    h("div", { class: "body" }, linkify(p.body)),
    h("div", { class: "row", style: { marginTop: "8px" } },
      h("button", { class: `btn sm ${open.has(p.id) ? "active" : "ghost"}`, onClick: () => { open.has(p.id) ? open.delete(p.id) : open.add(p.id); draw(); } }, `💬 ${p.comments.length} Kommentar${p.comments.length === 1 ? "" : "e"}`)),
    open.has(p.id) ? comments(p) : null,
  );

  const comments = (p) => {
    const inp = input({ placeholder: "Antworten …", maxlength: 2000 });
    const send = async () => {
      if (!inp.value.trim()) return;
      if (!(await requireMe())) return;
      await api.post(`/api/forum/${p.id}/comments`, { text: inp.value.trim() });
      inp.value = "";
    };
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); send(); } });
    return h("div", { class: "comments" },
      p.comments.map(c => h("div", { class: "comment" }, avatar(c, "sm"),
        h("div", { class: "bubble" }, h("div", { class: "meta" }, h("strong", {}, c.authorName), h("span", { title: fmtDate(c.createdAt) }, timeAgo(c.createdAt)),
          store.isAdmin ? h("a", { href: "#", class: "muted", onClick: async (e) => { e.preventDefault(); if (await confirmDialog("Kommentar löschen?", "")) await api.del(`/api/forum/comments/${c.id}`); } }, "löschen") : null),
          h("div", { style: { whiteSpace: "pre-wrap" } }, linkify(c.text))))),
      h("div", { class: "comment-form" }, inp, h("button", { class: "btn", onClick: send }, "Senden")),
    );
  };

  mount(main,
    h("div", { class: "page-head" }, h("h2", {}, "Forum"), h("button", { class: "btn primary", onClick: () => editPost() }, "+ Beitrag")),
    content,
    h("button", { class: "btn primary fab", onClick: () => editPost(), "aria-label": "Beitrag" }, "+"),
  );
  await load();
  const off = on("forum", load);
  return () => off();
}

function editPost(p) {
  const title = input({ value: p ? p.title : "", placeholder: "Titel (optional)", maxlength: 140 });
  const body = textarea({ value: p ? p.body : "", placeholder: "Was gibt's? Links werden automatisch klickbar.", maxlength: 8000, style: { minHeight: "140px" } });
  const pinned = h("input", { type: "checkbox", checked: p ? p.pinned : false });
  modal({
    title: p ? "Beitrag bearbeiten" : "Neuer Beitrag",
    body: h("div", {}, field("Titel", title), field("Text *", body),
      h("label", { class: "check" }, pinned, h("span", {}, "📌 Organisatorischer Hinweis (bleibt oben angepinnt)"))),
    buttons: [{ label: "Abbrechen" }, { label: p ? "Speichern" : "Veröffentlichen", class: "primary", onClick: async () => {
      if (!body.value.trim()) { toast("Bitte einen Text schreiben", "error"); return false; }
      if (!p && !(await requireMe())) return false;
      const req = { title: title.value.trim(), body: body.value.trim(), pinned: pinned.checked };
      if (p) await api.put(`/api/forum/${p.id}`, req); else await api.post("/api/forum", req);
      toast(p ? "Gespeichert" : "Veröffentlicht (+10 XP)", "success");
    } }],
  });
}
