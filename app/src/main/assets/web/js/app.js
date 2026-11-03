// Einstieg: Login, Shell, Navigation und Routing zu den Ansichten.
import { h, mount, avatar, modal, toast, field, input, checkbox, confirmDialog, initials } from "./ui.js";
import { store, on, connect } from "./store.js";
import { api, authHeaders } from "./api.js";
import { initAudio, playSound, banner, systemNotify, requestNotificationPermission, SOUNDS } from "./notify.js";
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
    discordChip(),
    onlineChip(),
    meChip(),
  );
  const nav = h("nav", { class: "nav" }, routes.map(r =>
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
    inAndroidApp ? null : h("div", { style: { marginTop: "10px" } }, apkLink("btn ghost block"), h("div", { class: "small muted", style: { textAlign: "center", marginTop: "4px" } }, "Für Handy und Tablet, mit Update-Funktion. Beim Installieren „Unbekannte Quellen“ erlauben.")),
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
  const invite = input({ placeholder: "z. B. K7P2QX9A", autocapitalize: "characters", autocomplete: "off", spellcheck: false });
  const cloud = store.mode === "cloud";
  modal({
    title: "Neues Profil",
    body: h("div", {},
      h("p", { class: "muted small" }, "Das Passwort schützt dein Profil, damit niemand in deinem Namen abstimmt oder schreibt."),
      field("Name", name), field("Passwort", pw), field("Wiederholen", pw2), showPasswordToggle(pw, pw2),
      cloud ? field("Einladungscode", invite, "Bekommst du von einem Admin der Bruderschaft. Das allererste Profil braucht keinen.") : null),
    buttons: [{ label: "Abbrechen" }, { label: "Anlegen", class: "primary", onClick: async () => {
      if (!name.value.trim()) { toast("Name fehlt", "error"); return false; }
      if (pw.value.length < 4) { toast("Passwort muss mindestens 4 Zeichen haben", "error"); return false; }
      if (pw.value !== pw2.value) { toast("Die Passwörter stimmen nicht überein", "error"); return false; }
      const r = await api.post("/api/auth/register", { name: name.value.trim(), password: pw.value, inviteCode: invite.value.trim() });
      store.applyAuth(r);
      toast(`Willkommen in der Bruderschaft, ${r.member.name}!`, "success");
      init();
    } }],
  });
  chainEnter(cloud ? [name, pw, pw2, invite] : [name, pw, pw2]);
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
      (store.isAdmin || store.isHost) ? h("div", { class: "it", onClick: () => { ctx.close(); resetDialog(); } }, h("span", {}, "🧹"), h("span", { class: "grow" }, "LAN zurücksetzen")) : null,
      store.isAdmin && store.mode === "cloud" ? h("div", { class: "it", onClick: () => { ctx.close(); discordSettingsDialog(); } }, h("span", {}, "💬"), h("span", { class: "grow" }, "Discord-Server")) : null,
      store.isAdmin && store.mode === "cloud" ? h("div", { class: "it", onClick: () => { ctx.close(); showChangelog(false); } }, h("span", {}, "📜"), h("span", { class: "grow" }, "Änderungsprotokoll")) : null,
      ("Notification" in window) ? h("div", { class: "it", onClick: async () => { ctx.close(); const r = await requestNotificationPermission(); toast(r === "granted" ? "Benachrichtigungen aktiv – auch wenn der Tab im Hintergrund ist" : "Benachrichtigungen nicht erlaubt", r === "granted" ? "success" : "error"); } }, h("span", {}, "🔔"), h("span", { class: "grow" }, "Benachrichtigungen erlauben")) : null,
      store.isAdmin && store.mode === "cloud" ? h("div", { class: "it", onClick: () => { ctx.close(); inviteDialog(); } }, h("span", {}, "✉️"), h("span", { class: "grow" }, "Einladungscode")) : null,
      store.isAdmin && store.mode === "cloud" ? h("div", { class: "it", onClick: () => { ctx.close(); importDialog(); } }, h("span", {}, "📦"), h("span", { class: "grow" }, "Daten vom Handy importieren")) : null,
      inAndroidApp ? null : h("a", { class: "it", href: APK_URL, rel: "noopener", style: { textDecoration: "none", color: "inherit" } }, h("span", {}, "📱"), h("span", { class: "grow" }, "Android-App herunterladen")),
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

/** Admin/Host: aktuelle LAN-Party zurücksetzen – Spiele und Mitglieder bleiben, Auswahl was weg soll. */
function resetDialog() {
  const opts = [
    ["sessions", true, "Gespielte Runden", "Historie und laufende Runden dieser LAN, Sterne „nächste Runde“, Abstimmungen, letzter Dreh am Rad"],
    ["costs", true, "Kosten und Anwesenheit", "Einkäufe, Ausgleichszahlungen und Anwesenheitstage dieser LAN"],
    ["equipment", true, "Ausrüstung: Zusagen", "Wer bringt was und Erledigt-Haken; die Liste selbst bleibt"],
    ["xp", false, "XP und Level aller Mitglieder", "Komplettes XP-Protokoll löschen, alle fangen bei Level 1 an"],
    ["posts", false, "Vorschläge und Forum", "Alle Vorschläge, Beiträge und Kommentare löschen"],
  ];
  const boxes = opts.map(([key, def, label, hint]) => ({ key, box: h("input", { type: "checkbox", checked: def }), label, hint }));
  modal({
    title: "LAN zurücksetzen",
    body: h("div", {},
      h("p", { class: "small" }, "Spiele und Mitglieder bleiben immer erhalten. Betrifft die aktuelle Ausgabe „", store.event?.name ?? "", "“."),
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
  const load = async () => { codeEl.textContent = (await api.get("/api/admin/invite")).code; };
  modal({
    title: "Einladungscode",
    body: h("div", { style: { textAlign: "center" } },
      h("p", { class: "muted small" }, "Wer ein Profil anlegen will, braucht diesen Code. Schick ihn den Kumpels per Chat."),
      h("div", { style: { margin: "14px 0" } }, codeEl),
      h("div", { class: "row wrap", style: { justifyContent: "center" } },
        h("button", { class: "btn", onClick: async () => { const { copyText } = await import("./ui.js"); toast((await copyText(codeEl.textContent)) ? "Code kopiert" : "Kopieren nicht möglich", "success"); } }, "Kopieren"),
        h("button", { class: "btn ghost", onClick: async () => { codeEl.textContent = (await api.post("/api/admin/invite")).code; toast("Neuer Code erzeugt – der alte gilt nicht mehr"); } }, "Neu erzeugen"))),
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
  let loggedIn;
  try {
    await store.loadMode();
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
  loadDiscord();
  if (store.isAdmin && store.mode === "cloud") showChangelog(true);
}

window.addEventListener("bb:unauthorized", () => {
  if (!store.me) return;
  store.me = null; store.isHost = false;
  renderLogin("Deine Sitzung ist abgelaufen, bitte melde dich neu an.");
});

window.addEventListener("hashchange", renderRoute);
const refreshOnline = () => { const c = document.getElementById("online-chip"); if (c) c.replaceWith(onlineChip()); };
on("connection", refreshOnline);
on("presence", refreshOnline);
on("discord", () => loadDiscord());
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
