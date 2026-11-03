// Windows-Freigaben mit Spielordnern: Verwaltung und Einrichtungs-Assistent für Laien.
import { h, mount, modal, confirmDialog, toast, field, input, timeAgo, copyText } from "../ui.js";
import { api } from "../api.js";
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
        h("button", { class: "btn sm", disabled: busy, onClick: async () => {
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
      h("p", { class: "muted small" }, "Jeder Unterordner einer Freigabe wird automatisch als Spiel angelegt. Die App liest beim Start und alle 15 Minuten neu ein. Die Dateien holt sich jeder direkt vom PC: Pfad auf der Spielkarte kopieren und im Explorer einfügen."),
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
    buttons: [
      { label: "Alle neu einlesen", onClick: async () => { const rs = await api.post("/api/shares/scan"); toast(rs.map(scanInfo).join(" · ") || "Keine Freigaben", rs.some(r => r.error) ? "error" : "success", 6000); load(); return false; } },
      { label: "Schließen" },
    ],
  });
  load();
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
  return [
    `# BINARY BROTHERHOOD – Spiele-Freigabe einrichten (als Administrator ausführen)`,
    `$ErrorActionPreference = 'Stop'`,
    `$path = ${q(folder)}; $share = ${q(shareName)}; $user = ${q(user)}; $pass = ${q(pass)}`,
    `if (-not (Test-Path $path)) { throw "Ordner $path gibt es nicht" }`,
    `$secure = ConvertTo-SecureString $pass -AsPlainText -Force`,
    `# 1. Eigener Lesebenutzer (erscheint nicht am Anmeldebildschirm)`,
    `if (Get-LocalUser -Name $user -ErrorAction SilentlyContinue) { Set-LocalUser -Name $user -Password $secure -PasswordNeverExpires $true }`,
    `else { New-LocalUser -Name $user -Password $secure -PasswordNeverExpires -UserMayNotChangePassword -Description 'BINARY BROTHERHOOD Spiele-Freigabe' | Out-Null }`,
    `$reg = 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon\\SpecialAccounts\\UserList'`,
    `New-Item -Path $reg -Force | Out-Null; New-ItemProperty -Path $reg -Name $user -Value 0 -PropertyType DWord -Force | Out-Null`,
    `# 2. Freigabe mit Leserecht`,
    `if (Get-SmbShare -Name $share -ErrorAction SilentlyContinue) { Grant-SmbShareAccess -Name $share -AccountName $user -AccessRight Read -Force | Out-Null }`,
    `else { New-SmbShare -Name $share -Path $path -ReadAccess $user | Out-Null }`,
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
  ].join("\r\n");
}

export async function shareWizard() {
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
