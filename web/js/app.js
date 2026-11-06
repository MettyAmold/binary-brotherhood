// Einstieg: Shell, Navigation, Routing, Start.
import { h, mount, avatar, modal, toast, dayLabel } from "./ui.js";
import { store, on, connect } from "./store.js";
import { api, currentRealm, setRealm } from "./api.js";
import { initAudio, playSound, banner, systemNotify, requestNotificationPermission } from "./notify.js";
import { renderLogin, renderRealmPicker, changePasswordDialog, switchRealm, offlineGate, pendingInvite, setPendingInvite, APK_URL, inAndroidApp } from "./account.js";
import { realmSettingsDialog, superAdminDialog, resetDialog, soundsDialog, inviteDialog, showChangelog } from "./admin.js";
import { loadDiscord, discordChip, discordSettingsDialog } from "./discord.js";
import { renderGames } from "./views/games.js";
import { renderWheel } from "./views/wheel.js";
import { renderTournaments } from "./views/tournaments.js";
import { renderSuggestions } from "./views/suggestions.js";
import { renderMembers } from "./views/members.js";
import { renderForum } from "./views/forum.js";
import { renderCosts } from "./views/costs.js";
import { renderEquipment } from "./views/equipment.js";
import { renderOrganisation } from "./views/organisation.js";

const routes = [
  { id: "games", label: "Spiele", icon: "🎮", render: renderGames },
  { id: "wheel", label: "Glücksrad", icon: "🎡", render: renderWheel },
  { id: "tournaments", label: "Turniere", icon: "🏆", render: renderTournaments },
  { id: "suggestions", label: "Vorschläge", icon: "💡", render: renderSuggestions },
  { id: "members", label: "Mitglieder", icon: "🛡️", render: renderMembers },
  { id: "forum", label: "Forum", icon: "💬", render: renderForum },
  { id: "costs", label: "Kosten", icon: "💰", render: renderCosts, lan: true },
  { id: "equipment", label: "Ausrüstung", icon: "🎒", render: renderEquipment, lan: true },
  { id: "organisation", label: "LAN-Party", icon: "📅", render: renderOrganisation, lan: true },
];
/** Online-Realms brauchen keine LAN-Party, Kosten, Ausrüstung oder Freigaben. */
const activeRoutes = () => routes.filter(r => !r.lan || store.lan);
const isLegacyRealm = () => currentRealm() === "binary-brotherhood";

const root = document.getElementById("app");
let currentCleanup = null;

function currentRoute() {
  const hash = location.hash.replace(/^#\/?/, "");
  const [id, ...rest] = hash.split("/");
  const list = activeRoutes();
  return { route: list.find(r => r.id === id) || list[0], params: rest };
}

function renderShell() {
  const { route } = currentRoute();
  const header = h("header", { class: "header" },
    h("img", { class: "logo", src: "/logo.png", alt: "" }),
    h("div", { class: "brand" }, h("div", { class: "title" }, store.realm?.name || "BINARY BROTHERHOOD"),
      h("div", { class: "sub" }, isLegacyRealm() ? "Ctrl Alt Delirium · Est. 2017" : store.lan ? "LAN-Party" : "Online-Spielesuche")),
    h("div", { class: "spacer" }),
    store.event && store.lan ? h("a", { class: "event-chip", href: "#/organisation" }, store.event.name) : null,
    discordChip(),
    onlineChip(),
    meChip(),
  );
  const nav = h("nav", { class: "nav" }, activeRoutes().map(r =>
    h("a", { href: `#/${r.id}`, class: r.id === route.id ? "active" : "" }, h("span", { class: "ico" }, r.icon), h("span", {}, r.label))
  ));
  const main = h("main", { class: "main", id: "main" });
  mount(root, h("div", { class: "app" }, header, nav, main));
  return main;
}

// ---------- Anwesenheit: während der LAN fragen, wer sich noch nicht eingetragen hat ----------
let attendancePromptOpen = false;
const snoozeKey = () => `bb.attSnooze.${store.event?.id}.${store.me?.id}`;
async function checkAttendance() {
  if (attendancePromptOpen || !store.me || !store.event) return;
  const day = store.currentDay();
  if (!day) return; // LAN läuft gerade nicht
  const d = new Date(); const today = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; // lokales Datum
  try { const s = localStorage.getItem(snoozeKey()); if (s === today || s === "never") return; } catch { /* privat */ }
  let costs; try { costs = await api.get("/api/costs", { silent: true }); } catch { return; }
  if ((costs.attendance[store.me.id] || []).length) return; // schon eingetragen
  attendancePromptOpen = true;
  const ev = store.event;
  const boxes = Array.from({ length: costs.days }, (_, i) => ({ day: i + 1, box: h("input", { type: "checkbox", checked: i + 1 >= day }) }));
  playSound("spin");
  modal({
    title: `🎮 ${ev.name} läuft!`,
    body: h("div", {},
      h("p", {}, `Heute ist Tag ${day}. An welchen Tagen bist du dabei?`),
      h("p", { class: "small muted" }, "+30 XP pro Tag."),
      h("div", { class: "pick-list" }, boxes.map(b => h("label", { class: "it" }, b.box,
        h("span", { class: "grow" }, `Tag ${b.day} · ${dayLabel(ev.startDate, b.day)}`), b.day === day ? h("span", { class: "chip gold" }, "heute") : null)))),
    onClose: () => { attendancePromptOpen = false; },
    buttons: [
      { label: "Später", onClick: () => { try { localStorage.setItem(snoozeKey(), today); } catch { /* privat */ } } },
      { label: "Bin nicht dabei", onClick: () => { try { localStorage.setItem(snoozeKey(), "never"); } catch { /* privat */ } } },
      { label: "Eintragen", class: "primary", onClick: async () => {
        const days = boxes.filter(b => b.box.checked).map(b => b.day);
        if (!days.length) { toast("Mindestens einen Tag wählen – oder „Bin nicht dabei“", "error"); return false; }
        await api.put("/api/costs/attendance", { memberId: store.me.id, days });
        toast(`Eingetragen für ${days.length} Tag${days.length === 1 ? "" : "e"} (+${days.length * 30} XP)`, "success");
      } },
    ],
  });
}
// Auch bei offener App: beim Zurückkehren in den Tab und stündlich prüfen (die LAN beginnt ja irgendwann)
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") checkAttendance(); });
setInterval(checkAttendance, 60 * 60 * 1000);

/** „● 3 online“ im Header; Klick zeigt, wer gerade verbunden ist. */
function onlineChip() {
  const n = store.online.length;
  return h("div", { class: `online-chip ${store.connected ? "on" : ""}`, id: "online-chip", title: store.connected ? (n ? store.online.map(o => o.name).join(", ") : "Niemand online") : "Keine Live-Verbindung", onClick: onlineDialog },
    h("span", { class: "dot" }), h("span", { class: "n" }, store.connected ? `${n} online` : "offline"));
}

function onlineDialog() {
  const list = store.online.map(o => store.member(o.id) || { id: o.id, name: o.name });
  modal({
    title: "Gerade online",
    body: list.length
      ? h("div", { class: "pick-list" }, list.map(m => h("div", { class: "it" }, avatar(m, "sm"), h("span", { class: "grow" }, m.name), h("span", { class: "chip green" }, "● online"))))
      : h("p", { class: "muted" }, store.connected ? "Außer dir ist niemand verbunden." : "Keine Live-Verbindung zum Server."),
    buttons: [{ label: "Schließen" }],
  });
}

function meChip() {
  const me = store.me;
  return h("div", { class: "me-chip", id: "me-chip", onClick: profileMenu },
    avatar(me, "sm"),
    h("span", { class: "name" }, me ? me.name : "Anmelden"),
  );
}

export async function renderRoute() {
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

/** Menü hinter dem Profil-Chip oben rechts. */
function profileMenu() {
  const me = store.me;
  if (!me) return;
  const ctx = modal({
    title: me.name,
    body: h("div", { class: "pick-list" },
      h("div", { class: "it", onClick: () => { ctx.close(); location.hash = `#/members/${me.id}`; } }, h("span", {}, "🛡️"), h("span", { class: "grow" }, "Mein Profil")),
      h("div", { class: "it", onClick: () => { ctx.close(); changePasswordDialog(); } }, h("span", {}, "🔑"), h("span", { class: "grow" }, "Passwort ändern")),
      store.isAdmin ? h("div", { class: "it", onClick: () => { ctx.close(); soundsDialog(); } }, h("span", {}, "🔊"), h("span", { class: "grow" }, "Glücksrad-Sounds")) : null,
      store.isAdmin ? h("div", { class: "it", onClick: () => { ctx.close(); realmSettingsDialog(); } }, h("span", {}, "⚙️"), h("span", { class: "grow" }, "Realm-Einstellungen")) : null,
      store.isAdmin ? h("div", { class: "it", onClick: () => { ctx.close(); resetDialog(); } }, h("span", {}, "🧹"), h("span", { class: "grow" }, store.lan ? "LAN zurücksetzen" : "Daten zurücksetzen")) : null,
      store.isAdmin ? h("div", { class: "it", onClick: () => { ctx.close(); discordSettingsDialog(); } }, h("span", {}, "💬"), h("span", { class: "grow" }, "Discord-Server")) : null,
      store.isAdmin ? h("div", { class: "it", onClick: () => { ctx.close(); showChangelog(false); } }, h("span", {}, "📜"), h("span", { class: "grow" }, "Änderungsprotokoll")) : null,
      ("Notification" in window) ? h("div", { class: "it", onClick: async () => { ctx.close(); const r = await requestNotificationPermission(); toast(r === "granted" ? "Benachrichtigungen aktiv" : "Benachrichtigungen nicht erlaubt", r === "granted" ? "success" : "error"); } }, h("span", {}, "🔔"), h("span", { class: "grow" }, "Benachrichtigungen erlauben")) : null,
      store.isAdmin ? h("div", { class: "it", onClick: () => { ctx.close(); inviteDialog(); } }, h("span", {}, "✉️"), h("span", { class: "grow" }, "Einladungslink")) : null,
      inAndroidApp ? null : h("a", { class: "it", href: APK_URL, rel: "noopener", style: { textDecoration: "none", color: "inherit" } }, h("span", {}, "📱"), h("span", { class: "grow" }, "Android-App herunterladen")),
      store.isSuperAdmin ? h("div", { class: "it", onClick: () => { ctx.close(); superAdminDialog(); } }, h("span", {}, "🛡️"), h("span", { class: "grow" }, "Verwaltung (alle Realms)")) : null,
      h("div", { class: "it", onClick: () => { ctx.close(); switchRealm(); } }, h("span", {}, "🌐"), h("span", { class: "grow" }, "Realm wechseln"), h("span", { class: "small muted" }, store.realm?.name || "")),
      h("div", { class: "it", onClick: async () => { ctx.close(); await store.logout(); setRealm(""); location.href = location.pathname; } }, h("span", {}, "🚪"), h("span", { class: "grow" }, "Abmelden")),
    ),
    buttons: [{ label: "Schließen" }],
  });
}

/** Für schreibende Aktionen: liefert das angemeldete Mitglied (ohne Login gibt es die App nicht). */
export async function requireMe() {
  if (store.me) return store.me;
  renderLogin();
  return null;
}

export async function init() {
  // Einladungslink oder Direktlink: /?realm=<slug>[&invite=<code>]
  const q = new URLSearchParams(location.search);
  if (q.get("realm")) {
    const slug = q.get("realm").toLowerCase();
    if (q.get("invite")) setPendingInvite({ realm: slug, code: q.get("invite") });
    setRealm(slug);
    history.replaceState(null, "", location.pathname + location.hash);
  }
  try {
    if (!(await store.loadAccount())) { renderLogin(); return; }
    // Offene Einladung einlösen
    const inv = pendingInvite();
    if (inv) {
      setPendingInvite(null);
      if (!store.account.realms.some(r => r.slug === inv.realm)) {
        try { const r = await api.post(`/api/realms/${encodeURIComponent(inv.realm)}/join`, { inviteCode: inv.code }, { silent: true }); toast(`Willkommen in „${r.name}“!`, "success"); await store.loadAccount(); }
        catch (e) { setRealm(""); renderRealmPicker(`Einladung ungültig: ${e.message}`); return; }
      }
      setRealm(inv.realm);
    }
    if (!currentRealm() || !store.account.realms.some(r => r.slug === currentRealm())) { setRealm(""); renderRealmPicker(); return; }
    const st = await store.loadSession();
    if (st === "noLogin") { renderLogin(); return; }
    if (st === "notMember") { setRealm(""); renderRealmPicker(); return; }
    await store.bootstrap();
  } catch (e) {
    mount(root, offlineGate());
    return;
  }
  connect();
  await renderRoute();
  loadDiscord();
  if (store.isAdmin) await showChangelog(true);
  checkAttendance();
}

window.addEventListener("bb:unauthorized", () => {
  if (!store.me) return;
  store.me = null; store.account = null;
  renderLogin("Sitzung abgelaufen, bitte neu anmelden.");
});

window.addEventListener("bb:realm-missing", () => { setRealm(""); store.me = null; renderRealmPicker("Diesen Realm gibt es nicht (mehr)."); });
window.addEventListener("hashchange", renderRoute);
on("realm", () => renderRoute()); // Admin hat Name oder Art geändert
const refreshOnline = () => { const c = document.getElementById("online-chip"); if (c) c.replaceWith(onlineChip()); };
on("connection", refreshOnline);
on("presence", refreshOnline);
on("discord", () => loadDiscord());
on("events", () => checkAttendance()); // z. B. wenn der Admin das Startdatum ändert
on("members", () => { const chip = document.getElementById("me-chip"); if (chip) chip.replaceWith(meChip()); });
on("me", () => { const chip = document.getElementById("me-chip"); if (chip) chip.replaceWith(meChip()); });
on("events", () => { const chip = document.querySelector(".event-chip"); if (chip && store.event) chip.textContent = store.event.name; });

// ---------- Glücksrad: alle angemeldeten Browser bekommen Banner + Klang ----------
initAudio();
let lastWheelSpin = null;
on("wheel", async (s) => {
  if (!s || !s.spinId || s.spinId === lastWheelSpin) return;
  lastWheelSpin = s.spinId;
  const who = s.startedByName ? `${s.startedByName} dreht am Glücksrad …` : "Das Glücksrad dreht sich …";
  playSound("spin");
  const b = banner({ icon: "🎡", title: who, text: "Gleich steht das nächste Spiel fest.", href: "#/wheel", ms: Math.max(4000, s.durationMs) + 15000 });
  systemNotify("🎡 Glücksrad", who);
  let winner = null;
  try { winner = (await api.get("/api/games", { silent: true })).find(g => g.id === s.winnerGameId) || null; } catch { /* egal */ }
  const remaining = Math.max(0, s.startedAt + s.durationMs - Date.now());
  setTimeout(() => {
    const text = winner ? `Das Rad sagt: ${winner.name}!` : "Das Rad hat entschieden!";
    playSound("winner");
    b.update({ icon: "🏆", title: text, text: "Alle an die Rechner!", kind: "win", ms: 15000 });
    systemNotify("🏆 Nächstes Spiel", text);
  }, remaining);
});

// Globale Fehler sichtbar machen (hilft beim Debuggen auf dem Handy)
window.addEventListener("unhandledrejection", (e) => { if (e.reason && e.reason.status === undefined && e.reason.message) toast(e.reason.message, "error"); });

init();
