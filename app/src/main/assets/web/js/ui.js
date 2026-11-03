// DOM-Helfer, Modale, Toasts und Formatierung.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "html") el.innerHTML = v;
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k in el && typeof v !== "string") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
export function mount(el, ...children) { clear(el); append(el, children); return el; }

export function toast(message, kind = "info", ms = 3200) {
  let box = document.querySelector(".toasts");
  if (!box) { box = h("div", { class: "toasts" }); document.body.append(box); }
  const t = h("div", { class: `toast ${kind}` }, message);
  box.append(t);
  setTimeout(() => { t.style.opacity = "0"; t.style.transition = "opacity .3s"; setTimeout(() => t.remove(), 320); }, ms);
}

/**
 * Öffnet ein Modal. Gibt { close, body, setBusy } zurück.
 * buttons: [{ label, class, onClick(ctx) → bei Rückgabe false bleibt offen }]
 */
export function modal({ title, body, buttons = [], wide = false, onClose }) {
  const back = h("div", { class: "modal-back" });
  const bodyEl = h("div", { class: "modal-body" });
  const foot = h("div", { class: "modal-foot" });
  const ctx = {
    body: bodyEl,
    close() { back.remove(); document.removeEventListener("keydown", onKey); onClose && onClose(); },
    setBusy(b) { foot.querySelectorAll("button").forEach(x => x.disabled = b); },
  };
  const onKey = (e) => { if (e.key === "Escape") ctx.close(); };
  document.addEventListener("keydown", onKey);
  const box = h("div", { class: `modal${wide ? " wide" : ""}` },
    h("div", { class: "modal-head" }, h("h3", {}, title), h("button", { class: "btn ghost icon", onClick: ctx.close, "aria-label": "Schließen" }, "✕")),
    bodyEl,
    buttons.length ? foot : null,
  );
  if (typeof body === "function") body = body(ctx);
  append(bodyEl, [body]);
  for (const b of buttons) {
    foot.append(h("button", {
      class: `btn ${b.class || ""}`,
      onClick: async () => {
        if (!b.onClick) return ctx.close();
        ctx.setBusy(true);
        try {
          const r = await b.onClick(ctx);
          if (r !== false) ctx.close();
        } catch (e) {
          // Fehler wurde bereits per Toast gemeldet
        } finally { ctx.setBusy(false); }
      },
    }, b.label));
  }
  back.append(box);
  back.addEventListener("click", (e) => { if (e.target === back) ctx.close(); });
  document.body.append(back);
  const first = bodyEl.querySelector("input, textarea, select");
  if (first && window.matchMedia("(min-width: 640px)").matches) setTimeout(() => first.focus(), 50);
  return ctx;
}

export function confirmDialog(title, text, { okLabel = "Ja, löschen", danger = true } = {}) {
  return new Promise((resolve) => {
    modal({
      title,
      body: h("p", {}, text),
      onClose: () => resolve(false),
      buttons: [
        { label: "Abbrechen" },
        { label: okLabel, class: danger ? "danger" : "primary", onClick: () => { resolve(true); } },
      ],
    });
  });
}

// ---------- Formulare ----------
export function field(label, input, hint) {
  return h("div", { class: "field" }, h("label", {}, label), input, hint ? h("div", { class: "hint" }, hint) : null);
}
export function input(attrs = {}) { return h("input", { class: "input", ...attrs }); }
export function textarea(attrs = {}) { return h("textarea", { class: "textarea", ...attrs }); }
export function select(options, attrs = {}) {
  const s = h("select", { class: "select", ...attrs });
  for (const o of options) s.append(h("option", { value: o.value, selected: String(o.value) === String(attrs.value) }, o.label));
  return s;
}
export function checkbox(label, attrs = {}) {
  const c = h("input", { type: "checkbox", ...attrs });
  return h("label", { class: "check" }, c, h("span", {}, label));
}

// ---------- Darstellung ----------
export function initials(name) {
  return (name || "?").split(/\s+/).map(p => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

export function avatar(member, size = "") {
  const cls = `avatar ${size}`;
  if (!member) return h("div", { class: cls, style: { background: "#333" } }, "?");
  if (member.hasAvatar || member.authorHasAvatar) {
    const id = member.id ?? member.authorId;
    // avatarUrl enthält den Upload-Zeitstempel, damit der Browser nach einem neuen Bild nicht das alte aus dem Cache zeigt
    const src = member.avatarUrl || `/api/members/${id}/avatar?v=${member.createdAt || ""}`;
    return h("div", { class: cls, style: { borderColor: member.color || member.authorColor || "" } },
      h("img", { src, alt: "", loading: "lazy" }));
  }
  const color = member.color || member.authorColor || "#8e97a8";
  return h("div", { class: cls, style: { background: color, borderColor: color }, title: member.name || member.authorName }, initials(member.name || member.authorName));
}

export function fmtDate(ts, opts = {}) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleString("de-AT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", ...opts });
}
export function fmtDay(ts) { return new Date(ts).toLocaleDateString("de-AT", { weekday: "short", day: "2-digit", month: "2-digit" }); }
export function fmtTime(ts) { return new Date(ts).toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" }); }

export function timeAgo(ts) {
  const diff = Math.max(0, Date.now() - ts);
  const m = Math.floor(diff / 60000);
  if (m < 1) return "gerade eben";
  if (m < 60) return `vor ${m} min`;
  const hrs = Math.floor(m / 60);
  if (hrs < 24) return `vor ${hrs} h`;
  const d = Math.floor(hrs / 24);
  if (d < 7) return `vor ${d} Tag${d === 1 ? "" : "en"}`;
  return fmtDate(ts, { hour: undefined, minute: undefined });
}

export function fmtEuro(cents) {
  const sign = cents < 0 ? "-" : "";
  const a = Math.abs(cents);
  return `${sign}${Math.floor(a / 100)},${String(a % 100).padStart(2, "0")} €`;
}
export function parseEuro(text) {
  const v = parseFloat(String(text).replace(/[€\s]/g, "").replace(",", "."));
  if (isNaN(v)) return null;
  return Math.round(v * 100);
}

export function duration(from, to) {
  const ms = (to || Date.now()) - from;
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

export function dayLabel(startDate, day) {
  // startDate ISO (yyyy-mm-dd), day 1-basiert
  const d = new Date(startDate + "T00:00:00");
  if (isNaN(d)) return `Tag ${day}`;
  d.setDate(d.getDate() + (day - 1));
  return d.toLocaleDateString("de-AT", { weekday: "short", day: "2-digit", month: "2-digit" });
}

export function empty(icon, text, action) {
  return h("div", { class: "empty" }, h("div", { class: "big" }, icon), h("div", {}, text), action ? h("div", { style: { marginTop: "12px" } }, action) : null);
}

export function linkify(text) {
  const frag = document.createDocumentFragment();
  const re = /(https?:\/\/[^\s]+)/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    frag.append(text.slice(last, m.index));
    frag.append(h("a", { href: m[1], target: "_blank", rel: "noopener" }, m[1]));
    last = m.index + m[1].length;
  }
  frag.append(text.slice(last));
  return frag;
}

/** Bild im Browser verkleinern (für Avatar-Upload vom Handy). */
export function resizeImage(file, max = 512, quality = 0.86) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale), hh = Math.round(img.height * scale);
      const side = Math.min(w, hh);
      const c = document.createElement("canvas");
      c.width = side; c.height = side;
      const ctx = c.getContext("2d");
      // quadratischer Ausschnitt aus der Mitte
      ctx.drawImage(img, (w - side) / 2 / scale, (hh - side) / 2 / scale, side / scale, side / scale, 0, 0, side, side);
      URL.revokeObjectURL(url);
      c.toBlob((b) => b ? resolve(b) : reject(new Error("Bild konnte nicht verarbeitet werden")), "image/jpeg", quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Bild konnte nicht geladen werden")); };
    img.src = url;
  });
}

/** Text in die Zwischenablage; Fallback für http-Seiten ohne Clipboard-API. */
export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* Fallback unten */ }
  const ta = h("textarea", { value: text, style: { position: "fixed", opacity: "0", top: "0", left: "0" } });
  document.body.append(ta); ta.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch { ok = false; }
  ta.remove();
  return ok;
}

export function confetti(n = 120) {
  const box = h("div", { class: "confetti" });
  const colors = ["#c9a24d", "#e8d9a8", "#f1e7cf", "#8f6f2a", "#4fa3d9", "#6bbf59", "#e05c8a"];
  for (let i = 0; i < n; i++) {
    box.append(h("i", { style: {
      left: `${Math.random() * 100}%`, background: colors[i % colors.length],
      animationDuration: `${2.2 + Math.random() * 2}s`, animationDelay: `${Math.random() * .8}s`,
      transform: `rotate(${Math.random() * 360}deg)`,
    } }));
  }
  document.body.append(box);
  setTimeout(() => box.remove(), 5200);
}
