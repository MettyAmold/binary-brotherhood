// Globaler Zustand: aktuelles Mitglied, Mitgliederliste, LAN-Ausgabe, Live-Verbindung.
import { api, getToken, setToken, currentRealm } from "./api.js";
import { setSoundUrls } from "./notify.js";
import { setAvatarUrls } from "./ui.js";

const listeners = new Map(); // topic -> Set<fn>

export const store = {
  me: null,
  isHost: false,
  isAdmin: false,
  /** "cloud" (Cloudflare) oder "lan" (Host-Handy) – steuert z. B. den Freigaben-Assistenten */
  mode: "lan",
  members: [],
  event: null,
  events: [],
  connected: false,
  /** Mitglieder mit offener Live-Verbindung: [{ id, name }] */
  online: [],
  appName: "BINARY BROTHERHOOD",
  /** Gewählter Realm: { slug, name, kind: "lan" | "online" } */
  realm: null,
  /** LAN-Funktionen (LAN-Party, Anwesenheit, Kosten, Ausrüstung, Freigaben) nur in LAN-Realms */
  get lan() { return !this.realm || this.realm.kind !== "online"; },
  isOnline(id) { return this.online.some(o => o.id === Number(id)); },

  member(id) { return this.members.find(m => m.id === Number(id)) || null; },

  /** Heutiger LAN-Tag (1-basiert) der aktuellen Ausgabe oder null, wenn heute kein LAN-Tag ist. */
  currentDay() {
    if (!this.lan) return null;
    const ev = this.event;
    if (!ev || !ev.startDate) return null;
    const start = new Date(ev.startDate + "T00:00:00");
    if (isNaN(start)) return null;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const day = Math.round((today - start) / 86400000) + 1;
    return day >= 1 && day <= ev.days ? day : null;
  },

  /** Prüft das gespeicherte Token. Liefert true, wenn eine gültige Sitzung besteht. */
  async loadSession() {
    if (!getToken()) { this.me = null; return false; }
    try {
      const s = await api.get("/api/auth/me", { silent: true, noAuthRedirect: true });
      this.me = s.member; this.isHost = !!s.isHost; this.isAdmin = !!(s.isAdmin ?? s.isHost);
      return true;
    } catch (e) {
      if (e.status === 401 || e.status === 403) { setToken(null); this.me = null; return false; }
      throw e; // Host nicht erreichbar
    }
  },

  applyAuth(resp) {
    setToken(resp.token);
    this.me = resp.member; this.isHost = !!resp.isHost; this.isAdmin = !!(resp.isAdmin ?? resp.isHost);
    emit("me");
  },

  async loadMode() {
    try { const h = await api.get("/api/host", { silent: true, noAuthRedirect: true }); this.mode = h.mode === "cloud" ? "cloud" : "lan"; } catch { this.mode = "lan"; }
  },

  async logout() {
    try { await api.post("/api/auth/logout", {}, { silent: true, noAuthRedirect: true }); } catch { /* egal */ }
    setToken(null);
    this.me = null; this.isHost = false; this.isAdmin = false;
    emit("me");
  },

  async refreshSounds() {
    try { setSoundUrls(await api.get("/api/sounds", { silent: true })); } catch { /* keine eigenen Klänge */ }
  },

  async bootstrap() {
    const b = await api.get("/api/bootstrap");
    this.refreshSounds();
    this.members = b.members; setAvatarUrls(b.members);
    this.event = b.event;
    this.events = b.events;
    this.appName = b.appName;
    if (b.realm) this.realm = b.realm;
    if (this.me) this.me = this.member(this.me.id) || this.me;
    emit("members"); emit("events");
  },

  async refreshMembers() {
    this.members = await api.get("/api/members"); setAvatarUrls(this.members);
    if (this.me) this.me = this.member(this.me.id) || this.me;
    emit("members");
  },

  async refreshEvents() {
    const b = await api.get("/api/bootstrap");
    this.events = b.events; this.event = b.event;
    if (b.realm) { this.realm = b.realm; this.appName = b.realm.name; }
    emit("events");
  },
};

export function on(topic, fn) {
  if (!listeners.has(topic)) listeners.set(topic, new Set());
  listeners.get(topic).add(fn);
  return () => listeners.get(topic).delete(fn);
}

export function emit(topic, payload) {
  (listeners.get(topic) || []).forEach(fn => { try { fn(payload); } catch (e) { console.error(e); } });
  (listeners.get("*") || []).forEach(fn => { try { fn(topic, payload); } catch (e) { console.error(e); } });
}

// ---------- WebSocket mit automatischem Reconnect, Polling als Fallback ----------
let ws = null, retry = 1000, pingTimer = null, failures = 0, pollTimer = null, pollSince = Date.now();

/** Ohne WebSocket alle 20 s beim Server nachfragen, welche Themen sich geändert haben. */
function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    if (ws && ws.readyState === WebSocket.OPEN) return;
    try {
      const r = await api.get(`/api/changes?since=${pollSince}`, { silent: true, noAuthRedirect: true });
      pollSince = r.now;
      for (const ch of r.changes) {
        if (ch.topic === "members") store.refreshMembers().catch(() => {});
        else if (ch.topic === "events" || ch.topic === "realm") store.refreshEvents().catch(() => {});
        else if (ch.topic === "sounds") store.refreshSounds();
        emit(ch.topic);
      }
    } catch { /* nächster Versuch */ }
  }, 20000);
}

export function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const tok = getToken();
  try { ws = new WebSocket(`${proto}://${location.host}/ws?realm=${encodeURIComponent(currentRealm())}${tok ? `&token=${encodeURIComponent(tok)}` : ""}`); } catch { scheduleReconnect(); return; }
  ws.onopen = () => {
    const wasOffline = !store.connected;
    store.connected = true; retry = 1000; failures = 0; emit("connection", true);
    clearInterval(pingTimer);
    pingTimer = setInterval(() => { try { ws.send("ping"); } catch { /* ignore */ } }, 25000);
    if (wasOffline) {
      // Nach Wiederverbindung alles neu laden
      store.refreshMembers().catch(() => {});
      ["games", "sessions", "suggestions", "forum", "costs", "equipment", "poll", "events"].forEach(t => emit(t));
    }
  };
  ws.onmessage = (ev) => {
    let msg; try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type === "presence") { store.online = msg.members || []; emit("presence", store.online); return; }
    if (msg.type === "change") {
      if (msg.topic === "realm" && msg.payload) { store.realm = msg.payload; store.appName = msg.payload.name; }
      if (msg.topic === "members") store.refreshMembers().catch(() => {});
      else if (msg.topic === "events") store.refreshEvents().catch(() => {});
      else if (msg.topic === "sounds") store.refreshSounds();
      emit(msg.topic, msg.payload);
    }
  };
  ws.onclose = () => { store.connected = false; store.online = []; emit("connection", false); emit("presence", []); clearInterval(pingTimer); scheduleReconnect(); };
  ws.onerror = () => { try { ws.close(); } catch { /* ignore */ } };
}

function scheduleReconnect() {
  failures++;
  if (failures >= 2) startPolling();
  setTimeout(connect, retry);
  retry = Math.min(retry * 1.6, 30000);
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && (!ws || ws.readyState !== WebSocket.OPEN)) connect();
});
