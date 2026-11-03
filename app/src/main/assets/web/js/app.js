// Einstieg: Login, Shell, Navigation und Routing zu den Ansichten.
import { h, mount, avatar, modal, toast, field, input, checkbox, confirmDialog, initials, dayLabel } from "./ui.js";
import { store, on, connect } from "./store.js";
import { api, authHeaders, currentRealm, setRealm } from "./api.js";
import { initAudio, playSound, banner, systemNotify, requestNotificationPermission, SOUNDS } from "./notify.js";
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

// ---------- Discord ----------
let discord = { invite: "", guildId: "" };
async function loadDiscord() {
  try { discord = await api.get("/api/discord", { silent: true }); } catch { /* egal */ }
  const c = document.getElementById("discord-chip"); if (c) c.replaceWith(discordChip());
}
function discordChip() {
  if (!discord.invite && !discord.guildId) return h("span", { id: "discord-chip", class: "hidden" });
  const w = discord.widget;
  const title = w ? `${w.inVoice} im Sprachchat · ${w.presenceCount} online` : "Discord-Server";
  return h("button", { id: "discord-chip", class: "btn sm discord-btn", title, onClick: discordDialog }, "💬 Discord", w && w.inVoice ? h("span", { class: "small" }, ` 🔊 ${w.inVoice}`) : null);
}
async function discordDialog() {
  await loadDiscord();
  const w = discord.widget;
  const joinUrl = discord.invite || w?.instantInvite || "";
  const member = (m) => h("div", { class: "discord-member" },
    m.avatar ? h("img", { src: m.avatar, alt: "" }) : h("span", { class: "avatar xs" }, initials(m.name)),
    h("span", { class: `st ${m.status}` }), h("span", { class: "grow" }, m.name),
    m.deafened ? h("span", { title: "taub geschaltet" }, "🔇") : m.muted ? h("span", { title: "stummgeschaltet", class: "small muted" }, "stumm") : null,
    m.game ? h("span", { class: "small muted" }, "🎮 " + m.game) : null);
  const onlineList = h("div", { class: "stack hidden", style: { marginTop: "6px" } }, (w?.online || []).map(member));
  modal({
    title: w?.name ? `Discord: ${w.name}` : "Discord",
    body: h("div", {},
      joinUrl ? h("a", { class: "btn discord-btn block", href: joinUrl, target: "_blank", rel: "noopener" }, "Server beitreten / öffnen") : h("p", { class: "muted small" }, "Kein Einladungslink hinterlegt."),
      discord.widgetError ? h("p", { class: "small", style: { color: "#ff9a9a", marginTop: "10px" } }, discord.widgetError) : null,
      w ? h("div", { style: { marginTop: "14px" } },
        h("h3", { style: { fontSize: "15px" } }, "🔊 Sprachkanäle"),
        w.voice.length
          ? w.voice.map(ch => h("div", { class: "card", style: { padding: "8px 10px", marginTop: "8px" } },
              h("div", { class: "row between" }, h("strong", { class: "small" }, ch.name), h("span", { class: "chip" }, ch.members.length)),
              h("div", { class: "stack", style: { marginTop: "6px" } }, ch.members.map(member))))
          : h("p", { class: "muted small", style: { marginTop: "6px" } }, "Gerade sitzt niemand im Sprachchat."),
        h("button", { class: "btn sm ghost", style: { marginTop: "12px" }, onClick: (e) => { onlineList.classList.toggle("hidden"); e.target.textContent = onlineList.classList.contains("hidden") ? `Weitere ${w.presenceCount - w.inVoice} online anzeigen` : "Ausblenden"; } },
          `Weitere ${w.presenceCount - w.inVoice} online anzeigen`),
        onlineList,
        h("p", { class: "small muted", style: { marginTop: "10px" } }, "Discord aktualisiert das Widget mit kurzer Verzögerung. Wer im Sprachchat ist, erscheint hier, wenn der Kanal für alle sichtbar ist.")) : null,
      store.isAdmin ? h("p", { class: "small muted", style: { marginTop: "12px" } }, "Einstellungen: Profil-Menü → Discord-Server.") : null),
    buttons: [{ label: "Aktualisieren", onClick: () => { setTimeout(discordDialog, 50); } }, { label: "Schließen" }],
  });
}
function discordSettingsDialog() {
  const invite = input({ value: discord.invite || "", placeholder: "https://discord.gg/abc123", autocapitalize: "off", spellcheck: false });
  const guild = input({ value: discord.guildId || "", placeholder: "z. B. 123456789012345678", inputmode: "numeric" });
  modal({
    title: "Discord-Server",
    body: h("div", {},
      field("Einladungslink", invite, "Discord: Rechtsklick auf den Server → Leute einladen → Link nie ablaufen lassen."),
      field("Server-ID (optional)", guild, "Für die Anzeige, wer online ist und wer in welchem Sprachkanal sitzt. Discord: Einstellungen → Erweitert → Entwicklermodus an, dann Rechtsklick auf den Server → Server-ID kopieren. Außerdem in den Servereinstellungen unter „Widget“ das Server-Widget aktivieren.")),
    buttons: [{ label: "Abbrechen" }, { label: "Speichern", class: "primary", onClick: async () => {
      discord = { ...discord, ...(await api.put("/api/discord", { invite: invite.value.trim(), guildId: guild.value.trim() })) };
      toast("Discord gespeichert", "success"); loadDiscord();
    } }],
  });
}

// ---------- Anwesenheit: während der LAN fragen, wer sich noch nicht eingetragen hat ----------
let attendancePromptOpen = false;
const snoozeKey = () => `bb.attSnooze.${store.event?.id}.${store.me?.id}`;
async function checkAttendance() {
  if (attendancePromptOpen || !store.me || !store.event) return;
  const day = store.currentDay();
  if (!day) return; // LAN läuft gerade nicht
  const d = new Date(); const today = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; // lokales Datum
  try { if (localStorage.getItem(snoozeKey()) === today) return; } catch { /* privat */ }
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
      h("p", { class: "small muted" }, "Die Anwesenheit bestimmt, wie Einkäufe aufgeteilt werden und wer bei Runden und Turnieren zur Auswahl steht. Jeder Tag bringt +30 XP."),
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

// ---------- Änderungsprotokoll für Admins ----------
async function showChangelog(onlyNew) {
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

// ---------- Android-App ----------
const APK_REPO = "MettyAmold/binary-brotherhood";
const APK_URL = `https://github.com/${APK_REPO}/releases/latest/download/BinaryBrotherhood.apk`;
const inAndroidApp = /\bwv\b|BinaryBrotherhood\//.test(navigator.userAgent);

/** Link zur neuesten Android-APK; die Versionsnummer kommt von GitHub nach, wenn erreichbar. */
function apkLink(cls = "btn block") {
  const label = h("span", {}, "📱 Android-App herunterladen");
  const a = h("a", { class: cls, href: APK_URL, rel: "noopener" }, label);
  fetch(`https://api.github.com/repos/${APK_REPO}/releases/latest`, { headers: { Accept: "application/vnd.github+json" } })
    .then(r => r.ok ? r.json() : null).then(rel => { if (rel && rel.tag_name) label.textContent = `📱 Android-App herunterladen (${rel.tag_name.replace(/^v/, "")})`; })
    .catch(() => {});
  return a;
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

const KIND_LABEL = { lan: "🖥️ LAN-Party", online: "🌐 Online-Spielesuche" };
const gateHero = () => h("div", { class: "hero" }, h("img", { src: "/logo.png", alt: "" }), h("div", { class: "title" }, "BINARY BROTHERHOOD"));
const errLine = (message) => message ? h("p", { class: "small", style: { color: "#ff9a9a" } }, message) : null;

// ---------- Einladungslink: /?realm=<slug>&invite=<code> – wird nach Login/Registrierung eingelöst ----------
function pendingInvite() { try { return JSON.parse(localStorage.getItem("bb.invite") || "null"); } catch { return null; } }
function setPendingInvite(v) { try { v ? localStorage.setItem("bb.invite", JSON.stringify(v)) : localStorage.removeItem("bb.invite"); } catch { /* privat */ } }

/** Schritt 1: mit Konto anmelden (gilt für alle Realms) oder Konto anlegen. */
export async function renderLogin(message) {
  const inv = pendingInvite();
  let invName = "";
  if (inv) try { invName = (await api.get("/api/realms", { silent: true })).find(r => r.slug === inv.realm)?.name || ""; } catch { /* egal */ }
  const name = input({ placeholder: "Dein Name", autocomplete: "username", autocapitalize: "off", spellcheck: false });
  const pw = passwordInput({ placeholder: "Passwort" });
  const submit = async () => {
    if (!name.value.trim() || !pw.value) { toast("Name und Passwort eingeben", "error"); return; }
    const r = await api.post("/api/account/login", { name: name.value.trim(), password: pw.value }, { noAuthRedirect: true });
    store.applyAccount(r);
    toast(`Willkommen zurück, ${r.user.name}!`, "success");
    init();
  };
  const enter = (e) => { if (e.key === "Enter") { e.preventDefault(); e.target === name ? pw.focus() : submit(); } };
  name.addEventListener("keydown", enter); pw.addEventListener("keydown", enter);
  mount(root, h("div", { class: "gate" }, h("div", { class: "card" },
    gateHero(),
    errLine(message),
    inv ? h("div", { class: "card", style: { padding: "10px 12px", marginBottom: "10px", borderColor: "var(--gold)" } },
      h("strong", {}, `✉️ Einladung in „${invName || inv.realm}“`),
      h("div", { class: "small muted" }, "Melde dich an oder lege ein Konto an – danach bist du direkt drin.")) : null,
    h("p", { class: "muted small" }, "Ein Konto für alle Realms. XP und Level sammelst du in jedem Realm getrennt."),
    field("Name", name), field("Passwort", pw), showPasswordToggle(pw),
    h("button", { class: "btn primary block", style: { marginTop: "8px" }, onClick: submit }, "Anmelden"),
    h("p", { class: "small muted", style: { marginTop: "6px" } }, "Noch kein Passwort (alter Account oder vom Super-Admin zurückgesetzt)? Einfach ein neues eingeben – es wird beim ersten Login festgelegt."),
    h("hr", { class: "sep" }),
    h("button", { class: "btn block", onClick: registerDialog }, "Konto anlegen"),
    inAndroidApp ? null : h("div", { style: { marginTop: "10px" } }, apkLink("btn ghost block"), h("div", { class: "small muted", style: { textAlign: "center", marginTop: "4px" } }, "Für Handy und Tablet, mit Update-Funktion. Beim Installieren „Unbekannte Quellen“ erlauben.")),
  )));
  setTimeout(() => name.focus(), 50);
}

function registerDialog() {
  const name = input({ placeholder: "Dein Name", maxlength: 40, autocomplete: "username" });
  const pw = passwordInput({ placeholder: "mind. 4 Zeichen", autocomplete: "new-password" });
  const pw2 = passwordInput({ placeholder: "Passwort wiederholen", autocomplete: "new-password" });
  modal({
    title: "Konto anlegen",
    body: h("div", {},
      h("p", { class: "muted small" }, "Mit dem Konto meldest du dich in allen Realms an. Um einem Realm beizutreten, brauchst du danach einen Einladungslink oder -code von dessen Admin."),
      field("Name", name), field("Passwort", pw), field("Wiederholen", pw2), showPasswordToggle(pw, pw2)),
    buttons: [{ label: "Abbrechen" }, { label: "Anlegen", class: "primary", onClick: async () => {
      if (!name.value.trim()) { toast("Name fehlt", "error"); return false; }
      if (pw.value.length < 4) { toast("Passwort muss mindestens 4 Zeichen haben", "error"); return false; }
      if (pw.value !== pw2.value) { toast("Die Passwörter stimmen nicht überein", "error"); return false; }
      const r = await api.post("/api/account/register", { name: name.value.trim(), password: pw.value }, { noAuthRedirect: true });
      store.applyAccount(r);
      toast(`Willkommen, ${r.user.name}!`, "success");
      init();
    } }],
  });
  chainEnter([name, pw, pw2]);
}

/** Schritt 2: Realm wählen, beitreten oder gründen. */
async function renderRealmPicker(message) {
  if (!store.account) { renderLogin(message); return; }
  try { await store.loadAccount(); } catch { mount(root, offlineGate()); return; }
  if (!store.account) { renderLogin(); return; }
  const { user, realms, otherRealms } = store.account;
  const enterRealm = (slug) => { setRealm(slug); init(); };
  const row = (r, onClick, extra) => h("div", { class: "it", onClick },
    h("div", { class: "grow" }, h("div", {}, r.name), h("div", { class: "small muted" }, KIND_LABEL[r.kind] || r.kind)), extra || h("span", { class: "muted" }, "›"));
  mount(root, h("div", { class: "gate" }, h("div", { class: "card" },
    gateHero(),
    errLine(message),
    h("div", { class: "row between", style: { marginBottom: "8px" } },
      h("div", { class: "row" }, avatar({ id: user.id, name: user.name, color: user.color, hasAvatar: user.hasAvatar, avatarUrl: `/api/account/avatar/${user.id}` }, "sm"),
        h("div", {}, h("strong", {}, user.name), user.isSuperAdmin ? h("div", { class: "small", style: { color: "var(--gold)" } }, "Super-Admin") : null)),
      h("button", { class: "btn sm ghost", onClick: async () => { await store.logout(); renderLogin(); } }, "Abmelden")),
    h("div", { class: "small muted", style: { margin: "6px 0" } }, "Deine Realms"),
    h("div", { class: "pick-list" }, realms.length ? realms.map(r => row(r, () => enterRealm(r.slug)))
      : h("div", { class: "muted small" }, "Du bist noch in keinem Realm. Tritt einem bei (Einladungscode) oder gründe einen.")),
    otherRealms.length ? h("div", { class: "small muted", style: { margin: "14px 0 6px" } }, user.isSuperAdmin ? "Weitere Realms (als Super-Admin ohne Code)" : "Weitere Realms") : null,
    otherRealms.length ? h("div", { class: "pick-list" }, otherRealms.map(r => row(r, () => joinDialog(r), h("span", { class: "chip" }, "Beitreten")))) : null,
    h("hr", { class: "sep" }),
    h("button", { class: "btn block", onClick: createRealmDialog }, "Neuen Realm gründen"),
    user.isSuperAdmin ? h("button", { class: "btn ghost block", style: { marginTop: "8px" }, onClick: superAdminDialog }, "🛡️ Verwaltung: alle Konten und Realms") : null,
    h("button", { class: "btn ghost block", style: { marginTop: "8px" }, onClick: changePasswordDialog }, "🔑 Passwort ändern"),
  )));
}

/** Beitreten: Super-Admins direkt, sonst mit Einladungscode. */
async function joinDialog(r) {
  const doJoin = async (code) => {
    await api.post(`/api/realms/${encodeURIComponent(r.slug)}/join`, { inviteCode: code });
    toast(`Willkommen in „${r.name}“!`, "success");
    setRealm(r.slug); init();
  };
  if (store.isSuperAdmin) { await doJoin(""); return; }
  const code = input({ placeholder: "z. B. K7P2QX9A", autocapitalize: "characters", autocomplete: "off", spellcheck: false });
  modal({
    title: `„${r.name}“ beitreten`,
    body: h("div", {}, h("p", { class: "muted small" }, "Den Einladungscode bekommst du von einem Admin des Realms (Profil-Menü → Einladungscode)."), field("Einladungscode", code)),
    buttons: [{ label: "Abbrechen" }, { label: "Beitreten", class: "primary", onClick: async () => {
      if (!code.value.trim()) { toast("Code fehlt", "error"); return false; }
      await doJoin(code.value.trim());
    } }],
  });
  chainEnter([code]);
  setTimeout(() => code.focus(), 50);
}

function kindPicker(current = "lan") {
  const radios = {};
  const opt = (kind, title, hint) => {
    radios[kind] = h("input", { type: "radio", name: "realmkind", checked: current === kind });
    return h("label", { class: "it" }, radios[kind], h("div", { class: "grow" }, h("div", {}, title), h("div", { class: "small muted" }, hint)));
  };
  const el = h("div", { class: "pick-list" },
    opt("lan", "🖥️ LAN-Party", "Mit LAN-Ausgaben, Anwesenheitstagen, Kosten teilen, Ausrüstung und Spiele-Freigaben."),
    opt("online", "🌐 Online-Spielesuche", "Nur Spiele, Glücksrad, Turniere, Vorschläge, Forum und Discord – ohne LAN-Organisation."));
  return { el, value: () => (radios.online.checked ? "online" : "lan") };
}

function createRealmDialog() {
  const name = input({ placeholder: "z. B. Freitagsrunde", maxlength: 60 });
  const kind = kindPicker("lan");
  modal({
    title: "Neuen Realm gründen",
    body: h("div", {},
      h("p", { class: "muted small" }, "Ein Realm ist komplett unabhängig von den anderen. Du wirst sein Admin und lädst die anderen per Einladungslink ein."),
      field("Name", name), h("div", { class: "field" }, h("label", {}, "Art"), kind.el)),
    buttons: [{ label: "Abbrechen" }, { label: "Gründen", class: "primary", onClick: async () => {
      if (name.value.trim().length < 3) { toast("Der Name braucht mindestens 3 Zeichen", "error"); return false; }
      const r = await api.post("/api/realms", { name: name.value.trim(), kind: kind.value() });
      toast(`Realm „${r.name}“ gegründet – du bist Admin`, "success", 5000);
      setRealm(r.slug); init();
    } }],
  });
  chainEnter([name]);
  setTimeout(() => name.focus(), 50);
}

/** Admin: Realm umbenennen oder zwischen LAN-Party und Online umschalten. */
function realmSettingsDialog() {
  const name = input({ value: store.realm?.name || "", maxlength: 60 });
  const kind = kindPicker(store.realm?.kind || "lan");
  modal({
    title: "Realm-Einstellungen",
    body: h("div", {},
      field("Name", name), h("div", { class: "field" }, h("label", {}, "Art"), kind.el),
      h("p", { class: "small muted" }, "Beim Umschalten auf „Online“ werden LAN-Daten nur ausgeblendet, nicht gelöscht. Neue Leute lädst du über Profil-Menü → Einladungslink ein.")),
    buttons: [{ label: "Abbrechen" }, { label: "Speichern", class: "primary", onClick: async () => {
      store.realm = await api.put("/api/realm", { name: name.value.trim(), kind: kind.value() });
      store.appName = store.realm.name;
      toast("Realm gespeichert", "success");
      renderRoute();
    } }],
  });
}

/** Super-Admin: alle Konten (Passwort zurücksetzen, Super-Admin, löschen) und Realms (löschen). */
async function superAdminDialog() {
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
            h("button", { class: "btn sm", onClick: async () => { if (await confirmDialog("Passwort zurücksetzen?", `${u.name} wird überall abgemeldet und legt beim nächsten Login ein neues Passwort fest.`, { okLabel: "Zurücksetzen", danger: false })) { await api.post(`/api/super/users/${u.id}/reset`); toast("Passwort zurückgesetzt", "success"); load(); } } }, "🔑 Zurücksetzen"),
            h("button", { class: "btn sm", onClick: async () => { await api.post(`/api/super/users/${u.id}/super`, { on: !u.isSuperAdmin }); toast(u.isSuperAdmin ? "Super-Admin entzogen" : "Ist jetzt Super-Admin", "success"); if (u.id === me && u.isSuperAdmin) location.reload(); else load(); } }, u.isSuperAdmin ? "Super-Admin entziehen" : "Zum Super-Admin"),
            u.id !== me ? h("button", { class: "btn sm ghost danger", onClick: async () => { if (await confirmDialog("Konto löschen?", `${u.name} wird aus allen Realms entfernt (XP inklusive). Beiträge bleiben.`, { okLabel: "Löschen" })) { await api.del(`/api/super/users/${u.id}`); toast("Konto gelöscht", "success"); load(); } } }, "Löschen") : null))))),
      h("h3", { style: { fontSize: "15px", marginTop: "16px" } }, `Realms (${d.realms.length})`),
      h("div", { class: "pick-list" }, d.realms.map(r => h("div", { class: "it" },
        h("div", { class: "grow" }, h("div", {}, r.name), h("div", { class: "small muted" }, `${KIND_LABEL[r.kind] || r.kind} · ${r.members} Mitglied${r.members === 1 ? "" : "er"}`)),
        r.legacy ? h("span", { class: "chip" }, "erster Realm") : h("button", { class: "btn sm ghost danger", onClick: async () => {
          if (await confirmDialog(`„${r.name}“ löschen?`, "Alle Daten dieses Realms (Spiele, Forum, XP, Turniere …) werden endgültig gelöscht. Die Konten bleiben.", { okLabel: "Endgültig löschen" })) {
            await api.del(`/api/super/realms/${encodeURIComponent(r.slug)}`); toast("Realm gelöscht", "success");
            if (r.slug === currentRealm()) { setRealm(""); location.href = location.pathname; } else load();
          }
        } }, "Löschen")))));
  };
  modal({ title: "Verwaltung", wide: true, body, buttons: [{ label: "Schließen" }] });
  load();
}

/** Realm wechseln: zurück zur Realm-Auswahl, das Konto bleibt angemeldet. */
function switchRealm() {
  setRealm("");
  location.href = location.pathname; // frisch laden: Live-Verbindung und Daten gehören zum Realm
}

function offlineGate() {
  return h("div", { class: "gate" }, h("div", { class: "card" },
    gateHero(),
    h("p", { class: "muted" }, "Der Server antwortet nicht. Bist du online?"),
    h("button", { class: "btn primary block", onClick: () => location.reload() }, "Erneut versuchen")));
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
      (store.isAdmin || store.isHost) ? h("div", { class: "it", onClick: () => { ctx.close(); soundsDialog(); } }, h("span", {}, "🔊"), h("span", { class: "grow" }, "Glücksrad-Sounds")) : null,
      store.isAdmin ? h("div", { class: "it", onClick: () => { ctx.close(); realmSettingsDialog(); } }, h("span", {}, "⚙️"), h("span", { class: "grow" }, "Realm-Einstellungen")) : null,
      (store.isAdmin || store.isHost) ? h("div", { class: "it", onClick: () => { ctx.close(); resetDialog(); } }, h("span", {}, "🧹"), h("span", { class: "grow" }, store.lan ? "LAN zurücksetzen" : "Daten zurücksetzen")) : null,
      store.isAdmin && store.mode === "cloud" ? h("div", { class: "it", onClick: () => { ctx.close(); discordSettingsDialog(); } }, h("span", {}, "💬"), h("span", { class: "grow" }, "Discord-Server")) : null,
      store.isAdmin && store.mode === "cloud" ? h("div", { class: "it", onClick: () => { ctx.close(); showChangelog(false); } }, h("span", {}, "📜"), h("span", { class: "grow" }, "Änderungsprotokoll")) : null,
      ("Notification" in window) ? h("div", { class: "it", onClick: async () => { ctx.close(); const r = await requestNotificationPermission(); toast(r === "granted" ? "Benachrichtigungen aktiv – auch wenn der Tab im Hintergrund ist" : "Benachrichtigungen nicht erlaubt", r === "granted" ? "success" : "error"); } }, h("span", {}, "🔔"), h("span", { class: "grow" }, "Benachrichtigungen erlauben")) : null,
      store.isAdmin && store.mode === "cloud" ? h("div", { class: "it", onClick: () => { ctx.close(); inviteDialog(); } }, h("span", {}, "✉️"), h("span", { class: "grow" }, "Einladungslink")) : null,
      store.isAdmin && store.mode === "cloud" ? h("div", { class: "it", onClick: () => { ctx.close(); importDialog(); } }, h("span", {}, "📦"), h("span", { class: "grow" }, "Daten vom Handy importieren")) : null,
      inAndroidApp ? null : h("a", { class: "it", href: APK_URL, rel: "noopener", style: { textDecoration: "none", color: "inherit" } }, h("span", {}, "📱"), h("span", { class: "grow" }, "Android-App herunterladen")),
      store.isSuperAdmin ? h("div", { class: "it", onClick: () => { ctx.close(); superAdminDialog(); } }, h("span", {}, "🛡️"), h("span", { class: "grow" }, "Verwaltung (alle Realms)")) : null,
      h("div", { class: "it", onClick: () => { ctx.close(); switchRealm(); } }, h("span", {}, "🌐"), h("span", { class: "grow" }, "Realm wechseln"), h("span", { class: "small muted" }, store.realm?.name || "")),
      h("div", { class: "it", onClick: async () => { ctx.close(); await store.logout(); setRealm(""); location.href = location.pathname; } }, h("span", {}, "🚪"), h("span", { class: "grow" }, "Abmelden")),
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
      h("p", { class: "muted small" }, "Gilt für alle Realms. Andere Geräte werden abgemeldet.")),
    buttons: [{ label: "Abbrechen" }, { label: "Speichern", class: "primary", onClick: async () => {
      if (pw.value.length < 4) { toast("Passwort muss mindestens 4 Zeichen haben", "error"); return false; }
      if (pw.value !== pw2.value) { toast("Die Passwörter stimmen nicht überein", "error"); return false; }
      const r = await api.post("/api/account/password", { oldPassword: old.value, newPassword: pw.value }, { noAuthRedirect: true });
      store.applyAccount(r);
      toast("Passwort geändert", "success");
    } }],
  });
  chainEnter([old, pw, pw2]);
}

/** Admin/Host: aktuelle LAN-Party zurücksetzen – Spiele und Mitglieder bleiben, Auswahl was weg soll. */
function resetDialog() {
  const opts = [
    ["sessions", true, "Gespielte Runden", "Historie und laufende Runden dieser LAN, Sterne „nächste Runde“, Abstimmungen, letzter Dreh am Rad"],
    ["costs", true, "Kosten und Anwesenheit", "Einkäufe, Ausgleichszahlungen und Anwesenheitstage dieser LAN"],
    ["equipment", true, "Ausrüstung: Zusagen", "Wer bringt was und Erledigt-Haken; die Liste selbst bleibt"],
    ["xp", false, "XP und Level aller Mitglieder", "Komplettes XP-Protokoll löschen, alle fangen bei Level 1 an"],
    ["posts", false, "Vorschläge und Forum", "Alle Vorschläge, Beiträge und Kommentare löschen"],
  ];
  const shown = store.lan ? opts : opts.filter(([key]) => key !== "costs" && key !== "equipment");
  const boxes = shown.map(([key, def, label, hint]) => ({ key, box: h("input", { type: "checkbox", checked: def }), label, hint }));
  modal({
    title: store.lan ? "LAN zurücksetzen" : "Daten zurücksetzen",
    body: h("div", {},
      h("p", { class: "small" }, "Spiele und Mitglieder bleiben immer erhalten.", store.lan ? ` Betrifft die aktuelle Ausgabe „${store.event?.name ?? ""}“.` : ""),
      h("div", { class: "pick-list" }, boxes.map(b => h("label", { class: "it" }, b.box, h("div", { class: "grow" }, h("div", {}, b.label), h("div", { class: "small muted" }, b.hint))))),
      h("p", { class: "small", style: { color: "#ff9a9a", marginTop: "10px" } }, "Das lässt sich nicht rückgängig machen.")),
    buttons: [{ label: "Abbrechen" }, { label: "Zurücksetzen", class: "danger", onClick: async () => {
      const body = Object.fromEntries(boxes.map(b => [b.key, b.box.checked]));
      if (!Object.values(body).some(Boolean)) { toast("Nichts ausgewählt", "error"); return false; }
      if (!(await confirmDialog("Wirklich zurücksetzen?", "Die gewählten Daten der aktuellen LAN werden gelöscht.", { okLabel: "Ja, zurücksetzen" }))) return false;
      const r = await api.post("/api/admin/reset", body);
      toast(`Zurückgesetzt: ${r.deleted} Datensätze entfernt`, "success", 5000);
      renderRoute();
    } }],
  });
}

/** Admin/Host: eigene Klänge fürs Glücksrad hochladen, probehören, zurücksetzen. */
async function soundsDialog() {
  const KINDS = [["spin", "Beim Drehen", "Standard: Glocken-Bimmeln"], ["winner", "Beim Gewinner", "Standard: kurze Fanfare"]];
  const list = h("div", { class: "stack" });
  const load = async () => {
    const sounds = await api.get("/api/sounds");
    store.refreshSounds();
    mount(list, KINDS.map(([kind, label, fallback]) => {
      const cur = sounds[kind];
      const file = h("input", { type: "file", accept: "audio/*", class: "hidden", onChange: async () => {
        const f = file.files[0]; if (!f) return;
        if (!f.type.startsWith("audio/")) { toast("Bitte eine Audiodatei wählen (MP3, OGG, WAV, M4A)", "error"); return; }
        if (f.size > 1_500_000) { toast("Datei ist zu groß (max. 1,5 MB) – kurzen Clip nehmen", "error"); return; }
        toast("Lade hoch …");
        const res = await fetch(`/api/sounds/${kind}`, { method: "POST", headers: { ...authHeaders(), "Content-Type": f.type, "X-File-Name": encodeURIComponent(f.name) }, body: f });
        if (!res.ok) { let msg = "Upload fehlgeschlagen"; try { msg = (await res.json()).error || msg; } catch { /* kein JSON */ } toast(msg, "error"); return; }
        toast("Klang gespeichert – gilt sofort für alle", "success"); load();
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
    body: h("div", {}, h("p", { class: "muted small" }, "Kurze Clips (MP3, OGG, WAV, M4A, max. 1,5 MB). Sie werden auf dem Server gespeichert und bei jedem Dreh in allen angemeldeten Browsern abgespielt."), list),
    buttons: [{ label: "Schließen" }],
  });
  load();
}

/** Admin: Einladungscode anzeigen, kopieren, neu erzeugen. */
async function inviteDialog() {
  const codeEl = h("code", { style: { fontSize: "26px", letterSpacing: ".2em", color: "var(--gold)" } }, "…");
  const linkEl = h("code", { class: "small", style: { wordBreak: "break-all" } }, "…");
  const inviteLink = (code) => `${location.origin}/?realm=${encodeURIComponent(currentRealm())}&invite=${encodeURIComponent(code)}`;
  const show = (code) => { codeEl.textContent = code; linkEl.textContent = inviteLink(code); };
  const load = async () => show((await api.get("/api/admin/invite")).code);
  modal({
    title: "Einladungslink",
    body: h("div", { style: { textAlign: "center" } },
      h("p", { class: "muted small" }, "Schick den Einladungslink per Chat: Wer ihn öffnet, meldet sich an (oder legt ein Konto an) und ist direkt im Realm. Wer schon ein Konto hat, kann auch nur den Code unter „Realm wechseln → Beitreten“ eingeben."),
      h("div", { class: "card", style: { padding: "8px 10px" } }, linkEl),
      h("button", { class: "btn primary", style: { marginTop: "8px" }, onClick: async () => { const { copyText } = await import("./ui.js"); toast((await copyText(linkEl.textContent)) ? "Link kopiert" : "Kopieren nicht möglich", "success"); } }, "Link kopieren"),
      h("div", { style: { margin: "14px 0" } }, codeEl),
      h("div", { class: "row wrap", style: { justifyContent: "center" } },
        h("button", { class: "btn", onClick: async () => { const { copyText } = await import("./ui.js"); toast((await copyText(codeEl.textContent)) ? "Code kopiert" : "Kopieren nicht möglich", "success"); } }, "Code kopieren"),
        h("button", { class: "btn ghost", onClick: async () => { show((await api.post("/api/admin/invite")).code); toast("Neuer Code erzeugt – alter Code und Link gelten nicht mehr"); } }, "Neu erzeugen"))),
    buttons: [{ label: "Schließen" }],
  });
  load();
}

/** Admin: Export-Datei der Android-App einspielen (ersetzt alle Daten). */
function importDialog() {
  const file = h("input", { type: "file", accept: "application/json,.json", class: "input" });
  const merge = h("input", { type: "radio", name: "impmode", checked: true });
  const replace = h("input", { type: "radio", name: "impmode" });
  modal({
    title: "Daten vom Handy importieren",
    body: h("div", {},
      h("p", { class: "small" }, "Am einfachsten direkt aus der Android-App: Menü ⋮ oben rechts → „Handy-Daten in die Cloud übertragen“ (als Admin angemeldet). Alternativ hier eine Export-Datei wählen."),
      field("Export-Datei", file),
      h("div", { class: "pick-list" },
        h("label", { class: "it" }, merge, h("div", { class: "grow" }, h("div", {}, "Zusammenführen (empfohlen)"), h("div", { class: "small muted" }, "Mitglieder, Spiele und LAN-Ausgaben werden über den Namen abgeglichen, der Rest angehängt. Nichts wird gelöscht."))),
        h("label", { class: "it" }, replace, h("div", { class: "grow" }, h("div", {}, "Alles ersetzen"), h("div", { class: "small muted", style: { color: "#ff9a9a" } }, "Löscht den gesamten Cloud-Bestand und übernimmt den Export; alle Geräte müssen sich neu anmelden."))))),
    buttons: [{ label: "Abbrechen" }, { label: "Importieren", class: "primary", onClick: async () => {
      const f = file.files[0]; if (!f) { toast("Datei fehlt", "error"); return false; }
      let data; try { data = JSON.parse(await f.text()); } catch { toast("Keine gültige JSON-Datei", "error"); return false; }
      if (replace.checked) {
        if (!(await confirmDialog("Wirklich alles ersetzen?", "Der komplette Cloud-Bestand wird gelöscht.", { okLabel: "Ja, ersetzen" }))) return false;
        const r = await api.post("/api/admin/import", data);
        toast(`${r.rows} Datensätze importiert – bitte neu anmelden`, "success", 6000);
        setTimeout(() => { store.logout().then(() => location.reload()); }, 1500);
      } else {
        const r = await api.post("/api/admin/merge", data);
        const parts = Object.entries(r.added || {}).map(([k, v]) => `${k}: ${v}`).join(", ");
        toast(`Zusammengeführt. Neu: ${parts || "nichts, alles war schon da"}`, "success", 7000);
        await store.bootstrap(); renderRoute();
      }
    } }],
  });
}

/** Für schreibende Aktionen: liefert das angemeldete Mitglied (ohne Login gibt es die App nicht). */
export async function requireMe() {
  if (store.me) return store.me;
  renderLogin();
  return null;
}

async function init() {
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
    await store.loadMode();
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
  if (store.isAdmin && store.mode === "cloud") await showChangelog(true);
  checkAttendance();
}

window.addEventListener("bb:unauthorized", () => {
  if (!store.me) return;
  store.me = null; store.isHost = false; store.account = null;
  renderLogin("Deine Sitzung ist abgelaufen, bitte melde dich neu an.");
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
