// Einstieg: Login, Shell, Navigation und Routing zu den Ansichten.
import { h, mount, avatar, modal, toast, field, input, checkbox } from "./ui.js";
import { store, on, connect } from "./store.js";
import { api } from "./api.js";
import { renderGames } from "./views/games.js";
import { renderWheel } from "./views/wheel.js";
import { renderSuggestions } from "./views/suggestions.js";
import { renderMembers } from "./views/members.js";
import { renderForum } from "./views/forum.js";
import { renderCosts } from "./views/costs.js";
import { renderEquipment } from "./views/equipment.js";
import { renderOrganisation } from "./views/organisation.js";

const routes = [
  { id: "games", label: "Spiele", icon: "🎮", render: renderGames },
  { id: "wheel", label: "Glücksrad", icon: "🎡", render: renderWheel },
  { id: "suggestions", label: "Vorschläge", icon: "💡", render: renderSuggestions },
  { id: "members", label: "Mitglieder", icon: "🛡️", render: renderMembers },
  { id: "forum", label: "Forum", icon: "💬", render: renderForum },
  { id: "costs", label: "Kosten", icon: "💰", render: renderCosts },
  { id: "equipment", label: "Ausrüstung", icon: "🎒", render: renderEquipment },
  { id: "organisation", label: "LAN-Party", icon: "📅", render: renderOrganisation },
];

const root = document.getElementById("app");
let currentCleanup = null;

function currentRoute() {
  const hash = location.hash.replace(/^#\/?/, "");
  const [id, ...rest] = hash.split("/");
  return { route: routes.find(r => r.id === id) || routes[0], params: rest };
}

function renderShell() {
  const { route } = currentRoute();
  const header = h("header", { class: "header" },
    h("img", { class: "logo", src: "/logo.png", alt: "" }),
    h("div", { class: "brand" }, h("div", { class: "title" }, "BINARY BROTHERHOOD"), h("div", { class: "sub" }, "Ctrl Alt Delirium · Est. 2017")),
    h("div", { class: "spacer" }),
    store.event ? h("a", { class: "event-chip", href: "#/organisation" }, store.event.name) : null,
    h("div", { class: `conn ${store.connected ? "on" : ""}`, id: "conn", title: "Live-Verbindung" }),
    meChip(),
  );
  const nav = h("nav", { class: "nav" }, routes.map(r =>
    h("a", { href: `#/${r.id}`, class: r.id === route.id ? "active" : "" }, h("span", { class: "ico" }, r.icon), h("span", {}, r.label))
  ));
  const main = h("main", { class: "main", id: "main" });
  mount(root, h("div", { class: "app" }, header, nav, main));
  return main;
}

function meChip() {
  const me = store.me;
  return h("div", { class: "me-chip", id: "me-chip", onClick: profileMenu },
    avatar(me, "sm"),
    h("span", { class: "name" }, me ? me.name : "Anmelden"),
  );
}

async function renderRoute() {
  if (currentCleanup) { try { currentCleanup(); } catch { /* ignore */ } currentCleanup = null; }
  const main = renderShell();
  const { route, params } = currentRoute();
  try {
    currentCleanup = await route.render(main, params) || null;
  } catch (e) {
    console.error(e);
    mount(main, h("div", { class: "empty" }, h("div", { class: "big" }, "⚠️"), "Ansicht konnte nicht geladen werden: " + (e.message || e)));
  }
  window.scrollTo({ top: 0 });
}

// ---------- Login ----------

const passwordInput = (attrs = {}) => input({ type: "password", autocomplete: "current-password", ...attrs });

/** Enter springt zum nächsten Feld, im letzten Feld wird der Primär-Knopf des Dialogs ausgelöst. */
function chainEnter(inputs) {
  inputs.forEach((inp, i) => inp.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (i < inputs.length - 1) inputs[i + 1].focus();
    else inp.closest(".modal")?.querySelector(".modal-foot .btn.primary")?.click();
  }));
}

/** „Passwort anzeigen“ für alle übergebenen Felder, damit Tippfehler am Handy auffallen. */
function showPasswordToggle(...inputs) {
  return checkbox("Passwort anzeigen", { onChange: (e) => inputs.forEach(i => { i.type = e.target.checked ? "text" : "password"; }) });
}

/** Login-Bildschirm: Profil wählen und Passwort eingeben oder neues Profil anlegen. */
export async function renderLogin(message) {
  let members = [];
  try {
    members = await api.get("/api/auth/members", { silent: true });
  } catch (e) {
    mount(root, offlineGate());
    return;
  }
  const list = h("div", { class: "pick-list" }, members.length
    ? members.map(m => h("div", { class: "it", onClick: () => loginDialog(m) },
        avatar(m, "sm"), h("div", { class: "grow" }, h("div", {}, m.name), !m.hasPassword ? h("div", { class: "small muted" }, "noch kein Passwort – beim ersten Login festlegen") : null),
        h("span", { class: "muted" }, "›")))
    : h("div", { class: "muted small" }, "Noch keine Profile. Lege das erste an!"));
  mount(root, h("div", { class: "gate" }, h("div", { class: "card" },
    h("div", { class: "hero" }, h("img", { src: "/logo.png", alt: "" }), h("div", { class: "title" }, "BINARY BROTHERHOOD")),
    message ? h("p", { class: "small", style: { color: "#ff9a9a" } }, message) : null,
    h("p", { class: "muted small" }, "Wer bist du? Melde dich mit deinem Profil an."),
    list,
    h("hr", { class: "sep" }),
    h("button", { class: "btn primary block", onClick: registerDialog }, "Neues Profil anlegen"),
  )));
}

function offlineGate() {
  return h("div", { class: "gate" }, h("div", { class: "card" },
    h("div", { class: "hero" }, h("img", { src: "/logo.png", alt: "" }), h("div", { class: "title" }, "BINARY BROTHERHOOD")),
    h("p", { class: "muted" }, "Das Host-Handy antwortet nicht. Bist du im selben WLAN?"),
    h("button", { class: "btn primary block", onClick: () => location.reload() }, "Erneut versuchen")));
}

function loginDialog(m) {
  const pw = passwordInput({ placeholder: m.hasPassword ? "Passwort" : "Neues Passwort (mind. 4 Zeichen)", autocomplete: m.hasPassword ? "current-password" : "new-password" });
  const pw2 = passwordInput({ placeholder: "Passwort wiederholen", autocomplete: "new-password" });
  const submit = async (ctx) => {
    if (!m.hasPassword && pw.value !== pw2.value) { toast("Die Passwörter stimmen nicht überein", "error"); return false; }
    if (!pw.value) { toast("Passwort fehlt", "error"); return false; }
    const r = await api.post("/api/auth/login", { memberId: m.id, password: pw.value }, { noAuthRedirect: true });
    store.applyAuth(r);
    toast(`Willkommen zurück, ${r.member.name}!`, "success");
    init();
  };
  modal({
    title: `Anmelden als ${m.name}`,
    body: h("div", {},
      !m.hasPassword ? h("p", { class: "muted small" }, "Dieses Profil hat noch kein Passwort. Lege jetzt eines fest – es gilt ab sofort für alle Geräte.") : null,
      field(m.hasPassword ? "Passwort" : "Neues Passwort", pw),
      !m.hasPassword ? field("Wiederholen", pw2) : null,
      showPasswordToggle(pw, pw2)),
    buttons: [{ label: "Abbrechen" }, { label: m.hasPassword ? "Anmelden" : "Festlegen und anmelden", class: "primary", onClick: submit }],
  });
  chainEnter(m.hasPassword ? [pw] : [pw, pw2]);
  setTimeout(() => pw.focus(), 50);
}

function registerDialog() {
  const name = input({ placeholder: "Dein Name", maxlength: 40, autocomplete: "nickname" });
  const pw = passwordInput({ placeholder: "mind. 4 Zeichen", autocomplete: "new-password" });
  const pw2 = passwordInput({ placeholder: "Passwort wiederholen", autocomplete: "new-password" });
  modal({
    title: "Neues Profil",
    body: h("div", {},
      h("p", { class: "muted small" }, "Das Passwort schützt dein Profil, damit niemand in deinem Namen abstimmt oder schreibt."),
      field("Name", name), field("Passwort", pw), field("Wiederholen", pw2), showPasswordToggle(pw, pw2)),
    buttons: [{ label: "Abbrechen" }, { label: "Anlegen", class: "primary", onClick: async () => {
      if (!name.value.trim()) { toast("Name fehlt", "error"); return false; }
      if (pw.value.length < 4) { toast("Passwort muss mindestens 4 Zeichen haben", "error"); return false; }
      if (pw.value !== pw2.value) { toast("Die Passwörter stimmen nicht überein", "error"); return false; }
      const r = await api.post("/api/auth/register", { name: name.value.trim(), password: pw.value });
      store.applyAuth(r);
      toast(`Willkommen in der Bruderschaft, ${r.member.name}!`, "success");
      init();
    } }],
  });
  chainEnter([name, pw, pw2]);
}

/** Menü hinter dem Profil-Chip oben rechts. */
function profileMenu() {
  const me = store.me;
  if (!me) return;
  const ctx = modal({
    title: me.name,
    body: h("div", { class: "pick-list" },
      h("div", { class: "it", onClick: () => { ctx.close(); location.hash = `#/members/${me.id}`; } }, h("span", {}, "🛡️"), h("span", { class: "grow" }, "Mein Profil")),
      h("div", { class: "it", onClick: () => { ctx.close(); changePasswordDialog(); } }, h("span", {}, "🔑"), h("span", { class: "grow" }, "Passwort ändern")),
      h("div", { class: "it", onClick: async () => { ctx.close(); await store.logout(); renderLogin(); } }, h("span", {}, "🚪"), h("span", { class: "grow" }, "Abmelden")),
    ),
    buttons: [{ label: "Schließen" }],
  });
}

export function changePasswordDialog() {
  const old = passwordInput({ placeholder: "Aktuelles Passwort" });
  const pw = passwordInput({ placeholder: "mind. 4 Zeichen", autocomplete: "new-password" });
  const pw2 = passwordInput({ placeholder: "Passwort wiederholen", autocomplete: "new-password" });
  modal({
    title: "Passwort ändern",
    body: h("div", {}, field("Aktuelles Passwort", old), field("Neues Passwort", pw), field("Wiederholen", pw2), showPasswordToggle(old, pw, pw2),
      h("p", { class: "muted small" }, "Andere Geräte werden abgemeldet.")),
    buttons: [{ label: "Abbrechen" }, { label: "Speichern", class: "primary", onClick: async () => {
      if (pw.value.length < 4) { toast("Passwort muss mindestens 4 Zeichen haben", "error"); return false; }
      if (pw.value !== pw2.value) { toast("Die Passwörter stimmen nicht überein", "error"); return false; }
      const r = await api.post("/api/auth/password", { oldPassword: old.value, newPassword: pw.value }, { noAuthRedirect: true });
      store.applyAuth(r);
      toast("Passwort geändert", "success");
    } }],
  });
  chainEnter([old, pw, pw2]);
}

/** Für schreibende Aktionen: liefert das angemeldete Mitglied (ohne Login gibt es die App nicht). */
export async function requireMe() {
  if (store.me) return store.me;
  renderLogin();
  return null;
}

async function init() {
  let loggedIn;
  try {
    loggedIn = await store.loadSession();
  } catch (e) {
    mount(root, offlineGate());
    return;
  }
  if (!loggedIn) { renderLogin(); return; }
  try {
    await store.bootstrap();
  } catch (e) {
    mount(root, offlineGate());
    return;
  }
  connect();
  await renderRoute();
}

window.addEventListener("bb:unauthorized", () => {
  if (!store.me) return;
  store.me = null; store.isHost = false;
  renderLogin("Deine Sitzung ist abgelaufen, bitte melde dich neu an.");
});

window.addEventListener("hashchange", renderRoute);
on("connection", (ok) => { const c = document.getElementById("conn"); if (c) c.classList.toggle("on", !!ok); });
on("members", () => { const chip = document.getElementById("me-chip"); if (chip) chip.replaceWith(meChip()); });
on("me", () => { const chip = document.getElementById("me-chip"); if (chip) chip.replaceWith(meChip()); });
on("events", () => { const chip = document.querySelector(".event-chip"); if (chip && store.event) chip.textContent = store.event.name; });

// Globale Fehler sichtbar machen (hilft beim Debuggen auf dem Handy)
window.addEventListener("unhandledrejection", (e) => { if (e.reason && e.reason.status === undefined && e.reason.message) toast(e.reason.message, "error"); });

init();
