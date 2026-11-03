// Hinweise an alle angemeldeten Browser: Banner am Bildschirmrand, Klang (WebAudio-Synthese, später
// durch Audiodateien ersetzbar) und optional System-Benachrichtigung, wenn der Tab im Hintergrund ist.
import { h } from "./ui.js";

/** Eigene Audiodateien eintragen (z. B. "/sounds/spin.mp3"); null = synthetischer Glockenklang. */
export const SOUNDS = { spin: null, winner: null };

let audioCtx = null;
let unlocked = false;

/** Browser erlauben Ton erst nach einer Nutzeraktion – beim ersten Klick/Tipp den AudioContext freischalten. */
export function initAudio() {
  const unlock = () => {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") audioCtx.resume();
      unlocked = true;
    } catch { /* kein WebAudio */ }
  };
  ["pointerdown", "keydown", "touchstart"].forEach(ev => document.addEventListener(ev, unlock, { passive: true }));
}

/** Eine Glocke: Grundton plus Obertöne mit exponentiellem Ausklingen. */
function bell(freq, at, dur = 1.2, gain = 0.25) {
  const ctx = audioCtx;
  const master = ctx.createGain();
  master.gain.setValueAtTime(0.0001, at);
  master.gain.exponentialRampToValueAtTime(gain, at + 0.01);
  master.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  master.connect(ctx.destination);
  for (const [mult, g] of [[1, 1], [2.0, 0.35], [2.98, 0.2], [4.2, 0.1]]) {
    const o = ctx.createOscillator();
    const og = ctx.createGain();
    o.type = "sine"; o.frequency.value = freq * mult; og.gain.value = g;
    o.connect(og); og.connect(master);
    o.start(at); o.stop(at + dur + 0.05);
  }
}

export function playSound(kind) {
  const url = SOUNDS[kind];
  if (url) { try { const a = new Audio(url); a.volume = 0.8; a.play().catch(() => {}); } catch { /* ignorieren */ } return; }
  if (!audioCtx || !unlocked) return; // noch keine Nutzeraktion → Browser würde den Ton blockieren
  const t = audioCtx.currentTime + 0.02;
  if (kind === "winner") { bell(659, t, 1.0); bell(784, t + 0.18, 1.0); bell(1047, t + 0.36, 1.8, 0.3); } // Fanfare E-G-C
  else { bell(880, t, 1.4); bell(1175, t + 0.35, 1.6); }                                                   // Bimmeln A-D
}

let box = null;
/** Banner am rechten Rand (Handy: oben). Gibt { update, close } zurück. */
export function banner({ icon = "🔔", title, text, href, ms = 12000, kind = "" }) {
  if (!box) { box = h("div", { class: "banners" }); document.body.append(box); }
  const titleEl = h("div", { class: "b-title" }, title);
  const textEl = h("div", { class: "b-text" }, text || "");
  const el = h("div", { class: `banner ${kind}`, role: "status" },
    h("div", { class: "b-icon" }, icon),
    h("div", { class: "grow" }, titleEl, textEl, href ? h("a", { class: "b-link", href }, "Ansehen →") : null),
    h("button", { class: "b-close", "aria-label": "Schließen", onClick: () => close() }, "✕"),
  );
  let timer = setTimeout(() => close(), ms);
  const close = () => { clearTimeout(timer); el.style.opacity = "0"; el.style.transform = "translateX(20px)"; setTimeout(() => el.remove(), 250); };
  const update = (p) => {
    if (p.icon) el.querySelector(".b-icon").textContent = p.icon;
    if (p.title) titleEl.textContent = p.title;
    if (p.text !== undefined) textEl.textContent = p.text;
    if (p.kind !== undefined) el.className = `banner ${p.kind}`;
    clearTimeout(timer); timer = setTimeout(() => close(), p.ms ?? ms);
  };
  box.prepend(el);
  return { update, close };
}

/** System-Benachrichtigung, falls erlaubt und der Tab nicht sichtbar ist. */
export function systemNotify(title, body) {
  try {
    if (!("Notification" in window) || Notification.permission !== "granted" || document.visibilityState === "visible") return;
    const n = new Notification(title, { body, icon: "/favicon.png", tag: "bb-wheel" });
    n.onclick = () => { window.focus(); location.hash = "#/wheel"; n.close(); };
  } catch { /* z. B. WebView ohne Notification-API */ }
}

export async function requestNotificationPermission() {
  if (!("Notification" in window)) return "unsupported";
  if (Notification.permission === "granted") return "granted";
  try { return await Notification.requestPermission(); } catch { return "denied"; }
}
