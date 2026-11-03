// Kleiner Fetch-Wrapper für die REST-API des Host-Handys. Schickt das Login-Token mit.
import { toast } from "./ui.js";

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

export function getToken() {
  try { return localStorage.getItem("bb.token") || ""; } catch { return ""; }
}
export function setToken(t) {
  try { t ? localStorage.setItem("bb.token", t) : localStorage.removeItem("bb.token"); } catch { /* privater Modus */ }
}

export function authHeaders() {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
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
    throw new ApiError("Keine Verbindung zum Host-Handy", 0);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = (data && data.error) || `Fehler ${res.status}`;
    if (res.status === 401 && !opts.noAuthRedirect) {
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
