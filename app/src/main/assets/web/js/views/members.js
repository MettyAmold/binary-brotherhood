// Mitglieder: Profile, Avatar-Upload, XP, Level und Rang.
import { h, mount, modal, confirmDialog, avatar, empty, fmtDate, toast, input, field, resizeImage, timeAgo } from "../ui.js";
import { api, authHeaders, setRealm } from "../api.js";
import { store, on } from "../store.js";
import { changePasswordDialog } from "../account.js";

const COLORS = ["#C9A24D", "#D96C4F", "#4FA3D9", "#6BBF59", "#B05ED9", "#E0B04C", "#48C9B0", "#E05C8A", "#8E9BFF", "#F08A24", "#5DD39E", "#D64545"];

export async function renderMembers(main, params) {
  const content = h("div");
  let detailId = params[0] ? Number(params[0]) : null;

  const draw = () => {
    if (detailId) { const m = store.member(detailId); if (m) { mount(content, profile(m)); return; } detailId = null; }
    const list = store.members.slice().sort((a, b) => b.xp - a.xp);
    mount(content,
      h("div", { class: "page-head" }, h("h2", {}, "Bruderschaft"), h("span", { class: "chip" }, `${list.length} Mitglieder`)),
      list.length ? h("div", { class: "grid tight" }, list.map((m, i) => h("div", { class: `card member-card ${store.me && store.me.id === m.id ? "me" : ""}`, onClick: () => { location.hash = `#/members/${m.id}`; } },
        h("div", { style: { position: "relative" } }, avatar(m, "lg"), h("span", { class: "level-badge", style: { position: "absolute", right: "-6px", bottom: "-4px" } }, m.level)),
        h("div", { style: { fontWeight: 700, marginTop: "4px" } }, store.isOnline(m.id) ? h("span", { class: "online-dot", title: "online" }) : null, m.name),
        h("div", { class: "rank" }, m.rank),
        h("div", { class: "small muted" }, `${m.xp} XP${i === 0 && m.xp > 0 ? " · 👑" : ""}`),
        h("div", { class: "xp-bar" }, h("i", { style: { width: `${Math.round(m.progress * 100)}%` } })),
      ))) : empty("🛡️", "Noch keine Mitglieder."),
    );
  };

  const profile = (m) => {
    const mine = store.me && store.me.id === m.id;
    // Profil (Name, Bild, Motto) gilt in allen Realms: nur Inhaber oder Super-Admin. Admin-Rechte/Entfernen: Realm-Admins.
    const canEdit = mine || store.isSuperAdmin;
    const canManage = canEdit || store.isAdmin;
    const log = h("div", { class: "xp-log" }, h("div", { class: "muted small" }, "Lade …"));
    api.get(`/api/members/${m.id}/xp`).then(entries => mount(log, entries.length ? entries.map(e => h("div", { class: "it" }, h("span", {}, e.label), h("span", { class: "muted small" }, timeAgo(e.createdAt)), h("strong", { class: "gold" }, `+${e.amount}`))) : h("div", { class: "muted small" }, "Noch keine XP."))).catch(() => {});
    const file = h("input", { type: "file", accept: "image/*", class: "hidden", onChange: async () => {
      const f = file.files[0]; if (!f) return;
      try {
        toast("Bild wird hochgeladen …");
        const blob = await resizeImage(f, 512);
        const res = await fetch(`/api/members/${m.id}/avatar`, { method: "POST", headers: { ...authHeaders(), "Content-Type": "image/jpeg" }, body: blob });
        if (!res.ok) {
          let msg = "Upload fehlgeschlagen";
          try { msg = (await res.json()).error || msg; } catch { /* kein JSON */ }
          throw new Error(msg);
        }
        toast("Profilbild gespeichert", "success");
      } catch (e) { toast(e.message, "error"); }
      file.value = "";
    } });
    const stats = m.stats;
    return h("div", {},
      h("div", { class: "page-head" }, h("a", { class: "btn ghost", href: "#/members" }, "← Alle"), h("h2", {}, "Profil"),
        mine ? h("span", { class: "chip gold" }, "Dein Profil") : null, m.isAdmin ? h("span", { class: "chip gold" }, "👑 Admin") : null),
      h("div", { class: "card gold" },
        h("div", { class: "profile-head" },
          h("div", { style: { position: "relative" }, onClick: () => { if (canEdit) file.click(); }, title: canEdit ? "Profilbild ändern" : "" }, avatar(m, "xl"),
            canEdit ? h("span", { class: "chip gold", style: { position: "absolute", bottom: "-4px", left: "50%", transform: "translateX(-50%)", cursor: "pointer" } }, "📷") : null),
          file,
          h("div", { class: "grow" },
            h("div", { class: "row wrap" }, h("h3", { style: { fontSize: "22px" } }, m.name), h("span", { class: "level-badge lg" }, m.level), store.isOnline(m.id) ? h("span", { class: "chip green" }, "● online") : null),
            h("div", { class: "rank", style: { fontFamily: "var(--display)", color: "var(--gold)", letterSpacing: ".12em", textTransform: "uppercase", fontSize: "13px" } }, m.rank),
            m.motto ? h("div", { class: "muted", style: { fontStyle: "italic", marginTop: "4px" } }, `„${m.motto}“`) : null,
            h("div", { style: { marginTop: "10px" } },
              h("div", { class: "row between small muted" }, h("span", {}, `${m.xp} XP`), h("span", {}, `Level ${m.level + 1} bei ${m.xpForNextLevel} XP`)),
              h("div", { class: "xp-bar", style: { height: "12px" } }, h("i", { style: { width: `${Math.round(m.progress * 100)}%` } }))),
            canManage ? h("div", { class: "row wrap", style: { marginTop: "10px" } },
              canEdit ? h("button", { class: "btn sm", onClick: () => editMember(m) }, "✎ Bearbeiten") : null,
              canEdit ? h("button", { class: "btn sm", onClick: () => file.click() }, "📷 Profilbild") : null,
              mine ? h("button", { class: "btn sm", onClick: changePasswordDialog }, "🔑 Passwort") : null,
              !mine && store.isAdmin ? h("button", { class: "btn sm", onClick: async () => {
                const makeAdmin = !m.isAdmin;
                if (await confirmDialog(makeAdmin ? "Zum Admin machen?" : "Admin-Rechte entziehen?", `${m.name} ${makeAdmin ? "wird Admin dieses Realms." : "ist dann kein Admin mehr."}`, { okLabel: makeAdmin ? "Zum Admin machen" : "Entziehen", danger: !makeAdmin })) {
                  await api.post(`/api/admin/members/${m.id}/admin`, { admin: makeAdmin }); toast(makeAdmin ? "Ist jetzt Admin" : "Admin-Rechte entzogen", "success");
                }
              } }, m.isAdmin ? "👑 Admin entziehen" : "👑 Zum Admin machen") : null,
              !mine && store.isSuperAdmin ? h("button", { class: "btn sm", onClick: async () => {
                if (await confirmDialog("Passwort zurücksetzen?", `${m.name} legt beim nächsten Login ein neues Passwort fest.`, { okLabel: "Zurücksetzen", danger: false })) {
                  await api.post(`/api/auth/reset/${m.id}`); toast("Passwort zurückgesetzt", "success");
                }
              } }, "🔑 Zurücksetzen") : null,
              h("button", { class: "btn sm ghost danger", onClick: async () => {
                if (await confirmDialog(mine ? "Realm verlassen?" : "Aus dem Realm entfernen?", "XP und Level in diesem Realm gehen verloren.", { okLabel: mine ? "Verlassen" : "Entfernen" })) {
                  await api.del(`/api/members/${m.id}`);
                  if (mine) { setRealm(""); location.href = location.pathname; } else location.hash = "#/members";
                }
              } }, mine ? "Realm verlassen" : "Aus Realm entfernen"),
            ) : h("div", { class: "small muted", style: { marginTop: "10px" } }, "Nur das eigene Profil lässt sich bearbeiten."),
          ),
        ),
      ),
      h("div", { class: "card" }, h("h3", {}, "Statistik"),
        h("div", { class: "stat-grid", style: { marginTop: "10px" } },
          stat(stats.gamesPlayed, "Runden gespielt"), store.lan ? stat(stats.attendanceDays, "LAN-Tage") : null, stat(stats.forumPosts, "Beiträge"),
          stat(stats.comments, "Kommentare"), stat(stats.suggestions, "Vorschläge"), stat(stats.equipmentBrought, "Mitgebracht"), stat(stats.expensesPaid, "Einkäufe"),
        ),
        stats.favoriteGame ? h("div", { class: "small muted", style: { marginTop: "10px" } }, "Lieblingsspiel: ", h("strong", { class: "gold" }, stats.favoriteGame)) : null,
        h("div", { class: "small muted", style: { marginTop: "6px" } }, `Mitglied seit ${fmtDate(m.createdAt, { hour: undefined, minute: undefined })}`)),
      h("div", { class: "card" }, h("h3", {}, "XP-Protokoll"), h("div", { style: { marginTop: "8px" } }, log)),
      h("div", { class: "card" }, h("h3", {}, "Ränge der Bruderschaft"),
        h("div", { class: "small muted", style: { marginTop: "6px" } }, "Novize (1) · Laienbruder (3) · Bruder (5) · Mönch (8) · Prior (11) · Abt (15) · Erzabt (20) · Großmeister (26) · Binärer Erleuchteter (33)"),
        h("div", { class: "small muted", style: { marginTop: "6px" } }, "XP: Runde gespielt +50 · LAN-Tag +30 · Vorschlag übernommen +40 · Ausrüstung mitgebracht +25 · Spiel hinzugefügt +20 · Vorschlag +15 · Einkauf +15 · Beitrag +10 · Kommentar/Abstimmung +5")),
    );
  };

  const stat = (v, l) => h("div", { class: "stat" }, h("div", { class: "v" }, String(v)), h("div", { class: "l" }, l));

  mount(main, content);
  draw();
  const offs = [on("members", draw), on("me", draw), on("presence", draw)];
  return () => offs.forEach(f => f());
}

function editMember(m) {
  const name = input({ value: m.name, maxlength: 40 });
  const motto = input({ value: m.motto, placeholder: "Dein Schlachtruf", maxlength: 80 });
  let color = m.color;
  const colors = h("div", { class: "colors" });
  const drawColors = () => mount(colors, COLORS.map(c => h("i", { class: c.toUpperCase() === color.toUpperCase() ? "on" : "", style: { background: c }, onClick: () => { color = c; drawColors(); } })));
  drawColors();
  modal({
    title: "Profil bearbeiten",
    body: h("div", {}, field("Name", name), field("Motto", motto), field("Farbe", colors)),
    buttons: [{ label: "Abbrechen" }, { label: "Speichern", class: "primary", onClick: async () => {
      if (!name.value.trim()) { toast("Name fehlt", "error"); return false; }
      await api.put(`/api/members/${m.id}`, { name: name.value.trim(), motto: motto.value.trim(), color });
      toast("Gespeichert", "success");
    } }],
  });
}
