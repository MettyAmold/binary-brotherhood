// Globaler Zustand: aktuelles Mitglied, Mitgliederliste, LAN-Ausgabe, Live-Verbindung.
import { api, getToken, setToken } from "./api.js";

const listeners = new Map(); // topic -> Set<fn>

export const store = {
  me: null,
  isHost: false,
  members: [],
  event: null,
  events: [],
  connected: false,
  appName: "BINARY BROTHERHOOD",

  member(id) { return this.members.find(m => m.id === Number(id)) || null; },

  /** Prüft das gespeicherte Token. Liefert true, wenn eine gültige Sitzung besteht. */
  async loadSession() {
    if (!getToken()) { this.me = null; return false; }
    try {
      const s = await api.get("/api/auth/me", { silent: true, noAuthRedirect: true });
      this.me = s.member; this.isHost = !!s.isHost;
      return true;
    } catch (e) {
      if (e.status === 401 || e.status === 403) { setToken(null); this.me = null; return false; }
      throw e; // Host nicht erreichbar
    }
  },

  applyAuth(resp) {
    setToken(resp.token);
    this.me = resp.member; this.isHost = !!resp.isHost;
    emit("me");
  },

  async logout() {
    try { await api.post("/api/auth/logout", {}, { silent: true, noAuthRedirect: true }); } catch { /* egal */ }
    setToken(null);
    this.me = null; this.isHost = false;
    emit("me");
  },

  async bootstrap() {
    const b = await api.get("/api/bootstrap");
    this.members = b.members;
    this.event = b.event;
    this.events = b.events;
    this.appName = b.appName;
    if (this.me) this.me = this.member(this.me.id) || this.me;
    emit("members"); emit("events");
  },

  async refreshMembers() {
    this.members = await api.get("/api/members");
    if (this.me) this.me = this.member(this.me.id) || this.me;
    emit("members");
  },

  async refreshEvents() {
    const b = await api.get("/api/bootstrap");
    this.events = b.events; this.event = b.event;
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

// ---------- WebSocket mit automatischem Reconnect ----------
let ws = null, retry = 1000, pingTimer = null;

export function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  try { ws = new WebSocket(`${proto}://${location.host}/ws`); } catch { scheduleReconnect(); return; }
  ws.onopen = () => {
    const wasOffline = !store.connected;
    store.connected = true; retry = 1000; emit("connection", true);
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
    if (msg.type === "change") {
      if (msg.topic === "members") store.refreshMembers().catch(() => {});
      else if (msg.topic === "events") store.refreshEvents().catch(() => {});
      emit(msg.topic, msg.payload);
    }
  };
  ws.onclose = () => { store.connected = false; emit("connection", false); clearInterval(pingTimer); scheduleReconnect(); };
  ws.onerror = () => { try { ws.close(); } catch { /* ignore */ } };
}

function scheduleReconnect() {
  setTimeout(connect, retry);
  retry = Math.min(retry * 1.6, 10000);
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && (!ws || ws.readyState !== WebSocket.OPEN)) connect();
});
