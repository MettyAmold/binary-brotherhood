// Windows-Freigaben mit Spielordnern: Verwaltung und Einrichtungs-Assistent für Laien.
import { h, mount, modal, confirmDialog, toast, field, input, timeAgo, copyText } from "../ui.js";
import { api, currentRealm } from "../api.js";
import { store } from "../store.js";

const scanInfo = (r) => `${r.folders} Ordner, ${r.added} neue Spiele` + (r.error ? ` – Fehler: ${r.error}` : "");

/** Dialog: eingetragene Freigaben, Assistent und Experten-Formular. */
export function sharesDialog() {
  const list = h("div", { class: "stack" });
  const path = input({ placeholder: "\\\\192.168.0.10\\Spiele", autocapitalize: "off", autocorrect: "off", spellcheck: false });
  const user = input({ placeholder: "leer = Gastzugriff", autocapitalize: "off" });
  const pass = input({ type: "password", placeholder: "Passwort", autocomplete: "off" });
  let busy = false;

  const load = async () => {
    const shares = await api.get("/api/shares");
    mount(list, shares.length ? shares.map(sh => h("div", { class: "card", style: { padding: "10px 12px" } },
      h("div", { class: "row wrap" }, h("code", { class: "share-path grow" }, sh.path), h("span", { class: "chip" }, `${sh.gamesCount} Spiele`)),
      h("div", { class: "small muted", style: { marginTop: "4px" } },
        sh.addedByName ? `von ${sh.addedByName} · ` : "", sh.username ? `Benutzer ${sh.username} · ` : "Gast · ",
        sh.lastScanAt ? `zuletzt ${timeAgo(sh.lastScanAt)}: ` : "noch nicht eingelesen",
        sh.lastError ? h("span", { style: { color: "#ff9a9a" } }, sh.lastError) : (sh.lastScanAt ? `${sh.lastCount} Ordner` : "")),
      h("div", { class: "row wrap", style: { marginTop: "8px" } },
        store.mode === "cloud" ? h("button", { class: "btn sm", onClick: () => uploadScriptDialog(sh) }, "Skript für Aktualisierung") : h("button", { class: "btn sm", disabled: busy, onClick: async () => {
          busy = true; toast("Lese Freigabe ein …");
          try { const r = await api.post(`/api/shares/${sh.id}/scan`); toast(scanInfo(r), r.error ? "error" : "success", 5000); } finally { busy = false; load(); }
        } }, "Neu einlesen"),
        (store.isHost || (store.me && store.me.id === sh.addedById)) ? h("button", { class: "btn sm ghost danger", onClick: async () => {
          if (await confirmDialog("Freigabe entfernen?", "Die daraus angelegten Spiele bleiben erhalten, nur der Ordnerpfad wird gelöst.", { okLabel: "Entfernen" })) { await api.del(`/api/shares/${sh.id}`); load(); }
        } }, "Entfernen") : null),
    )) : h("div", { class: "muted small" }, "Noch keine Freigabe eingetragen."));
  };

  const ctx = modal({
    title: "Spiele-Freigaben im LAN",
    wide: true,
    body: h("div", {},
      h("p", { class: "muted small" }, store.mode === "cloud"
        ? "Jeder Unterordner einer Freigabe wird als Spiel angelegt. Weil die App in der Cloud läuft, meldet der PC seine Ordner per Skript. Die Dateien holt sich jeder direkt vom PC: Pfad auf der Spielkarte kopieren und im Explorer einfügen."
        : "Jeder Unterordner einer Freigabe wird automatisch als Spiel angelegt. Die App liest beim Start und alle 15 Minuten neu ein. Die Dateien holt sich jeder direkt vom PC: Pfad auf der Spielkarte kopieren und im Explorer einfügen."),
      list,
      h("hr", { class: "sep" }),
      h("div", { class: "card gold", style: { padding: "12px 14px" } },
        h("h3", {}, "Eigenen PC freigeben"),
        h("p", { class: "muted small", style: { margin: "6px 0 10px" } }, "Der Assistent richtet die Freigabe am Windows-PC ein, testet die Verbindung und trägt sie hier ein. Am besten diese Seite am PC mit den Spielen öffnen."),
        h("button", { class: "btn primary", onClick: () => { ctx.close(); shareWizard(); } }, "🧙 Assistent starten")),
      h("details", { style: { marginTop: "14px" } },
        h("summary", { class: "muted small", style: { cursor: "pointer" } }, "Für Profis: vorhandene Freigabe direkt eintragen"),
        h("div", { style: { marginTop: "10px" } },
          field("Pfad", path, "Beispiel: \\\\192.168.0.10\\Spiele – IP-Adresse ist zuverlässiger als der PC-Name"),
          h("div", { class: "form-row" }, field("Benutzer", user), field("Passwort", pass)),
          h("button", { class: "btn", onClick: async () => {
            if (!path.value.trim()) { toast("Pfad fehlt", "error"); return; }
            const sh = await api.post("/api/shares", { path: path.value.trim(), username: user.value.trim(), password: pass.value });
            path.value = ""; user.value = ""; pass.value = "";
            toast("Freigabe eingetragen, lese ein …");
            await load();
            const r = await api.post(`/api/shares/${sh.id}/scan`);
            toast(scanInfo(r), r.error ? "error" : "success", 6000);
            load();
          } }, "Eintragen und einlesen"))),
    ),
    buttons: store.mode === "cloud" ? [{ label: "Schließen" }] : [
      { label: "Alle neu einlesen", onClick: async () => { const rs = await api.post("/api/shares/scan"); toast(rs.map(scanInfo).join(" · ") || "Keine Freigaben", rs.some(r => r.error) ? "error" : "success", 6000); load(); return false; } },
      { label: "Schließen" },
    ],
  });
  load();
}

/** Cloud: Skript zum erneuten Hochladen der Ordnerliste einer bestehenden Freigabe. */
function uploadScriptDialog(sh) {
  const folder = input({ value: "D:\\Spiele", spellcheck: false });
  const line = h("textarea", { class: "textarea script-box", readonly: true, spellcheck: false, style: { minHeight: "64px" } });
  const shareName = sh.path.split("\\").filter(Boolean)[1] || "Spiele";
  const refresh = () => { line.value = oneLiner({ base: location.origin, shareId: sh.id, uploadKey: sh.uploadKey, folder: folder.value.trim() || "D:\\Spiele", shareName, setupShare: false }); };
  folder.addEventListener("input", refresh); refresh();
  modal({
    title: "Ordnerliste aktualisieren", wide: true,
    body: h("div", {}, h("p", { class: "small" }, "Diese eine Zeile am PC in PowerShell einfügen (keine Administratorrechte nötig), dann sind neue Spielordner in der App."), field("Ordner am PC", folder), line),
    buttons: [{ label: "Befehl kopieren", onClick: async () => { toast((await copyText(line.value)) ? "Befehl kopiert" : "Kopieren nicht möglich", "success"); return false; } }, { label: "Schließen" }],
  });
}

// ---------- Assistent ----------

function randomPassword(n = 12) {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  try {
    const buf = new Uint8Array(n); crypto.getRandomValues(buf);
    for (const b of buf) out += chars[b % chars.length];
  } catch { for (let i = 0; i < n; i++) out += chars[Math.floor(Math.random() * chars.length)]; }
  return out;
}

/** PowerShell-Skript (als Administrator), das Lesebenutzer, Freigabe, Rechte und Firewall einrichtet. */
export function buildSetupScript({ folder, shareName, user, pass }) {
  const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
  const lines = [
    `# BINARY BROTHERHOOD – Spiele-Freigabe einrichten (als Administrator ausführen)`,
    `$ErrorActionPreference = 'Stop'`,
    `$path = ${q(folder)}; $share = ${q(shareName)}; $user = ${q(user)}; $pass = ${q(pass)}`,
    `if (-not (Test-Path $path)) { throw "Ordner $path gibt es nicht" }`,
    `$secure = ConvertTo-SecureString $pass -AsPlainText -Force`,
    `# 1. Eigener Lesebenutzer (erscheint nicht am Anmeldebildschirm)`,
    `if (Get-LocalUser -Name $user -ErrorAction SilentlyContinue) { Set-LocalUser -Name $user -Password $secure -PasswordNeverExpires $true } else { New-LocalUser -Name $user -Password $secure -PasswordNeverExpires -UserMayNotChangePassword -Description 'BINARY BROTHERHOOD Spiele-Freigabe' | Out-Null }`,
    `$reg = 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon\\SpecialAccounts\\UserList'`,
    `New-Item -Path $reg -Force | Out-Null; New-ItemProperty -Path $reg -Name $user -Value 0 -PropertyType DWord -Force | Out-Null`,
    `# 2. Freigabe mit Leserecht`,
    `if (Get-SmbShare -Name $share -ErrorAction SilentlyContinue) { Grant-SmbShareAccess -Name $share -AccountName $user -AccessRight Read -Force | Out-Null } else { New-SmbShare -Name $share -Path $path -ReadAccess $user | Out-Null }`,
    `# 3. NTFS-Leserecht auf den Ordner`,
    `$acl = Get-Acl $path`,
    `$rule = New-Object System.Security.AccessControl.FileSystemAccessRule($user, 'ReadAndExecute', 'ContainerInherit,ObjectInherit', 'None', 'Allow')`,
    `$acl.AddAccessRule($rule); Set-Acl -Path $path -AclObject $acl`,
    `# 4. Netzwerkprofil auf Privat und Firewall-Regeln für die Freigabe`,
    `Get-NetConnectionProfile | Where-Object { $_.NetworkCategory -eq 'Public' } | Set-NetConnectionProfile -NetworkCategory Private`,
    `foreach ($g in 'Datei- und Druckerfreigabe', 'File and Printer Sharing') { Enable-NetFirewallRule -DisplayGroup $g -ErrorAction SilentlyContinue }`,
    `Set-SmbServerConfiguration -EnableSMB2Protocol $true -Force`,
    `Write-Host ''; Write-Host 'Fertig! Freigabe:' ('\\\\' + $env:COMPUTERNAME + '\\' + $share) -ForegroundColor Green`,
    `Write-Host 'IP-Adressen dieses PCs:' ((Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.*' }).IPAddress -join ', ')`,
  ];
  // Als ein Block (& { … }), damit die Konsole beim Einfügen alles zusammen ausführt statt Zeile für Zeile
  return "& {\r\n" + lines.map(l => "  " + l).join("\r\n") + "\r\n}\r\n";
}

/** Cloud-Skript: lädt die Unterordner des Spiele-Ordners zur App hoch; optional vorher die Windows-Freigabe einrichten. */
export function buildUploadScript({ folder, base, shareId, uploadKey, setupShare, shareName, user, pass }) {
  const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
  const lines = [
    `# BINARY BROTHERHOOD – Spielordner an die App melden` + (setupShare ? ` und Freigabe einrichten (als Administrator ausführen)` : ``),
    `$ErrorActionPreference = 'Stop'`,
    `$path = ${q(folder)}`,
    `if (-not (Test-Path $path)) { throw "Ordner $path gibt es nicht" }`,
  ];
  if (setupShare) {
    const inner = buildSetupScript({ folder, shareName, user, pass }).split("\r\n").map(l => l.replace(/^  /, "")).filter(l => l && l !== "& {" && l !== "}");
    lines.push(...inner.slice(2).filter(l => !l.startsWith("$path = ")));
  }
  lines.push(
    `# Ordnerliste hochladen`,
    `$folders = @(Get-ChildItem -LiteralPath $path -Directory | Select-Object -ExpandProperty Name)`,
    `$body = [System.Text.Encoding]::UTF8.GetBytes((@{ folders = $folders } | ConvertTo-Json -Compress))`,
    `$r = Invoke-RestMethod -Method Post -Uri ${q(base + "/api/shares/" + shareId + "/folders?realm=" + encodeURIComponent(currentRealm()))} -Headers @{ 'X-Share-Key' = ${q(uploadKey)} } -ContentType 'application/json; charset=utf-8' -Body $body`,
    `Write-Host ''; Write-Host ("Fertig! " + $r.folders + " Ordner gemeldet, " + $r.added + " neue Spiele.") -ForegroundColor Green`,
  );
  return "& {\r\n" + lines.map(l => "  " + l).join("\r\n") + "\r\n}\r\n";
}

/** Eine Zeile für PowerShell: holt das Skript vom Server und führt es als Ganzes aus. */
export function oneLiner({ base, shareId, uploadKey, folder, shareName, setupShare, user, pass }) {
  const p = new URLSearchParams({ key: uploadKey, folder, share: shareName, realm: currentRealm() });
  if (setupShare) { p.set("setup", "1"); p.set("user", user); p.set("pass", pass); }
  return `irm '${base}/api/shares/${shareId}/setup.ps1?${p.toString()}' | iex`;
}

/** Assistent für die Cloud: Pfad angeben, Skript am PC ausführen, Ergebnis abwarten. */
async function cloudShareWizard() {
  let info = { base: location.origin };
  try { info = await api.get("/api/shares/wizard", { silent: true }); } catch { /* egal */ }
  const st = { folder: "D:\\Spiele", host: "", shareName: "Spiele", setupShare: false, user: "bbl", pass: randomPassword(), share: null };
  const body = h("div");
  let ctx;
  const stepsBar = (n) => h("div", { class: "wizard-steps" }, ["PC & Ordner", "Skript", "Ergebnis"].map((l, i) => h("span", { class: i + 1 === n ? "on" : (i + 1 < n ? "done" : "") }, `${i + 1} ${l}`)));

  const step1 = () => {
    const host = input({ value: st.host, placeholder: "z. B. 192.168.0.10 oder PC-NAME", autocapitalize: "off", spellcheck: false });
    const folder = input({ value: st.folder, placeholder: "D:\\Spiele", spellcheck: false });
    const shareName = input({ value: st.shareName, spellcheck: false });
    const setup = h("input", { type: "checkbox", checked: st.setupShare });
    mount(body, stepsBar(1),
      h("p", { class: "small" }, "Die App läuft in der Cloud und kommt nicht in euer LAN. Darum meldet der PC seine Spielordner selbst: Du führst einmal ein Skript aus, bei neuen Spielen einfach nochmal."),
      field("Adresse des PCs im LAN", host, "Darunter erreichen die anderen deine Freigabe, z. B. 192.168.0.10"),
      h("div", { class: "form-row" }, field("Ordner am PC", folder, "Jedes Spiel ein Unterordner"), field("Name der Freigabe", shareName)),
      h("label", { class: "check" }, setup, h("span", {}, "Freigabe am PC gleich mit einrichten (braucht Administratorrechte)")),
      h("div", { class: "row wrap", style: { marginTop: "14px", justifyContent: "flex-end" } },
        h("button", { class: "btn primary", onClick: async () => {
          st.host = host.value.trim(); st.folder = folder.value.trim() || "D:\\Spiele"; st.shareName = (shareName.value.trim() || "Spiele").replace(/[\\/]/g, ""); st.setupShare = setup.checked;
          if (!st.host) return toast("Adresse fehlt", "error");
          if (!st.share) st.share = await api.post("/api/shares", { path: `\\\\${st.host}\\${st.shareName}` });
          step2();
        } }, "Weiter")));
  };

  const step2 = () => {
    const args = { folder: st.folder, base: info.base || location.origin, shareId: st.share.id, uploadKey: st.share.uploadKey, setupShare: st.setupShare, shareName: st.shareName, user: st.user, pass: st.pass };
    const line = oneLiner(args);
    const lineBox = h("textarea", { class: "textarea script-box", readonly: true, spellcheck: false, style: { minHeight: "64px" } }); lineBox.value = line;
    const script = h("textarea", { class: "textarea script-box", readonly: true, spellcheck: false }); script.value = buildUploadScript(args);
    mount(body, stepsBar(2),
      h("ol", { class: "small", style: { paddingLeft: "20px", lineHeight: "1.7" } },
        h("li", {}, "Unten auf „Befehl kopieren“ tippen (eine einzige Zeile)."),
        h("li", {}, "Am PC die Windows-Taste drücken, „powershell“ tippen", st.setupShare ? [" und ", h("strong", {}, "„Als Administrator ausführen“"), " wählen."] : " und öffnen."),
        h("li", {}, "Im blauen Fenster Rechtsklick (fügt ein) und Enter drücken."),
        h("li", {}, "Wenn „Fertig!“ erscheint: hier auf „Weiter“.")),
      lineBox,
      h("details", { style: { marginTop: "8px" } }, h("summary", { class: "small muted", style: { cursor: "pointer" } }, "Was der Befehl macht (vollständiges Skript)"), script),
      h("div", { class: "row wrap", style: { marginTop: "14px", justifyContent: "flex-end" } },
        h("button", { class: "btn ghost", onClick: step1 }, "Zurück"),
        h("button", { class: "btn", onClick: async () => toast((await copyText(line)) ? "Befehl kopiert" : "Kopieren nicht möglich – Text markieren und manuell kopieren", "success") }, "Befehl kopieren"),
        h("button", { class: "btn primary", onClick: step3 }, "Weiter")));
  };

  const step3 = () => {
    const result = h("div", { style: { marginTop: "10px" } });
    let timer = null;
    const check = async () => {
      const sh = (await api.get("/api/shares")).find(x => x.id === st.share.id);
      if (sh && sh.lastScanAt) {
        clearInterval(timer);
        mount(result, h("div", { class: "card", style: { borderColor: "#35612c", padding: "10px 12px" } }, h("div", { style: { color: "#9ad88c" } }, `Angekommen! ${sh.lastCount} Ordner gemeldet, ${sh.gamesCount} Spiele verknüpft.`)));
      } else {
        mount(result, h("div", { class: "muted small" }, "Warte auf das Skript … (prüft alle 5 Sekunden)"));
      }
    };
    mount(body, stepsBar(3),
      h("p", {}, "Freigabe ", h("code", { class: "share-path" }, st.share.path)),
      result,
      h("div", { class: "row wrap", style: { marginTop: "14px", justifyContent: "flex-end" } },
        h("button", { class: "btn ghost", onClick: () => { clearInterval(timer); step2(); } }, "Zurück"),
        h("button", { class: "btn primary", onClick: () => { clearInterval(timer); ctx.close(); sharesDialog(); } }, "Fertig")));
    check(); timer = setInterval(check, 5000);
  };

  ctx = modal({ title: "Spiele-Freigabe einrichten", wide: true, body, buttons: [{ label: "Abbrechen" }] });
  step1();
}

export async function shareWizard() {
  if (store.mode === "cloud") return cloudShareWizard();
  let info = { clientIp: "", clientIsHostPhone: false, hostAddresses: [] };
  try { info = await api.get("/api/shares/wizard", { silent: true }); } catch { /* ohne Vorbelegung weiter */ }
  const st = {
    host: info.clientIsHostPhone ? "" : info.clientIp,
    detected: !info.clientIsHostPhone && !!info.clientIp,
    folder: "D:\\Spiele", shareName: "Spiele", user: "bbl", pass: randomPassword(),
    path: "", mode: "script",
  };
  const body = h("div");
  let ctx;

  const stepsBar = (n) => h("div", { class: "wizard-steps" }, ["PC", "Einrichten", "Testen"].map((l, i) => h("span", { class: i + 1 === n ? "on" : (i + 1 < n ? "done" : "") }, `${i + 1} ${l}`)));
  const nav = (...btns) => h("div", { class: "row wrap", style: { marginTop: "14px", justifyContent: "flex-end" } }, btns);

  // ---- Schritt 1: Welcher PC?
  const step1 = () => {
    const host = input({ value: st.host, placeholder: "z. B. 192.168.0.10", autocapitalize: "off", spellcheck: false });
    mount(body, stepsBar(1),
      h("p", {}, "Auf welchem PC liegen die Spiele?"),
      st.detected
        ? h("p", { class: "small muted" }, `Diese Seite ist von ${info.clientIp} aus geöffnet. Wenn das der PC mit den Spielen ist, passt die Vorbelegung.`)
        : h("p", { class: "small muted" }, "Tipp: Öffne diese Seite am PC mit den Spielen, dann wird die Adresse automatisch erkannt. Sonst am PC in der Eingabeaufforderung „ipconfig“ eingeben und die IPv4-Adresse abschreiben."),
      field("Adresse des PCs", host, "IP-Adresse ist zuverlässiger als der PC-Name"),
      h("p", { style: { marginTop: "10px" } }, "Wie soll der Ordner freigegeben werden?"),
      h("div", { class: "pick-list" },
        h("div", { class: "it", onClick: () => { st.host = host.value.trim(); if (!st.host) return toast("Adresse fehlt", "error"); st.mode = "script"; step2(); } },
          h("span", {}, "🧙"), h("div", { class: "grow" }, h("div", {}, "Freigabe neu einrichten (empfohlen)"), h("div", { class: "small muted" }, "Ein Skript erledigt alles am PC. Du brauchst nur Administratorrechte."))),
        h("div", { class: "it", onClick: () => { st.host = host.value.trim(); if (!st.host) return toast("Adresse fehlt", "error"); st.mode = "existing"; step2b(); } },
          h("span", {}, "📁"), h("div", { class: "grow" }, h("div", {}, "Vorhandene Freigabe verwenden"), h("div", { class: "small muted" }, "Freigaben und Ordner des PCs anzeigen und auswählen."))),
      ),
    );
  };

  // ---- Schritt 2: Skript
  const step2 = () => {
    const folder = input({ value: st.folder, placeholder: "D:\\Spiele", spellcheck: false });
    const shareName = input({ value: st.shareName, placeholder: "Spiele", spellcheck: false });
    const script = h("textarea", { class: "textarea script-box", readonly: true, spellcheck: false });
    const refresh = () => {
      st.folder = folder.value.trim() || "D:\\Spiele"; st.shareName = (shareName.value.trim() || "Spiele").replace(/[\\/]/g, "");
      script.value = buildSetupScript({ folder: st.folder, shareName: st.shareName, user: st.user, pass: st.pass });
    };
    folder.addEventListener("input", refresh); shareName.addEventListener("input", refresh); refresh();
    mount(body, stepsBar(2),
      h("div", { class: "form-row" }, field("Ordner am PC", folder, "Der Ordner, in dem jedes Spiel einen Unterordner hat"), field("Name der Freigabe", shareName)),
      h("p", { class: "small" }, "Das Skript legt am PC einen eigenen Lesebenutzer an, gibt den Ordner frei, setzt die Rechte und öffnet die Firewall. Nichts anderes wird verändert."),
      h("ol", { class: "small", style: { paddingLeft: "20px", lineHeight: "1.7" } },
        h("li", {}, "Unten auf „Skript kopieren“ tippen."),
        h("li", {}, "Am PC die Windows-Taste drücken, „powershell“ tippen und ", h("strong", {}, "„Als Administrator ausführen“"), " wählen."),
        h("li", {}, "Im blauen Fenster Rechtsklick (fügt ein) und Enter drücken."),
        h("li", {}, "Wenn „Fertig!“ erscheint: hier auf „Weiter“.")),
      script,
      nav(
        h("button", { class: "btn ghost", onClick: step1 }, "Zurück"),
        h("button", { class: "btn", onClick: async () => toast((await copyText(script.value)) ? "Skript kopiert" : "Kopieren nicht möglich – Text markieren und manuell kopieren", "success") }, "Skript kopieren"),
        h("button", { class: "btn primary", onClick: () => { st.path = `\\\\${st.host}\\${st.shareName}`; step3(); } }, "Weiter: Verbindung testen"),
      ),
    );
  };

  // ---- Schritt 2b: vorhandene Freigabe durchsuchen
  const step2b = () => {
    const user = input({ value: st.user === "bbl" ? "" : st.user, placeholder: "Windows-Benutzer des PCs", autocapitalize: "off" });
    const pass = input({ type: "password", value: "", placeholder: "Passwort", autocomplete: "off" });
    const listEl = h("div", { class: "pick-list", style: { marginTop: "10px" } });
    const crumb = h("div", { class: "small muted", style: { marginTop: "10px" } });
    let current = "";
    const browse = async (path) => {
      st.user = user.value.trim(); st.pass = pass.value;
      mount(listEl, h("div", { class: "muted small" }, "Lade …"));
      const r = await api.post("/api/shares/browse", { host: st.host, path, username: st.user, password: st.pass });
      if (r.error) { mount(listEl, h("div", { style: { color: "#ff9a9a" } }, r.hint || r.error)); return; }
      current = path;
      crumb.textContent = path ? path : `Freigaben von ${st.host}`;
      mount(listEl,
        path ? h("div", { class: "it", onClick: () => { const up = path.split("\\").slice(0, -1).join("\\"); browse(up.split("\\").filter(Boolean).length >= 2 ? up : ""); } }, h("span", {}, "↑"), h("span", { class: "grow muted" }, "Eine Ebene höher")) : null,
        r.entries.length ? r.entries.map(e => h("div", { class: "it", onClick: () => browse(path ? `${path}\\${e.name}` : `\\\\${st.host}\\${e.name}`) }, h("span", {}, e.kind === "share" ? "💾" : "📁"), h("span", { class: "grow" }, e.name))) : h("div", { class: "muted small" }, "Keine Unterordner."),
      );
    };
    mount(body, stepsBar(2),
      h("p", { class: "small" }, "Zugang zum PC. Leer gelassen wird Gastzugriff versucht, den Windows meist blockiert."),
      h("div", { class: "form-row" }, field("Benutzer", user), field("Passwort", pass)),
      h("button", { class: "btn", onClick: () => browse("") }, "Freigaben anzeigen"),
      crumb, listEl,
      nav(
        h("button", { class: "btn ghost", onClick: step1 }, "Zurück"),
        h("button", { class: "btn primary", onClick: () => { if (!current) return toast("Zuerst eine Freigabe oder einen Ordner wählen", "error"); st.path = current; step3(); } }, "Diesen Ordner verwenden"),
      ),
    );
    browse("");
  };

  // ---- Schritt 3: testen und speichern
  const step3 = () => {
    const result = h("div", { style: { marginTop: "10px" } });
    const saveBtn = h("button", { class: "btn primary", disabled: true, onClick: async () => {
      const sh = await api.post("/api/shares", { path: st.path, username: st.user, password: st.pass });
      const r = await api.post(`/api/shares/${sh.id}/scan`);
      toast(scanInfo(r), r.error ? "error" : "success", 6000);
      ctx.close(); sharesDialog();
    } }, "Freigabe speichern und einlesen");
    const test = async () => {
      mount(result, h("div", { class: "muted small" }, "Verbinde mit dem PC …"));
      const r = await api.post("/api/shares/test", { path: st.path, username: st.user, password: st.pass });
      if (r.error) {
        saveBtn.disabled = true;
        mount(result, h("div", { class: "card", style: { borderColor: "#5a2a2a", padding: "10px 12px" } },
          h("div", { style: { color: "#ff9a9a" } }, r.hint || r.error), h("div", { class: "small muted", style: { marginTop: "4px" } }, r.error)));
      } else {
        saveBtn.disabled = false;
        mount(result, h("div", { class: "card", style: { borderColor: "#35612c", padding: "10px 12px" } },
          h("div", { style: { color: "#9ad88c" } }, `Verbunden! ${r.folders.length} Spielordner gefunden:`),
          h("div", { class: "small muted", style: { marginTop: "4px" } }, r.folders.length ? r.folders.slice(0, 30).join(", ") + (r.folders.length > 30 ? " …" : "") : "Noch keine Unterordner – lege pro Spiel einen Ordner an.")));
      }
    };
    mount(body, stepsBar(3),
      h("p", {}, "Verbindung zu ", h("code", { class: "share-path" }, st.path), st.user ? ` als Benutzer ${st.user}` : " als Gast"),
      result,
      nav(
        h("button", { class: "btn ghost", onClick: () => (st.mode === "script" ? step2() : step2b()) }, "Zurück"),
        h("button", { class: "btn", onClick: test }, "Erneut testen"),
        saveBtn,
      ),
    );
    test();
  };

  ctx = modal({ title: "Spiele-Freigabe einrichten", wide: true, body, buttons: [{ label: "Abbrechen" }] });
  step1();
}
