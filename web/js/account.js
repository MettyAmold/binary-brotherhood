// Konto und Realm-Auswahl: Login, Registrierung, Einladungslink, Beitreten, Gründen, Passwort.
import { h, mount, avatar, modal, toast, field, input, checkbox } from "./ui.js";
import { store } from "./store.js";
import { api, setRealm } from "./api.js";
import { init } from "./app.js";
import { superAdminDialog } from "./admin.js";

const root = document.getElementById("app");

// ---------- Android-App ----------
const APK_REPO = "MettyAmold/binary-brotherhood";
export const APK_URL = `https://github.com/${APK_REPO}/releases/latest/download/BinaryBrotherhood.apk`;
export const inAndroidApp = /\bwv\b|BinaryBrotherhood\//.test(navigator.userAgent);

/** Link zur neuesten Android-APK; die Versionsnummer kommt von GitHub nach, wenn erreichbar. */
export function apkLink(cls = "btn block") {
  const label = h("span", {}, "📱 Android-App herunterladen");
  const a = h("a", { class: cls, href: APK_URL, rel: "noopener" }, label);
  fetch(`https://api.github.com/repos/${APK_REPO}/releases/latest`, { headers: { Accept: "application/vnd.github+json" } })
    .then(r => r.ok ? r.json() : null).then(rel => { if (rel && rel.tag_name) label.textContent = `📱 Android-App herunterladen (${rel.tag_name.replace(/^v/, "")})`; })
    .catch(() => {});
  return a;
}


export const passwordInput = (attrs = {}) => input({ type: "password", autocomplete: "current-password", ...attrs });

/** Enter springt zum nächsten Feld, im letzten Feld wird der Primär-Knopf des Dialogs ausgelöst. */
export function chainEnter(inputs) {
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

export const KIND_LABEL = { lan: "🖥️ LAN-Party", online: "🌐 Online-Spielesuche" };
const gateHero = () => h("div", { class: "hero" }, h("img", { src: "/logo.png", alt: "" }), h("div", { class: "title" }, "BINARY BROTHERHOOD"));
const errLine = (message) => message ? h("p", { class: "small", style: { color: "#ff9a9a" } }, message) : null;

// ---------- Einladungslink: /?realm=<slug>&invite=<code> – wird nach Login/Registrierung eingelöst ----------
export function pendingInvite() { try { return JSON.parse(localStorage.getItem("bb.invite") || "null"); } catch { return null; } }
export function setPendingInvite(v) { try { v ? localStorage.setItem("bb.invite", JSON.stringify(v)) : localStorage.removeItem("bb.invite"); } catch { /* privat */ } }

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
      h("div", { class: "small muted" }, "Nach dem Login bist du direkt drin.")) : null,
    field("Name", name), field("Passwort", pw), showPasswordToggle(pw),
    h("button", { class: "btn primary block", style: { marginTop: "8px" }, onClick: submit }, "Anmelden"),
    h("p", { class: "small muted", style: { marginTop: "6px" } }, "Passwort zurückgesetzt? Einfach ein neues eingeben."),
    h("hr", { class: "sep" }),
    h("button", { class: "btn block", onClick: registerDialog }, "Konto anlegen"),
    inAndroidApp ? null : h("div", { style: { marginTop: "10px" } }, apkLink("btn ghost block"), h("div", { class: "small muted", style: { textAlign: "center", marginTop: "4px" } }, "Beim Installieren „Unbekannte Quellen“ erlauben.")),
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
export async function renderRealmPicker(message) {
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
      : h("div", { class: "muted small" }, "Noch in keinem Realm.")),
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
    body: h("div", {}, h("p", { class: "muted small" }, "Den Code gibt dir ein Admin des Realms."), field("Einladungscode", code)),
    buttons: [{ label: "Abbrechen" }, { label: "Beitreten", class: "primary", onClick: async () => {
      if (!code.value.trim()) { toast("Code fehlt", "error"); return false; }
      await doJoin(code.value.trim());
    } }],
  });
  chainEnter([code]);
  setTimeout(() => code.focus(), 50);
}

export function kindPicker(current = "lan") {
  const radios = {};
  const opt = (kind, title, hint) => {
    radios[kind] = h("input", { type: "radio", name: "realmkind", checked: current === kind });
    return h("label", { class: "it" }, radios[kind], h("div", { class: "grow" }, h("div", {}, title), h("div", { class: "small muted" }, hint)));
  };
  const el = h("div", { class: "pick-list" },
    opt("lan", "🖥️ LAN-Party", "Mit Anwesenheit, Kosten, Ausrüstung und Freigaben"),
    opt("online", "🌐 Online-Spielesuche", "Ohne LAN-Organisation"));
  return { el, value: () => (radios.online.checked ? "online" : "lan") };
}

function createRealmDialog() {
  const name = input({ placeholder: "z. B. Freitagsrunde", maxlength: 60 });
  const kind = kindPicker("lan");
  modal({
    title: "Neuen Realm gründen",
    body: h("div", {},
      field("Name", name), h("div", { class: "field" }, h("label", {}, "Art"), kind.el)),
    buttons: [{ label: "Abbrechen" }, { label: "Gründen", class: "primary", onClick: async () => {
      if (name.value.trim().length < 3) { toast("Der Name braucht mindestens 3 Zeichen", "error"); return false; }
      const r = await api.post("/api/realms", { name: name.value.trim(), kind: kind.value() });
      toast(`Realm „${r.name}“ gegründet`, "success", 5000);
      setRealm(r.slug); init();
    } }],
  });
  chainEnter([name]);
  setTimeout(() => name.focus(), 50);
}

/** Realm wechseln: zurück zur Realm-Auswahl, das Konto bleibt angemeldet. */
export function switchRealm() {
  setRealm("");
  location.href = location.pathname; // frisch laden: Live-Verbindung und Daten gehören zum Realm
}

export function offlineGate() {
  return h("div", { class: "gate" }, h("div", { class: "card" },
    gateHero(),
    h("p", { class: "muted" }, "Der Server antwortet nicht. Bist du online?"),
    h("button", { class: "btn primary block", onClick: () => location.reload() }, "Erneut versuchen")));
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
      const r = await api.post("/api/account/password", { oldPassword: old.value, newPassword: pw.value }, { noAuthRedirect: true });
      store.applyAccount(r);
      toast("Passwort geändert", "success");
    } }],
  });
  chainEnter([old, pw, pw2]);
}

