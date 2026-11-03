// Discord: Chip im Header, Sprachkanäle, Einstellungen für Admins.
import { h, modal, toast, field, input, initials } from "./ui.js";
import { store } from "./store.js";
import { api } from "./api.js";

let discord = { invite: "", guildId: "" };
export async function loadDiscord() {
  try { discord = await api.get("/api/discord", { silent: true }); } catch { /* egal */ }
  const c = document.getElementById("discord-chip"); if (c) c.replaceWith(discordChip());
}
export function discordChip() {
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
        onlineList) : null,
      store.isAdmin ? h("p", { class: "small muted", style: { marginTop: "12px" } }, "Einstellungen: Profil-Menü → Discord-Server.") : null),
    buttons: [{ label: "Aktualisieren", onClick: () => { setTimeout(discordDialog, 50); } }, { label: "Schließen" }],
  });
}
export function discordSettingsDialog() {
  const invite = input({ value: discord.invite || "", placeholder: "https://discord.gg/abc123", autocapitalize: "off", spellcheck: false });
  const guild = input({ value: discord.guildId || "", placeholder: "z. B. 123456789012345678", inputmode: "numeric" });
  modal({
    title: "Discord-Server",
    body: h("div", {},
      field("Einladungslink", invite, "Unbegrenzt gültigen Link verwenden."),
      field("Server-ID (optional)", guild, "Für die Sprachkanal-Anzeige. In Discord das Server-Widget aktivieren.")),
    buttons: [{ label: "Abbrechen" }, { label: "Speichern", class: "primary", onClick: async () => {
      discord = { ...discord, ...(await api.put("/api/discord", { invite: invite.value.trim(), guildId: guild.value.trim() })) };
      toast("Discord gespeichert", "success"); loadDiscord();
    } }],
  });
}

