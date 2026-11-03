// Community-Forum: Beiträge, Kommentare, organisatorische Hinweise (angepinnt).
import { h, mount, modal, confirmDialog, avatar, empty, timeAgo, fmtDate, toast, input, textarea, field, checkbox, linkify, shrinkImage, mediaGrid } from "../ui.js";
import { api, authHeaders } from "../api.js";
import { store, on } from "../store.js";
import { requireMe } from "../app.js";

/** Bild/GIF hochladen; liefert { id, url, … } vom Server. */
async function uploadImage(file) {
  if (!/^image\/(jpeg|png|gif|webp)$/.test(file.type)) throw new Error("Nur JPG, PNG, GIF oder WebP");
  const blob = await shrinkImage(file);
  if (blob.size > 1_500_000) throw new Error(file.type === "image/gif" ? "GIF ist zu groß (max. 1,5 MB)" : "Bild ist zu groß");
  const res = await fetch("/api/media", { method: "POST", headers: { ...authHeaders(), "Content-Type": blob.type || file.type, "X-File-Name": encodeURIComponent(file.name || "bild") }, body: blob });
  if (!res.ok) { let msg = "Upload fehlgeschlagen"; try { msg = (await res.json()).error || msg; } catch { /* kein JSON */ } throw new Error(msg); }
  return res.json();
}

const IMAGE_URL = /^https?:\/\/\S+\.(gif|png|jpe?g|webp)(\?\S*)?$/i;
const GIF_HOSTS = /^https?:\/\/(media\d*\.giphy\.com|i\.giphy\.com|media\.tenor\.com|c\.tenor\.com|i\.imgur\.com)\//i;

/** Anhang-Auswahl mit Vorschau. Dateien kommen per Knopf, Strg+V, Ziehen oder als eingefügter Bild-Link. */
function attachmentPicker(existing = [], { compact = false } = {}) {
  const items = existing.map(m => ({ ...m }));
  const thumbs = h("div", { class: "attach-thumbs" });
  const full = () => { if (items.length >= 8) { toast("Maximal 8 Bilder pro Beitrag", "error"); return true; } return false; };
  const addFiles = async (files) => {
    for (const f of files) {
      if (full()) break;
      const ph = { id: null, url: URL.createObjectURL(f), pending: true };
      items.push(ph); draw();
      try { const m = await uploadImage(f); Object.assign(ph, m, { pending: false }); }
      catch (e) { items.splice(items.indexOf(ph), 1); toast(e.message, "error"); }
      draw();
    }
  };
  const addUrl = async (url) => {
    if (full()) return;
    const ph = { id: null, url, pending: true };
    items.push(ph); draw();
    try { const m = await api.post("/api/media/url", { url }, { silent: true }); Object.assign(ph, m, { pending: false }); }
    catch (e) { items.splice(items.indexOf(ph), 1); toast(e.message, "error"); }
    draw();
  };
  /** Strg+V auf einem Textfeld: Bilder aus der Zwischenablage oder ein Bild-Link werden Anhang. */
  const bindPaste = (el) => {
    el.addEventListener("paste", (e) => {
      const cd = e.clipboardData; if (!cd) return;
      const files = [...cd.items].filter(i => i.kind === "file" && i.type.startsWith("image/")).map(i => i.getAsFile()).filter(Boolean);
      if (files.length) { e.preventDefault(); addFiles(files); return; }
      const text = (cd.getData("text/plain") || "").trim();
      if (text && !/\s/.test(text) && (IMAGE_URL.test(text) || GIF_HOSTS.test(text))) { e.preventDefault(); addUrl(text); }
    });
  };
  /** Bilder auf das Element ziehen. */
  const bindDrop = (el) => {
    el.addEventListener("dragover", (e) => { if ([...(e.dataTransfer?.items || [])].some(i => i.kind === "file")) { e.preventDefault(); el.classList.add("drop-target"); } });
    el.addEventListener("dragleave", () => el.classList.remove("drop-target"));
    el.addEventListener("drop", (e) => {
      el.classList.remove("drop-target");
      const files = [...(e.dataTransfer?.files || [])].filter(f => f.type.startsWith("image/"));
      if (files.length) { e.preventDefault(); addFiles(files); return; }
      const url = (e.dataTransfer?.getData("text/uri-list") || e.dataTransfer?.getData("text/plain") || "").trim();
      if (url && (IMAGE_URL.test(url) || GIF_HOSTS.test(url))) { e.preventDefault(); addUrl(url); }
    });
  };
  const file = h("input", { type: "file", accept: "image/jpeg,image/png,image/gif,image/webp", multiple: true, class: "hidden", onChange: () => { const f = [...file.files]; file.value = ""; addFiles(f); } });
  const draw = () => mount(thumbs, items.map(m => h("div", { class: `attach-thumb ${m.pending ? "pending" : ""}` },
    h("img", { src: m.url, alt: "" }),
    h("button", { class: "rm", type: "button", "aria-label": "Entfernen", onClick: () => { items.splice(items.indexOf(m), 1); draw(); } }, "✕"))));
  draw();
  const btn = h("button", { class: compact ? "btn icon" : "btn sm", type: "button", title: "Bild oder GIF anhängen", onClick: () => file.click() }, compact ? "📷" : "📷 Bild / GIF");
  const el = h("div", { class: "attach" }, compact ? null : thumbs, btn, file);
  return { el, thumbs, bindPaste, bindDrop, ids: () => items.filter(m => m.id).map(m => m.id), busy: () => items.some(m => m.pending) };
}

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
    p.body ? h("div", { class: "body" }, linkify(p.body)) : null,
    mediaGrid(p.media),
    h("div", { class: "row", style: { marginTop: "8px" } },
      h("button", { class: `btn sm ${open.has(p.id) ? "active" : "ghost"}`, onClick: () => { open.has(p.id) ? open.delete(p.id) : open.add(p.id); draw(); } }, `💬 ${p.comments.length} Kommentar${p.comments.length === 1 ? "" : "e"}`)),
    open.has(p.id) ? comments(p) : null,
  );

  const comments = (p) => {
    const inp = input({ placeholder: "Antworten …", maxlength: 2000 });
    const pick = attachmentPicker([], { compact: true });
    const send = async () => {
      if (!inp.value.trim() && !pick.ids().length) return;
      if (pick.busy()) { toast("Bild wird noch hochgeladen …"); return; }
      if (!(await requireMe())) return;
      await api.post(`/api/forum/${p.id}/comments`, { text: inp.value.trim(), mediaIds: pick.ids() });
      inp.value = "";
    };
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); send(); } });
    pick.bindPaste(inp);
    const box = h("div", { class: "comments" },
      p.comments.map(c => h("div", { class: "comment" }, avatar(c, "sm"),
        h("div", { class: "bubble" }, h("div", { class: "meta" }, h("strong", {}, c.authorName), h("span", { title: fmtDate(c.createdAt) }, timeAgo(c.createdAt)),
          store.isAdmin ? h("a", { href: "#", class: "muted", onClick: async (e) => { e.preventDefault(); if (await confirmDialog("Kommentar löschen?", "")) await api.del(`/api/forum/comments/${c.id}`); } }, "löschen") : null),
          c.text ? h("div", { style: { whiteSpace: "pre-wrap" } }, linkify(c.text)) : null, mediaGrid(c.media)))),
      h("div", { class: "comment-form" }, inp, pick.el, h("button", { class: "btn", onClick: send }, "Senden")),
      pick.thumbs,
    );
    pick.bindDrop(box);
    return box;
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
  const body = textarea({ value: p ? p.body : "", placeholder: "Was gibt's?", maxlength: 8000, style: { minHeight: "140px" } });
  const pinned = h("input", { type: "checkbox", checked: p ? p.pinned : false });
  const pick = attachmentPicker(p ? p.media || [] : []);
  pick.bindPaste(body); pick.bindPaste(title);
  const ctx = modal({
    title: p ? "Beitrag bearbeiten" : "Neuer Beitrag",
    body: h("div", {}, field("Titel", title), field("Text", body), field("Bilder / GIFs", pick.el, "Strg+V, Hineinziehen oder GIF-Link einfügen."),
      h("label", { class: "check" }, pinned, h("span", {}, "📌 Oben anpinnen"))),
    buttons: [{ label: "Abbrechen" }, { label: p ? "Speichern" : "Veröffentlichen", class: "primary", onClick: async () => {
      if (!body.value.trim() && !pick.ids().length) { toast("Bitte einen Text schreiben oder ein Bild anhängen", "error"); return false; }
      if (pick.busy()) { toast("Bild wird noch hochgeladen …"); return false; }
      if (!p && !(await requireMe())) return false;
      const req = { title: title.value.trim(), body: body.value.trim(), pinned: pinned.checked, mediaIds: pick.ids() };
      if (p) await api.put(`/api/forum/${p.id}`, req); else await api.post("/api/forum", req);
      toast(p ? "Gespeichert" : "Veröffentlicht (+10 XP)", "success");
    } }],
  });
  pick.bindDrop(ctx.body);
}
