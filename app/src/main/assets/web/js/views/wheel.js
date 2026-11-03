// Glücksrad: echtes Rad mit Segmenten, Beschleunigung/Abbremsen, synchron auf allen Geräten.
// Alternative: Abstimmung.
import { h, mount, empty, toast, checkbox, confetti, avatar, confirmDialog } from "../ui.js";
import { api } from "../api.js";
import { store, on } from "../store.js";
import { startSession } from "./games.js";
import { requireMe } from "../app.js";

const PALETTE = [
  { bg: "#c9a24d", fg: "#1a1407" }, { bg: "#1c2534", fg: "#f1e7cf" }, { bg: "#8c2f39", fg: "#ffe9e9" },
  { bg: "#1f6f6b", fg: "#e6fffb" }, { bg: "#5b3a7a", fg: "#f3e8ff" }, { bg: "#2c4f7c", fg: "#e8f2ff" },
  { bg: "#6e4a2a", fg: "#fff1e3" }, { bg: "#3f6b2e", fg: "#eaffe3" }, { bg: "#a35a1f", fg: "#fff3e6" },
  { bg: "#23383f", fg: "#e3f6fb" },
];

let mode = "wheel";
let opts = { excludePlayed: false, onlySelected: true };

export async function renderWheel(main) {
  let games = [];
  let lastSpinId = null;
  let animating = false;

  // ---- Elemente
  const canvas = h("canvas");
  const pointer = h("div", { class: "pointer" });
  const hub = h("div", { class: "hub", title: "Drehen!" }, h("img", { src: "/logo.png", alt: "" }));
  const stage = h("div", { class: "wheel-stage" }, h("div", { class: "glow" }), canvas, pointer, hub);
  const side = h("div", { class: "stack" });
  const winnerBox = h("div");
  const modeSeg = h("div", { class: "seg" },
    h("button", { class: mode === "wheel" ? "active" : "", onClick: () => { mode = "wheel"; drawMode(); } }, "🎡 Glücksrad"),
    h("button", { class: mode === "vote" ? "active" : "", onClick: () => { mode = "vote"; drawMode(); } }, "🗳 Abstimmung"),
  );
  const content = h("div");

  const wheel = createWheel(canvas, pointer, stage);

  // ---- Kandidaten
  const candidates = () => {
    let list = games;
    if (opts.excludePlayed) list = list.filter(g => !g.playedThisEvent);
    if (opts.onlySelected && list.some(g => g.selectedForNext)) list = list.filter(g => g.selectedForNext);
    return list;
  };

  const drawSide = () => {
    const list = candidates();
    const anySelected = games.some(g => g.selectedForNext);
    mount(side,
      h("div", { class: "card" },
        h("h3", {}, "Spiele im Rad ", h("span", { class: "chip gold" }, String(list.length))),
        h("div", { class: "stack", style: { marginTop: "8px" } },
          checkbox("Bereits gespielte Spiele ausschließen", { checked: opts.excludePlayed, onChange: (e) => { opts.excludePlayed = e.target.checked; refreshWheel(); } }),
          checkbox(`Nur für die nächste Runde markierte Spiele${anySelected ? "" : " (keine markiert → alle)"}`, { checked: opts.onlySelected, onChange: (e) => { opts.onlySelected = e.target.checked; refreshWheel(); } }),
        ),
        h("div", { class: "wheel-list", style: { marginTop: "10px" } }, list.length ? list.map((g, i) => h("div", { class: `it ${wheel.winnerId === g.id ? "winner" : ""}` },
          h("span", { class: "sw", style: { background: PALETTE[i % PALETTE.length].bg } }), h("span", { class: "grow ellipsis" }, g.name),
          g.playedThisEvent ? h("span", { class: "chip green", title: "diese LAN schon gespielt" }, "✓") : null,
        )) : h("div", { class: "muted small" }, "Keine Spiele – füge welche hinzu oder ändere die Filter.")),
      ),
      winnerBox,
    );
  };

  const refreshWheel = () => {
    if (animating) return;
    wheel.setSegments(candidates().map((g, i) => ({ id: g.id, label: g.name, ...PALETTE[i % PALETTE.length] })));
    drawSide();
  };

  const showWinner = (game, fromSpin) => {
    mount(winnerBox, h("div", { class: "card gold winner-card" },
      h("div", { class: "small muted", style: { letterSpacing: ".2em", textTransform: "uppercase" } }, fromSpin ? "Das Rad hat entschieden" : "Gewinner"),
      h("div", { class: "name" }, game.name),
      game.imageUrl ? h("div", { class: "cover", style: { backgroundImage: `url("${game.imageUrl}")` } }) : null,
      game.description ? h("p", { class: "small clamp-3", style: { color: "var(--text-2)" } }, game.description) : null,
      h("div", { class: "row wrap", style: { justifyContent: "center", marginTop: "8px" } },
        h("button", { class: "btn primary lg", onClick: () => startSession(game, "wheel") }, "▶ Spiel starten"),
        h("button", { class: "btn", onClick: spin }, "↻ Nochmal drehen"),
      ),
    ));
  };

  // ---- Drehen
  const spin = async () => {
    if (animating) return;
    if (!candidates().length) { toast("Keine Spiele im Rad", "error"); return; }
    try {
      const s = await api.post("/api/wheel/spin", opts);
      await runSpin(s);
    } catch { /* bereits gemeldet */ }
  };

  const runSpin = async (s) => {
    if (!s || s.spinId === lastSpinId) return;
    lastSpinId = s.spinId;
    // Fremde Spins: Segmente exakt wie beim Auslöser
    const byId = new Map(games.map(g => [g.id, g]));
    if (s.gameIds.some(id => !byId.has(id))) { games = await api.get("/api/games"); games.forEach(g => byId.set(g.id, g)); }
    const segs = s.gameIds.filter(id => byId.has(id)).map((id, i) => ({ id, label: byId.get(id).name, ...PALETTE[i % PALETTE.length] }));
    if (!segs.length) return;
    animating = true;
    mount(winnerBox);
    wheel.setSegments(segs);
    drawSide();
    const elapsed = Date.now() - s.startedAt;
    await wheel.spinTo(s.winnerGameId, s.durationMs, s.turns, s.spinId, Math.max(0, Math.min(elapsed, s.durationMs - 200)));
    animating = false;
    const game = byId.get(s.winnerGameId);
    if (game) { showWinner(game, true); confetti(); }
    drawSide();
  };

  hub.addEventListener("click", spin);

  // ---- Modus
  const drawMode = () => {
    modeSeg.querySelectorAll("button").forEach((b, i) => b.classList.toggle("active", (i === 0) === (mode === "wheel")));
    if (mode === "wheel") {
      mount(content, h("div", { class: "wheel-wrap" },
        h("div", {}, stage,
          h("div", { class: "row", style: { justifyContent: "center", marginTop: "14px" } },
            h("button", { class: "btn primary lg", onClick: spin }, "🎡 Rad drehen")),
          h("p", { class: "small muted", style: { textAlign: "center", marginTop: "8px" } }, "Alle Geräte sehen dieselbe Drehung live.")),
        side,
      ));
      requestAnimationFrame(() => { wheel.resize(); refreshWheel(); });
    } else {
      mount(content, h("div", { id: "poll" }));
      drawPoll();
    }
  };

  // ---- Abstimmung
  let poll = null;
  const loadPoll = async () => { poll = await api.get("/api/polls/current"); if (mode === "vote") drawPoll(); };
  const drawPoll = () => {
    const box = content.querySelector("#poll"); if (!box) return;
    const list = candidates();
    const byId = new Map(games.map(g => [g.id, g]));
    if (!poll || !poll.open) {
      const result = poll && poll.winnerGameId && byId.get(poll.winnerGameId);
      mount(box,
        result ? h("div", { class: "card gold winner-card" },
          h("div", { class: "small muted", style: { letterSpacing: ".2em", textTransform: "uppercase" } }, "Ergebnis der letzten Abstimmung"),
          h("div", { class: "name" }, result.name),
          result.imageUrl ? h("div", { class: "cover", style: { backgroundImage: `url("${result.imageUrl}")` } }) : null,
          tally(poll, byId, true),
          h("div", { class: "row wrap", style: { justifyContent: "center", marginTop: "8px" } },
            h("button", { class: "btn primary lg", onClick: () => startSession(result, "vote") }, "▶ Spiel starten")),
        ) : null,
        h("div", { class: "card", style: { marginTop: "12px" } },
          h("h3", {}, "Neue Abstimmung"),
          h("p", { class: "muted small" }, `Alle stimmen über ${list.length} Spiele ab (gleiche Filter wie beim Rad). Bei Gleichstand entscheidet das Los.`),
          h("button", { class: "btn primary", onClick: async () => { await requireMe(); await api.post("/api/polls"); } }, "🗳 Abstimmung starten"),
        ),
      );
      return;
    }
    const myVote = store.me ? poll.votes.find(v => v.memberId === store.me.id) : null;
    mount(box,
      h("div", { class: "card gold" },
        h("div", { class: "row between wrap" }, h("h3", {}, "Abstimmung läuft ", h("span", { class: "chip green live" }, `${poll.votes.length} Stimmen`)),
          h("button", { class: "btn sm danger", onClick: async () => { if (await confirmDialog("Abstimmung beenden?", "Das Spiel mit den meisten Stimmen gewinnt.", { okLabel: "Beenden", danger: false })) await api.post(`/api/polls/${poll.id}/close`); } }, "Beenden")),
        h("p", { class: "muted small" }, myVote ? `Deine Stimme: ${byId.get(myVote.gameId)?.name ?? "?"} – du kannst sie noch ändern.` : "Tippe auf ein Spiel, um abzustimmen."),
        h("div", { class: "grid tight" }, list.map(g => h("button", { class: `btn ${myVote && myVote.gameId === g.id ? "active" : ""}`, style: { justifyContent: "flex-start", textAlign: "left", whiteSpace: "normal" }, onClick: async () => {
          const me = await requireMe(); if (!me) return;
          await api.post(`/api/polls/${poll.id}/vote`, { gameId: g.id });
        } }, g.name))),
      ),
      h("div", { class: "card", style: { marginTop: "12px" } }, h("h3", {}, "Zwischenstand"), tally(poll, byId, false)),
    );
  };

  const tally = (p, byId, final) => {
    const counts = new Map();
    p.votes.forEach(v => counts.set(v.gameId, (counts.get(v.gameId) || 0) + 1));
    const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const max = Math.max(1, ...rows.map(r => r[1]));
    if (!rows.length) return h("div", { class: "muted small", style: { marginTop: "8px" } }, "Noch keine Stimmen.");
    return h("div", { class: "stack", style: { marginTop: "10px", textAlign: "left" } }, rows.map(([gid, n]) => h("div", { class: `poll-bar ${final && p.winnerGameId === gid ? "winner" : ""}` },
      h("div", { class: "bar" }, h("i", { style: { width: `${(n / max) * 100}%` } }), h("span", {}, byId.get(gid)?.name ?? "?")),
      h("div", { class: "avatar-stack" }, p.votes.filter(v => v.gameId === gid).map(v => avatar(store.member(v.memberId) || { name: v.memberName }, "xs"))),
      h("strong", { class: "nowrap" }, `${n}`),
    )));
  };

  // ---- Aufbau
  mount(main, h("div", { class: "page-head" }, h("h2", {}, "Spielrad"), modeSeg), content);
  games = await api.get("/api/games");
  drawMode();
  loadPoll();
  // Verspätet eingestiegene Clients sehen den letzten Spin (fertig)
  api.get("/api/wheel/state", { silent: true }).then(s => {
    if (s && mode === "wheel") { lastSpinId = s.spinId; const g = games.find(x => x.id === s.winnerGameId); if (g) { wheel.setSegments(s.gameIds.filter(id => games.some(x => x.id === id)).map((id, i) => ({ id, label: games.find(x => x.id === id).name, ...PALETTE[i % PALETTE.length] }))); wheel.jumpTo(s.winnerGameId, s.spinId); showWinner(g, false); drawSide(); } }
  }).catch(() => {});

  const onResize = () => { if (mode === "wheel") wheel.resize(); };
  window.addEventListener("resize", onResize);
  const offs = [
    on("games", async () => { games = await api.get("/api/games"); if (mode === "wheel") refreshWheel(); else drawPoll(); }),
    on("sessions", async () => { games = await api.get("/api/games"); if (mode === "wheel") refreshWheel(); }),
    on("wheel", (payload) => { if (payload) { if (mode !== "wheel") { mode = "wheel"; drawMode(); } runSpin(payload); } }),
    on("poll", loadPoll),
    on("members", () => { if (mode === "vote") drawPoll(); }),
  ];
  return () => { offs.forEach(f => f()); window.removeEventListener("resize", onResize); wheel.destroy(); };
}

// ------------------------------------------------------------------ Rad-Engine
function createWheel(canvas, pointer, stage) {
  const ctx = canvas.getContext("2d");
  let segments = [];
  let rotation = 0;         // aktuelle Drehung in rad
  let winnerId = null;
  let raf = null;
  let size = 0;
  let audio = null;

  const seg = () => (2 * Math.PI) / Math.max(1, segments.length);

  function resize() {
    const rect = stage.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    size = Math.max(200, Math.floor(rect.width));
    canvas.width = size * dpr; canvas.height = size * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  function draw() {
    if (!size) return;
    const r = size / 2;
    ctx.clearRect(0, 0, size, size);
    const n = segments.length;
    // Grundplatte
    ctx.save();
    ctx.translate(r, r);
    const outer = r - 6;
    if (!n) {
      ctx.beginPath(); ctx.arc(0, 0, outer, 0, Math.PI * 2); ctx.fillStyle = "#181d27"; ctx.fill();
      ctx.fillStyle = "#8e97a8"; ctx.font = "600 16px system-ui"; ctx.textAlign = "center"; ctx.fillText("Keine Spiele im Rad", 0, 6);
      ctx.restore(); return;
    }
    const a = seg();
    ctx.rotate(rotation);
    for (let i = 0; i < n; i++) {
      const s = segments[i];
      const start = i * a, end = start + a;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, outer, start, end); ctx.closePath();
      const grad = ctx.createRadialGradient(0, 0, outer * 0.2, 0, 0, outer);
      grad.addColorStop(0, shade(s.bg, 1.18)); grad.addColorStop(1, shade(s.bg, 0.78));
      ctx.fillStyle = grad; ctx.fill();
      if (winnerId === s.id) {
        ctx.save(); ctx.fillStyle = "rgba(255, 230, 150, .28)"; ctx.fill(); ctx.restore();
      }
      ctx.strokeStyle = "rgba(0,0,0,.45)"; ctx.lineWidth = 1.5; ctx.stroke();
      // Beschriftung
      ctx.save();
      ctx.rotate(start + a / 2);
      ctx.textAlign = "right"; ctx.textBaseline = "middle";
      const fontSize = Math.max(10, Math.min(19, (outer * 0.1) * Math.min(1, 10 / n + 0.35)));
      ctx.font = `700 ${fontSize}px system-ui, sans-serif`;
      ctx.fillStyle = s.fg;
      ctx.shadowColor = "rgba(0,0,0,.5)"; ctx.shadowBlur = 3;
      const maxW = outer * 0.64; // vom Rand (0.93) bis knapp außerhalb der Nabe (0.29)
      ctx.fillText(fit(ctx, s.label, maxW), outer * 0.93, 0);
      ctx.restore();
    }
    ctx.restore();
    // Rand aus Gold mit Lichtern
    ctx.save(); ctx.translate(r, r);
    ctx.beginPath(); ctx.arc(0, 0, outer, 0, Math.PI * 2);
    ctx.lineWidth = 9; ctx.strokeStyle = "#8f6f2a"; ctx.stroke();
    ctx.lineWidth = 4; ctx.strokeStyle = "#c9a24d"; ctx.stroke();
    const lights = Math.max(12, n * 2);
    for (let i = 0; i < lights; i++) {
      const ang = (i / lights) * Math.PI * 2 + rotation;
      ctx.beginPath(); ctx.arc(Math.cos(ang) * outer, Math.sin(ang) * outer, 3, 0, Math.PI * 2);
      ctx.fillStyle = i % 2 ? "#e8d9a8" : "#5b4a1e"; ctx.fill();
    }
    // Innenschatten
    const inner = ctx.createRadialGradient(0, 0, outer * 0.75, 0, 0, outer);
    inner.addColorStop(0, "rgba(0,0,0,0)"); inner.addColorStop(1, "rgba(0,0,0,.35)");
    ctx.beginPath(); ctx.arc(0, 0, outer, 0, Math.PI * 2); ctx.fillStyle = inner; ctx.fill();
    ctx.restore();
  }

  function fit(c, text, maxW) {
    if (c.measureText(text).width <= maxW) return text;
    let t = text;
    while (t.length > 1 && c.measureText(t + "…").width > maxW) t = t.slice(0, -1);
    return t + "…";
  }

  function segmentAtPointer(rot) {
    // Zeiger oben = Winkel -π/2 im Canvas-System
    const a = seg();
    let ang = (-Math.PI / 2 - rot) % (2 * Math.PI);
    if (ang < 0) ang += 2 * Math.PI;
    return Math.floor(ang / a) % segments.length;
  }

  function targetRotation(winnerIdx, seedNum) {
    const a = seg();
    const jitter = (pseudoRandom(seedNum) - 0.5) * a * 0.8; // bleibt sicher innerhalb des Segments
    return -Math.PI / 2 - (winnerIdx + 0.5) * a + jitter;
  }

  function easing(t) {
    // Beschleunigen (quadratisch) bis t=0.2, dann sanft ausrollen (quartisch) – stetig in Wert und Geschwindigkeit
    const A = 0.2, N = 4;
    const c = 1 / (A * A + 2 * A * (1 - A) / N);
    const d = 2 * c * A / (N * Math.pow(1 - A, N - 1));
    return t < A ? c * t * t : 1 - d * Math.pow(1 - t, N);
  }

  function tick() {
    pointer.classList.remove("tick"); void pointer.offsetWidth; pointer.classList.add("tick");
    try {
      if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === "suspended") audio.resume();
      const o = audio.createOscillator(), g = audio.createGain();
      o.type = "square"; o.frequency.value = 1400 + Math.random() * 200;
      g.gain.setValueAtTime(0.045, audio.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.035);
      o.connect(g); g.connect(audio.destination); o.start(); o.stop(audio.currentTime + 0.04);
    } catch { /* kein Ton verfügbar */ }
  }

  function spinTo(gameId, durationMs, turns, seedNum, alreadyElapsed = 0) {
    return new Promise((resolve) => {
      const idx = segments.findIndex(s => s.id === gameId);
      if (idx < 0) { resolve(); return; }
      cancelAnimationFrame(raf);
      winnerId = null; stage.classList.remove("won"); stage.classList.add("spinning");
      const start = ((rotation % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      rotation = start;
      const target = targetRotation(idx, seedNum);
      // Vorwärts (im Uhrzeigersinn, positive Rotation) mehrere volle Umdrehungen
      let delta = ((target - start) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
      delta += Math.round(turns) * 2 * Math.PI;
      const t0 = performance.now() - alreadyElapsed;
      let lastSeg = segmentAtPointer(rotation);
      const frame = (now) => {
        const t = Math.min(1, (now - t0) / durationMs);
        rotation = start + delta * easing(t);
        const cur = segmentAtPointer(rotation);
        if (cur !== lastSeg) { lastSeg = cur; tick(); }
        draw();
        if (t < 1) raf = requestAnimationFrame(frame);
        else { winnerId = gameId; stage.classList.remove("spinning"); stage.classList.add("won"); draw(); resolve(); }
      };
      raf = requestAnimationFrame(frame);
    });
  }

  function jumpTo(gameId, seedNum) {
    const idx = segments.findIndex(s => s.id === gameId);
    if (idx < 0) return;
    rotation = targetRotation(idx, seedNum);
    winnerId = gameId; stage.classList.add("won"); draw();
  }

  return {
    get winnerId() { return winnerId; },
    setSegments(list) {
      const same = list.length === segments.length && list.every((s, i) => s.id === segments[i].id);
      segments = list;
      if (!same) { winnerId = null; stage.classList.remove("won"); }
      draw();
    },
    resize, spinTo, jumpTo,
    destroy() { cancelAnimationFrame(raf); if (audio) { try { audio.close(); } catch { /* ignore */ } } },
  };
}

function pseudoRandom(seed) {
  let x = Math.floor(Number(seed) % 2147483647) || 1;
  x = (x * 48271) % 2147483647;
  return (x - 1) / 2147483646;
}

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * f)), g = Math.min(255, Math.round(((n >> 8) & 255) * f)), b = Math.min(255, Math.round((n & 255) * f));
  return `rgb(${r},${g},${b})`;
}
