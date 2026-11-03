// Kleiner Fetch-Wrapper für die REST-API des Host-Handys.
import { toast } from "./ui.js";

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

function memberId() {
  try { return localStorage.getItem("bb.memberId") || ""; } catch { return ""; }
}

async function request(method, url, body, opts = {}) {
  const headers = { "X-Member-Id": memberId() };
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
    if (!opts.silent) toast(msg, "error");
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
