// Spiele-Freigaben: Der PC meldet seine Spielordner per PowerShell-Befehl, jeder Unterordner wird ein Spiel.
import { h, mount, modal, confirmDialog, toast, field, input, timeAgo, copyText } from "../ui.js";
import { api, currentRealm } from "../api.js";
import { store } from "../store.js";

/** Eine PowerShell-Zeile: holt das Skript vom Server und führt es aus. */
function oneLiner({ shareId, uploadKey, folder, shareName, setupShare, user, pass }) {
  const p = new URLSearchParams({ key: uploadKey, folder, share: shareName, realm: currentRealm() });
  if (setupShare) { p.set("setup", "1"); p.set("user", user); p.set("pass", pass); }
  return `irm '${location.origin}/api/shares/${shareId}/setup.ps1?${p.toString()}' | iex`;
}

function randomPassword(n = 12) {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return [...crypto.getRandomValues(new Uint8Array(n))].map(b => chars[b % chars.length]).join("");
}

const commandBox = (value) => { const t = h("textarea", { class: "textarea script-box", readonly: true, spellcheck: false, style: { minHeight: "64px" } }); t.value = value; return t; };
const copyButton = (getText) => h("button", { class: "btn", onClick: async () => toast((await copyText(getText())) ? "Befehl kopiert" : "Kopieren nicht möglich", "success") }, "Befehl kopieren");

export function sharesDialog() {
  const list = h("div", { class: "stack" });
  const load = async () => {
    const shares = await api.get("/api/shares");
    mount(list, shares.length ? shares.map(sh => h("div", { class: "card", style: { padding: "10px 12px" } },
      h("div", { class: "row wrap" }, h("code", { class: "share-path grow" }, sh.path), h("span", { class: "chip" }, `${sh.gamesCount} Spiele`)),
      h("div", { class: "small muted", style: { marginTop: "4px" } },
        sh.addedByName ? `${sh.addedByName} · ` : "",
        sh.lastScanAt ? `aktualisiert ${timeAgo(sh.lastScanAt)}, ${sh.lastCount} Ordner` : "noch keine Ordner gemeldet"),
      h("div", { class: "row wrap", style: { marginTop: "8px" } },
        h("button", { class: "btn sm", onClick: () => updateDialog(sh) }, "Aktualisieren"),
        (store.isAdmin || store.me?.id === sh.addedById) ? h("button", { class: "btn sm ghost danger", onClick: async () => {
          if (await confirmDialog("Freigabe entfernen?", "Die Spiele bleiben erhalten.", { okLabel: "Entfernen" })) { await api.del(`/api/shares/${sh.id}`); load(); }
        } }, "Entfernen") : null),
    )) : h("div", { class: "muted small" }, "Noch keine Freigabe."));
  };
  const ctx = modal({
    title: "Spiele-Freigaben",
    wide: true,
    body: h("div", {},
      h("p", { class: "muted small" }, "Jeder Unterordner ist ein Spiel."),
      list,
      h("button", { class: "btn primary", style: { marginTop: "12px" }, onClick: () => { ctx.close(); shareWizard(); } }, "Freigabe hinzufügen")),
    buttons: [{ label: "Schließen" }],
  });
  load();
}

/** Ordnerliste einer bestehenden Freigabe neu melden. */
function updateDialog(sh) {
  const folder = input({ value: "D:\\Spiele", spellcheck: false });
  const shareName = sh.path.split("\\").filter(Boolean)[1] || "Spiele";
  const line = () => oneLiner({ shareId: sh.id, uploadKey: sh.uploadKey, folder: folder.value.trim() || "D:\\Spiele", shareName, setupShare: false });
  const box = commandBox(line());
  folder.addEventListener("input", () => { box.value = line(); });
  modal({
    title: "Freigabe aktualisieren", wide: true,
    body: h("div", {}, h("p", { class: "small" }, "Am PC in PowerShell einfügen und Enter drücken."), field("Ordner am PC", folder), box),
    buttons: [{ label: "Befehl kopieren", onClick: async () => { toast((await copyText(box.value)) ? "Befehl kopiert" : "Kopieren nicht möglich", "success"); return false; } }, { label: "Schließen" }],
  });
}

/** Assistent: PC und Ordner angeben, Befehl am PC ausführen, auf die Meldung warten. */
export function shareWizard() {
  const st = { folder: "D:\\Spiele", host: "", shareName: "Spiele", setupShare: false, user: "bbl", pass: randomPassword(), share: null };
  const body = h("div");
  let ctx;
  const stepsBar = (n) => h("div", { class: "wizard-steps" }, ["PC", "Befehl", "Fertig"].map((l, i) => h("span", { class: i + 1 === n ? "on" : (i + 1 < n ? "done" : "") }, `${i + 1} ${l}`)));
  const nav = (...btns) => h("div", { class: "row wrap", style: { marginTop: "14px", justifyContent: "flex-end" } }, btns);

  const step1 = () => {
    const host = input({ value: st.host, placeholder: "192.168.0.10 oder PC-NAME", autocapitalize: "off", spellcheck: false });
    const folder = input({ value: st.folder, placeholder: "D:\\Spiele", spellcheck: false });
    const shareName = input({ value: st.shareName, spellcheck: false });
    const setup = h("input", { type: "checkbox", checked: st.setupShare });
    mount(body, stepsBar(1),
      field("Adresse des PCs im LAN", host),
      h("div", { class: "form-row" }, field("Ordner mit den Spielen", folder), field("Name der Freigabe", shareName)),
      h("label", { class: "check" }, setup, h("span", {}, "Windows-Freigabe auch einrichten (Administrator)")),
      nav(h("button", { class: "btn primary", onClick: async () => {
        st.host = host.value.trim(); st.folder = folder.value.trim() || "D:\\Spiele"; st.shareName = (shareName.value.trim() || "Spiele").replace(/[\\/]/g, ""); st.setupShare = setup.checked;
        if (!st.host) return toast("Adresse fehlt", "error");
        if (!st.share) st.share = await api.post("/api/shares", { path: `\\\\${st.host}\\${st.shareName}` });
        step2();
      } }, "Weiter")));
  };

  const step2 = () => {
    const line = oneLiner({ shareId: st.share.id, uploadKey: st.share.uploadKey, folder: st.folder, shareName: st.shareName, setupShare: st.setupShare, user: st.user, pass: st.pass });
    mount(body, stepsBar(2),
      h("ol", { class: "small", style: { paddingLeft: "20px", lineHeight: "1.7" } },
        h("li", {}, "Befehl kopieren."),
        h("li", {}, "Am PC PowerShell öffnen", st.setupShare ? [" – ", h("strong", {}, "als Administrator")] : "", "."),
        h("li", {}, "Einfügen (Rechtsklick) und Enter drücken.")),
      commandBox(line),
      nav(h("button", { class: "btn ghost", onClick: step1 }, "Zurück"), copyButton(() => line), h("button", { class: "btn primary", onClick: step3 }, "Weiter")));
  };

  const step3 = () => {
    const result = h("div", { style: { marginTop: "10px" } });
    let timer = null;
    const check = async () => {
      const sh = (await api.get("/api/shares")).find(x => x.id === st.share.id);
      if (sh?.lastScanAt) {
        clearInterval(timer);
        mount(result, h("div", { class: "card", style: { borderColor: "#35612c", padding: "10px 12px", color: "#9ad88c" } }, `${sh.lastCount} Ordner gemeldet, ${sh.gamesCount} Spiele verknüpft.`));
      } else mount(result, h("div", { class: "muted small" }, "Warte auf den PC …"));
    };
    mount(body, stepsBar(3),
      h("p", {}, h("code", { class: "share-path" }, st.share.path)),
      result,
      nav(h("button", { class: "btn ghost", onClick: () => { clearInterval(timer); step2(); } }, "Zurück"),
        h("button", { class: "btn primary", onClick: () => { clearInterval(timer); ctx.close(); sharesDialog(); } }, "Fertig")));
    check(); timer = setInterval(check, 5000);
  };

  ctx = modal({ title: "Freigabe hinzufügen", wide: true, body, buttons: [{ label: "Abbrechen" }] });
  step1();
}
