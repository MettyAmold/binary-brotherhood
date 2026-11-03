// Einstieg: Shell, Navigation, Profil-Auswahl und Routing zu den Ansichten.
import { h, mount, avatar, modal, toast, field, input, confirmDialog } from "./ui.js";
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
  return h("div", { class: "me-chip", id: "me-chip", onClick: () => chooseProfile(true) },
    avatar(me, "sm"),
    h("span", { class: "name" }, me ? me.name : "Wer bist du?"),
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

/** Profil wählen oder neu anlegen. Wird beim ersten Besuch erzwungen. */
export function chooseProfile(allowCancel) {
  return new Promise((resolve) => {
    const list = h("div", { class: "pick-list" });
    const renderList = () => {
      mount(list, store.members.map(m => h("div", { class: "it", onClick: () => { store.selectMember(m.id); ctx.close(); resolve(m); } },
        avatar(m, "sm"), h("div", { class: "grow" }, h("div", {}, m.name), h("div", { class: "small muted" }, `Level ${m.level} · ${m.rank}`)),
        store.me && store.me.id === m.id ? h("span", { class: "chip gold" }, "aktiv") : null,
      )));
      if (!store.members.length) list.append(h("div", { class: "muted small" }, "Noch keine Profile. Lege das erste an!"));
    };
    renderList();
    const name = input({ placeholder: "Dein Name", maxlength: 40 });
    const ctx = modal({
      title: "Wer bist du?",
      onClose: () => resolve(store.me),
      body: h("div", {},
        h("p", { class: "muted small" }, "Wähle dein Profil. Es wird auf diesem Gerät gemerkt, alle Daten liegen zentral am Host-Handy."),
        list,
        h("hr", { class: "sep" }),
        h("div", { class: "row" }, h("div", { class: "grow" }, field("Neues Profil", name)),
          h("button", { class: "btn primary", style: { marginTop: "10px" }, onClick: async () => {
            if (!name.value.trim()) return;
            const m = await api.post("/api/members", { name: name.value.trim() });
            await store.refreshMembers();
            store.selectMember(m.id);
            toast(`Willkommen in der Bruderschaft, ${m.name}!`, "success");
            ctx.close(); resolve(m);
          } }, "Anlegen")),
      ),
      buttons: allowCancel ? [{ label: "Schließen" }] : [],
    });
    name.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); ctx.body.querySelector(".btn.primary").click(); } });
  });
}

/** Stellt sicher, dass ein Profil gewählt ist (für schreibende Aktionen). */
export async function requireMe() {
  if (store.me) return store.me;
  const m = await chooseProfile(true);
  if (!m) toast("Bitte zuerst ein Profil wählen", "error");
  return m;
}

async function init() {
  try {
    await store.bootstrap();
  } catch (e) {
    mount(root, h("div", { class: "gate" }, h("div", { class: "card" },
      h("div", { class: "hero" }, h("img", { src: "/logo.png", alt: "" }), h("div", { class: "title" }, "BINARY BROTHERHOOD")),
      h("p", { class: "muted" }, "Das Host-Handy antwortet nicht. Bist du im selben WLAN?"),
      h("button", { class: "btn primary block", onClick: () => location.reload() }, "Erneut versuchen"))));
    return;
  }
  connect();
  await renderRoute();
  if (!store.me) {
    // Erster Besuch: Profil wählen (kann übersprungen werden, dann nur lesend)
    chooseProfile(true);
  }
}

window.addEventListener("hashchange", renderRoute);
on("connection", (ok) => { const c = document.getElementById("conn"); if (c) c.classList.toggle("on", !!ok); });
on("members", () => { const chip = document.getElementById("me-chip"); if (chip) chip.replaceWith(meChip()); });
on("me", () => { const chip = document.getElementById("me-chip"); if (chip) chip.replaceWith(meChip()); });
on("events", () => { const chip = document.querySelector(".event-chip"); if (chip && store.event) chip.textContent = store.event.name; });

// Globale Fehler sichtbar machen (hilft beim Debuggen auf dem Handy)
window.addEventListener("unhandledrejection", (e) => { if (e.reason && e.reason.status === undefined && e.reason.message) toast(e.reason.message, "error"); });

init();
