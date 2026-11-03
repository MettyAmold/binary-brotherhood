// Steam-Suche mit manueller Korrekturmöglichkeit – genutzt von Spielen und Vorschlägen.
import { h, mount, field, input, textarea, toast } from "./ui.js";
import { api } from "./api.js";

/**
 * Baut ein Formular mit Name, Beschreibung, Steam-Link, Spieleranzahl und Bild.
 * Liefert { el, values() }.
 */
export function gameForm(initial = {}, { showPlayers = true } = {}) {
  const state = {
    name: initial.name || initial.title || "",
    description: initial.description || "",
    steamUrl: initial.steamUrl || "",
    steamAppId: initial.steamAppId || null,
    imageUrl: initial.imageUrl || "",
    players: initial.players || "",
  };

  const name = input({ value: state.name, placeholder: "z. B. Counter-Strike 2", maxlength: 120 });
  const desc = textarea({ value: state.description, placeholder: "Worum geht es? Warum sollten wir das spielen?", maxlength: 2000 });
  const url = input({ value: state.steamUrl, placeholder: "https://store.steampowered.com/app/…" });
  const players = input({ value: state.players, placeholder: "z. B. 2–10", maxlength: 40 });
  const image = input({ value: state.imageUrl, placeholder: "https://… (wird bei Steam automatisch gesetzt)" });
  const search = input({ placeholder: "Steam durchsuchen …", type: "search" });
  const results = h("div", { class: "steam-results hidden" });
  const picked = h("div", { class: "hidden" });
  const status = h("div", { class: "hint" }, "Bei Steam suchen oder selbst eintragen.");

  let timer = null;
  const doSearch = async () => {
    const q = search.value.trim();
    if (q.length < 2) { results.classList.add("hidden"); return; }
    status.textContent = "Suche bei Steam …";
    try {
      const list = await api.get(`/api/steam/search?q=${encodeURIComponent(q)}`, { silent: true });
      mount(results, list.length ? list.map(r => h("div", { class: "item", onClick: () => pick(r.appId) },
        h("img", { src: r.imageUrl, alt: "" }), h("div", { class: "grow ellipsis" }, r.name), r.price ? h("span", { class: "small muted nowrap" }, r.price) : null,
      )) : h("div", { class: "item muted" }, "Nichts gefunden"));
      results.classList.remove("hidden");
      status.textContent = `${list.length} Treffer`;
    } catch (e) {
      status.textContent = e.message || "Steam nicht erreichbar – bitte manuell eintragen.";
      results.classList.add("hidden");
    }
  };
  search.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(doSearch, 350); });
  search.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); clearTimeout(timer); doSearch(); } });

  const pick = async (appId) => {
    status.textContent = "Lade Details …";
    try {
      const d = await api.get(`/api/steam/app/${appId}`, { silent: true });
      if (!name.value.trim() || state.steamAppId) name.value = d.name;
      if (!desc.value.trim() || state.steamAppId) desc.value = d.description;
      url.value = d.steamUrl; image.value = d.imageUrl; state.steamAppId = d.appId;
      results.classList.add("hidden"); search.value = "";
      showPicked(d);
      status.textContent = "Übernommen – du kannst alles noch anpassen.";
    } catch (e) { status.textContent = e.message || "Details konnten nicht geladen werden"; }
  };

  const showPicked = (d) => {
    mount(picked, h("div", { class: "steam-picked" },
      d.imageUrl ? h("img", { src: d.imageUrl, alt: "" }) : null,
      h("div", { class: "grow" }, h("div", { class: "small muted" }, "Steam-App #" + d.appId), h("div", { class: "ellipsis" }, d.name)),
      h("button", { class: "btn sm ghost", onClick: () => { state.steamAppId = null; picked.classList.add("hidden"); } }, "Lösen"),
    ));
    picked.classList.remove("hidden");
  };
  if (state.steamAppId) showPicked({ appId: state.steamAppId, name: state.name, imageUrl: state.imageUrl });

  // Steam-Link einfügen → App-ID erkennen und Details holen
  url.addEventListener("change", async () => {
    const m = url.value.match(/\/app\/(\d+)/);
    if (m && Number(m[1]) !== state.steamAppId) { await pick(Number(m[1])); }
  });

  const el = h("div", {},
    field("Steam-Suche", search, null), results, status, h("div", { style: { height: "10px" } }), picked,
    field("Name *", name),
    field("Beschreibung", desc),
    field("Steam-Link", url),
    h("div", { class: "form-row" }, showPlayers ? field("Spieleranzahl", players) : h("div"), field("Bild-URL", image)),
  );

  return {
    el,
    values() {
      return {
        name: name.value.trim(), title: name.value.trim(), description: desc.value.trim(), steamUrl: url.value.trim(),
        steamAppId: state.steamAppId, imageUrl: image.value.trim(), players: players.value.trim(),
      };
    },
    validate() { if (!name.value.trim()) { toast("Bitte einen Namen eingeben", "error"); name.focus(); return false; } return true; },
  };
}
