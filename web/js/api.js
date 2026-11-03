// Kleiner Fetch-Wrapper für die REST-API. Schickt Realm und Login-Token mit.
import { toast } from "./ui.js";

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

// ---------- Realm: jede Gruppe hat ihre eigene Datenbank, gewählt beim Login ----------
let realm = (() => {
  const fromUrl = new URLSearchParams(location.search).get("realm");
  if (fromUrl) return fromUrl.toLowerCase();
  try { return localStorage.getItem("bb.realm") || ""; } catch { return ""; }
})();

/** Slug des gewählten Realms ("" = noch keiner gewählt). */
export function currentRealm() { return realm; }
export function setRealm(slug) {
  realm = slug || "";
  try { localStorage.setItem("bb.realm", realm); } catch { /* privat */ }
  syncRealmCookie();
}
/** Bilder, Audio und Medien laden ohne eigene Header – dafür zeigt ein Cookie dem Server den Realm. */
function syncRealmCookie() {
  document.cookie = realm ? `bb_realm=${encodeURIComponent(realm)}; path=/; max-age=31536000; SameSite=Lax` : "bb_realm=; path=/; max-age=0";
}
syncRealmCookie();
// Mehrere Tabs mit verschiedenen Realms: beim Zurückkehren den eigenen wieder setzen
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") syncRealmCookie(); });

/** Login-Token des Kontos (gilt für alle Realms). */
export function getToken() {
  try { return localStorage.getItem("bb.token") || ""; } catch { return ""; }
}
export function setToken(t) {
  try { t ? localStorage.setItem("bb.token", t) : localStorage.removeItem("bb.token"); } catch { /* privater Modus */ }
}

export function authHeaders() {
  const t = getToken();
  const hd = realm ? { "X-Realm": realm } : {};
  return t ? { ...hd, Authorization: `Bearer ${t}` } : hd;
}

async function request(method, url, body, opts = {}) {
  const headers = authHeaders();
  let payload = body;
  if (body !== undefined && !(body instanceof Blob) && !(body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(url, { method, headers, body: payload });
  } catch (e) {
    throw new ApiError("Keine Verbindung zum Server", 0);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = (data && data.error) || `Fehler ${res.status}`;
    if (res.status === 404 && data && data.realmMissing) {
      window.dispatchEvent(new CustomEvent("bb:realm-missing"));
    } else if (res.status === 401 && !opts.noAuthRedirect) {
      // Token ungültig oder abgelaufen → zurück zum Login
      window.dispatchEvent(new CustomEvent("bb:unauthorized"));
    } else if (!opts.silent) {
      toast(msg, "error");
    }
    throw new ApiError(msg, res.status);
  }
  return data;
}

export const api = {
  get: (url, opts) => request("GET", url, undefined, opts),
  post: (url, body, opts) => request("POST", url, body ?? {}, opts),
  put: (url, body, opts) => request("PUT", url, body ?? {}, opts),
  del: (url, opts) => request("DELETE", url, undefined, opts),
};
