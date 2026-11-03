// Einstieg des Workers: Routing der REST-API (gleiche Pfade wie die Android-App), Login-Pflicht,
// Live-Updates über das Hub-Durable-Object, Steam-Proxy, Admin-Funktionen, Export/Import.
import { Db, Env } from "./db";
import { Repo, toBytes } from "./repo";
import { resolveSession, issueToken, login, changePassword, resetPassword, validatePassword, hashPassword, randomCode, Session } from "./auth";
import { steamSearch, steamDetails, steamAppIdFromUrl } from "./steam";
import { HttpError, Unauthorized, Forbidden, BadRequest, NotFound, gameKey } from "./logic";
import changelog from "./changelog.json";
export { Hub } from "./hub";

const VERSION = "2.0.0";
const PUBLIC = new Set(["/api/auth/members", "/api/auth/login", "/api/auth/register", "/api/ping", "/api/host", "/api/changes"]);

type Handler = (c: Ctx) => Promise<Response | unknown>;
interface Route { method: string; pattern: RegExp; keys: string[]; handler: Handler }
interface Ctx { req: Request; env: Env; db: Db; repo: Repo; session: Session | null; params: Record<string, string>; url: URL; body: <T = any>() => Promise<T>; broadcast: (topic: string, payload?: unknown) => Promise<void> }

const routes: Route[] = [];
function add(method: string, path: string, handler: Handler) {
  const keys: string[] = [];
  const pattern = new RegExp("^" + path.replace(/\{(\w+)\}/g, (_, k) => { keys.push(k); return "([^/]+)"; }) + "$");
  routes.push({ method, pattern, keys, handler });
}
const get = (p: string, h: Handler) => add("GET", p, h), post = (p: string, h: Handler) => add("POST", p, h), put = (p: string, h: Handler) => add("PUT", p, h), del = (p: string, h: Handler) => add("DELETE", p, h);

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers } });
const ok = (id?: number) => ({ ok: true, id: id ?? null });
const id = (c: Ctx, name = "id") => { const n = Number(c.params[name]); if (!Number.isInteger(n)) throw new BadRequest("Ungültige ID"); return n; };
const eventId = (c: Ctx) => { const v = c.url.searchParams.get("eventId"); return v ? Number(v) : null; };
const actor = (c: Ctx) => c.session?.member.id ?? null;
const session = (c: Ctx) => { if (!c.session) throw new Unauthorized(); return c.session; };
const isAdmin = (c: Ctx) => !!c.session && c.session.member.isAdmin === 1;
const requireAdmin = (c: Ctx) => { if (!isAdmin(c)) throw new Forbidden("Nur Admins dürfen das"); };
const requireSelfOrAdmin = (c: Ctx, memberId: number) => { if (session(c).member.id !== memberId && !isAdmin(c)) throw new Forbidden("Nur das eigene Profil kann bearbeitet werden"); };
const device = (c: Ctx) => c.req.headers.get("User-Agent") ?? "";
/** Autor des Eintrags oder Admin – sonst 403. */
const requireAuthorOrAdmin = async (c: Ctx, table: string, rowId: number, what: string) => {
  const row = await c.db.first<{ authorId: number | null }>(`SELECT authorId FROM ${table} WHERE id = ?`, rowId);
  if (!row) throw new NotFound(`${what} nicht gefunden`);
  if (row.authorId !== session(c).member.id && !isAdmin(c)) throw new Forbidden(`Nur der Autor oder ein Admin darf ${what === "Kommentar" ? "den" : "diesen"} ${what} ändern`);
};
const authResponse = async (c: Ctx, memberId: number, token: string) => ({ token, member: await c.repo.member(memberId), isHost: (await c.repo.member(memberId)).isAdmin, isAdmin: (await c.repo.member(memberId)).isAdmin });

// ---------------- Login
get("/api/auth/members", async c => c.repo.authMembers());
post("/api/auth/login", async c => {
  const r = await c.body<{ memberId: number; password: string }>();
  const m = await login(c.db, Number(r.memberId), String(r.password ?? ""));
  const token = await issueToken(c.db, m.id, device(c));
  await c.broadcast("members");
  return authResponse(c, m.id, token);
});
post("/api/auth/register", async c => {
  const r = await c.body<{ name: string; password: string; color?: string; inviteCode?: string }>();
  validatePassword(String(r.password ?? ""));
  const count = (await c.db.first<{ n: number }>("SELECT COUNT(*) AS n FROM members"))!.n;
  if (count > 0) {
    const code = await c.repo.inviteCode();
    if (String(r.inviteCode ?? "").trim().toUpperCase() !== code) throw new Forbidden("Einladungscode fehlt oder ist falsch. Frag einen Admin der Bruderschaft.");
  }
  const m = await c.repo.createMember({ name: r.name, color: r.color });
  await c.db.run("UPDATE members SET password = ? WHERE id = ?", await hashPassword(r.password), m.id);
  const token = await issueToken(c.db, m.id, device(c));
  await c.broadcast("members");
  return authResponse(c, m.id, token);
});
get("/api/auth/me", async c => { const s = session(c); const m = await c.repo.member(s.member.id); return { member: m, isHost: m.isAdmin, isAdmin: m.isAdmin }; });
post("/api/auth/logout", async c => { await c.db.run("DELETE FROM auth_tokens WHERE tokenHash = ?", session(c).tokenHash); return ok(); });
post("/api/auth/password", async c => {
  const s = session(c); const r = await c.body<{ oldPassword?: string; newPassword: string }>();
  await changePassword(c.db, s.member.id, r.oldPassword ?? "", r.newPassword);
  return authResponse(c, s.member.id, await issueToken(c.db, s.member.id, device(c)));
});
post("/api/auth/reset/{id}", async c => { requireAdmin(c); await resetPassword(c.db, id(c)); await c.broadcast("members"); return ok(); });

// ---------------- Admin
get("/api/admin/invite", async c => { requireAdmin(c); return { code: await c.repo.inviteCode() }; });
post("/api/admin/invite", async c => { requireAdmin(c); return { code: await c.repo.regenerateInviteCode() }; });
post("/api/admin/members/{id}/admin", async c => { requireAdmin(c); const r = await c.body<{ admin: boolean }>(); const m = await c.repo.setAdmin(id(c), !!r.admin); await c.broadcast("members"); return m; });
get("/api/admin/export", async c => { requireAdmin(c); return exportAll(c); });
post("/api/admin/reset", async c => {
  requireAdmin(c);
  const r = await c.repo.resetEvent(await c.body());
  for (const t of ["games", "sessions", "poll", "costs", "equipment", "members", "suggestions", "forum"]) await c.broadcast(t);
  return r;
});
post("/api/admin/merge", async c => { requireAdmin(c); const data = await c.body<ExportData>(); const r = await mergeAll(c, data); for (const t of ["members", "games", "sessions", "suggestions", "forum", "costs", "equipment", "events", "shares"]) await c.broadcast(t); return r; });
post("/api/admin/import", async c => { requireAdmin(c); const data = await c.body<ExportData>(); const r = await importAll(c, data); for (const t of ["members", "games", "sessions", "suggestions", "forum", "costs", "equipment", "events", "shares"]) await c.broadcast(t); return r; });

// ---------------- Allgemein
get("/api/bootstrap", async c => {
  const ev = await c.repo.ensureCurrentEvent();
  await c.repo.seedDefaultEquipmentIfEmpty(); // wie in der Android-App beim ersten Start
  return { event: { id: ev.id, name: ev.name, year: ev.year, startDate: ev.startDate, days: ev.days, isCurrent: true }, events: await c.repo.events(), members: await c.repo.members(), serverTime: Date.now(), appName: c.env.APP_NAME };
});
get("/api/host", async c => ({ mode: "cloud", addresses: [c.url.host], port: 443, clients: 0, version: VERSION, dbPath: "Cloudflare D1" }));
get("/api/ping", async () => new Response("pong"));
get("/api/changes", async c => ({ now: Date.now(), changes: await c.repo.changesSince(Number(c.url.searchParams.get("since") ?? 0)) }));

// ---------------- Mitglieder
get("/api/members", async c => c.repo.members());
post("/api/members", async c => { const m = await c.repo.createMember(await c.body()); await c.broadcast("members"); return m; });
get("/api/members/{id}", async c => c.repo.member(id(c)));
put("/api/members/{id}", async c => { requireSelfOrAdmin(c, id(c)); const m = await c.repo.updateMember(id(c), await c.body()); await c.broadcast("members"); return m; });
del("/api/members/{id}", async c => { requireSelfOrAdmin(c, id(c)); await c.repo.deleteMember(id(c)); await c.broadcast("members"); return ok(); });
get("/api/members/{id}/xp", async c => c.repo.xpLog(id(c)));
get("/api/members/{id}/avatar", async c => {
  const data = await c.repo.avatar(id(c));
  if (!data) return Response.redirect(new URL("/img/avatar-default.svg", c.url).toString(), 302);
  return new Response(data as unknown as BodyInit, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=3600" } });
});
post("/api/members/{id}/avatar", async c => {
  requireSelfOrAdmin(c, id(c));
  let bytes: ArrayBuffer;
  const ct = c.req.headers.get("Content-Type") ?? "";
  if (ct.startsWith("multipart/")) {
    const form = await c.req.formData();
    const f = [...form.values()].find(v => v instanceof File) as File | undefined;
    if (!f) throw new BadRequest("Kein Bild übermittelt");
    bytes = await f.arrayBuffer();
  } else bytes = await c.req.arrayBuffer();
  if (!bytes.byteLength) throw new BadRequest("Kein Bild übermittelt");
  if (bytes.byteLength > 900_000) throw new BadRequest("Bild ist zu groß (max. 900 KB, die App verkleinert normalerweise auf 512 px)");
  await c.repo.setAvatar(id(c), bytes); await c.broadcast("members"); return ok(id(c));
});

// ---------------- Spiele
get("/api/games", async c => c.repo.games());
post("/api/games", async c => { const g = await c.repo.createGame(await c.body(), actor(c)); await c.broadcast("games"); return g; });
put("/api/games/{id}", async c => { const g = await c.repo.updateGame(id(c), await c.body()); await c.broadcast("games"); return g; });
del("/api/games/{id}", async c => { await c.repo.deleteGame(id(c)); await c.broadcast("games"); return ok(); });
post("/api/games/{id}/select", async c => { await c.repo.selectGame(id(c), !!(await c.body<{ selected: boolean }>()).selected); await c.broadcast("games"); return ok(); });

// ---------------- Freigaben: der PC lädt seine Ordnerliste per Skript hoch
get("/api/shares", async c => c.repo.shares());
post("/api/shares", async c => { const s = await c.repo.createShare(await c.body(), actor(c), randomCode(20)); await c.broadcast("shares"); return s; });
del("/api/shares/{id}", async c => { await c.repo.deleteShare(id(c), session(c).member.id, isAdmin(c)); await c.broadcast("shares"); await c.broadcast("games"); return ok(); });
post("/api/shares/{id}/folders", async c => {
  // Ohne Login, aber mit dem Upload-Schlüssel der Freigabe (steht im Skript)
  const share = await c.repo.shareByUploadKey(id(c), c.req.headers.get("X-Share-Key") ?? "");
  const r = await c.body<{ folders: string[] }>();
  if (!Array.isArray(r.folders)) throw new BadRequest("folders fehlt");
  const res = await c.repo.applyFolders(share, r.folders);
  await c.broadcast("games"); await c.broadcast("shares");
  return res;
});
/** PowerShell-Skript zum Einrichten der Freigabe und Hochladen der Ordnerliste – per `irm <url> | iex` als Ganzes ausführbar. */
get("/api/shares/{id}/setup.ps1", async c => {
  const share = await c.repo.shareByUploadKey(id(c), c.url.searchParams.get("key") ?? "");
  const q = c.url.searchParams;
  const ps = (v: string) => "'" + String(v).replace(/'/g, "''") + "'";
  const folder = q.get("folder") || "D:\\Spiele";
  const shareName = (q.get("share") || share.path.split("\\").filter(Boolean)[1] || "Spiele").replace(/[\\/]/g, "");
  const setup = q.get("setup") === "1";
  const user = q.get("user") || "bbl", pass = q.get("pass") || "";
  const lines = [
    `# BINARY BROTHERHOOD – Spielordner melden${setup ? " und Freigabe einrichten" : ""}`,
    `$ErrorActionPreference = 'Stop'`,
    `$path = ${ps(folder)}`,
    `if (-not (Test-Path -LiteralPath $path)) { throw "Ordner $path gibt es nicht" }`,
  ];
  if (setup) {
    if (!pass) throw new BadRequest("pass fehlt");
    lines.push(
      `$share = ${ps(shareName)}; $user = ${ps(user)}; $pass = ${ps(pass)}`,
      `$id = [Security.Principal.WindowsIdentity]::GetCurrent(); $isAdmin = (New-Object Security.Principal.WindowsPrincipal $id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)`,
      `if (-not $isAdmin) { throw 'Bitte PowerShell als Administrator starten (Rechtsklick -> Als Administrator ausführen)' }`,
      `$secure = ConvertTo-SecureString $pass -AsPlainText -Force`,
      `# 1. Eigener Lesebenutzer (erscheint nicht am Anmeldebildschirm)`,
      `if (Get-LocalUser -Name $user -ErrorAction SilentlyContinue) { Set-LocalUser -Name $user -Password $secure -PasswordNeverExpires $true } else { New-LocalUser -Name $user -Password $secure -PasswordNeverExpires -UserMayNotChangePassword -Description 'BINARY BROTHERHOOD Spiele-Freigabe' | Out-Null }`,
      `$reg = 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon\\SpecialAccounts\\UserList'`,
      `New-Item -Path $reg -Force | Out-Null; New-ItemProperty -Path $reg -Name $user -Value 0 -PropertyType DWord -Force | Out-Null`,
      `# 2. Freigabe mit Leserecht`,
      `if (Get-SmbShare -Name $share -ErrorAction SilentlyContinue) { Grant-SmbShareAccess -Name $share -AccountName $user -AccessRight Read -Force | Out-Null } else { New-SmbShare -Name $share -Path $path -ReadAccess $user | Out-Null }`,
      `# 3. NTFS-Leserecht auf den Ordner`,
      `$acl = Get-Acl -LiteralPath $path`,
      `$rule = New-Object System.Security.AccessControl.FileSystemAccessRule($user, 'ReadAndExecute', 'ContainerInherit,ObjectInherit', 'None', 'Allow')`,
      `$acl.AddAccessRule($rule); Set-Acl -LiteralPath $path -AclObject $acl`,
      `# 4. Netzwerkprofil auf Privat und Firewall-Regeln für die Freigabe`,
      `Get-NetConnectionProfile | Where-Object { $_.NetworkCategory -eq 'Public' } | Set-NetConnectionProfile -NetworkCategory Private`,
      `foreach ($g in 'Datei- und Druckerfreigabe', 'File and Printer Sharing') { Enable-NetFirewallRule -DisplayGroup $g -ErrorAction SilentlyContinue }`,
      `Set-SmbServerConfiguration -EnableSMB2Protocol $true -Force`,
      `Write-Host ('Freigabe eingerichtet: \\\\' + $env:COMPUTERNAME + '\\' + $share) -ForegroundColor Green`,
    );
  }
  lines.push(
    `# Ordnerliste an die App melden`,
    `$folders = @(Get-ChildItem -LiteralPath $path -Directory | Select-Object -ExpandProperty Name)`,
    `$body = [System.Text.Encoding]::UTF8.GetBytes((@{ folders = $folders } | ConvertTo-Json -Compress))`,
    `$r = Invoke-RestMethod -Method Post -Uri ${ps(`${c.url.origin}/api/shares/${share.id}/folders`)} -Headers @{ 'X-Share-Key' = ${ps(share.uploadKey)} } -ContentType 'application/json; charset=utf-8' -Body $body`,
    `Write-Host ''; Write-Host ('Fertig! ' + $r.folders + ' Ordner gemeldet, ' + $r.added + ' neue Spiele.') -ForegroundColor Green`,
  );
  // Als ein Block, damit auch zeilenweises Einfügen in die Konsole als Ganzes läuft
  const script = "& {\r\n" + lines.map(l => "  " + l).join("\r\n") + "\r\n}\r\n";
  return new Response(script, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
});
get("/api/shares/wizard", async c => ({ clientIp: c.req.headers.get("CF-Connecting-IP") ?? "", clientIsHostPhone: false, hostAddresses: [], mode: "cloud", base: c.url.origin }));

// ---------------- Runden
get("/api/sessions", async c => c.repo.sessions(eventId(c)));
post("/api/sessions", async c => { const s = await c.repo.startSession(await c.body()); await c.broadcast("sessions"); await c.broadcast("games"); return s; });
put("/api/sessions/{id}", async c => { const r = await c.body<{ participantIds: number[]; note?: string }>(); const s = await c.repo.updateSession(id(c), r.participantIds, r.note ?? ""); await c.broadcast("sessions"); await c.broadcast("members"); return s; });
post("/api/sessions/{id}/end", async c => { const s = await c.repo.endSession(id(c)); await c.broadcast("sessions"); return s; });
del("/api/sessions/{id}", async c => { await c.repo.deleteSession(id(c)); await c.broadcast("sessions"); await c.broadcast("games"); return ok(); });

// ---------------- Glücksrad & Abstimmung
get("/api/wheel/state", async c => { const s = await c.repo.lastSpin(); return s ?? new Response(null, { status: 204 }); });
post("/api/wheel/spin", async c => { const r = await c.body<{ excludePlayed?: boolean; onlySelected?: boolean }>(); const s = await c.repo.spin(!!r.excludePlayed, r.onlySelected ?? true, actor(c)); await c.broadcast("wheel", s); return s; });
get("/api/polls/current", async c => (await c.repo.currentPoll()) ?? new Response(null, { status: 204 }));
post("/api/polls", async c => { const p = await c.repo.openPoll(); await c.broadcast("poll"); return p; });
post("/api/polls/{id}/vote", async c => { const p = await c.repo.votePoll(id(c), actor(c), Number((await c.body<{ gameId: number }>()).gameId)); await c.broadcast("poll"); return p; });
post("/api/polls/{id}/close", async c => { const p = await c.repo.closePoll(id(c)); await c.broadcast("poll"); return p; });

// ---------------- Vorschläge
get("/api/suggestions", async c => c.repo.suggestions(actor(c)));
post("/api/suggestions", async c => { const s = await c.repo.createSuggestion(await c.body(), actor(c)); await c.broadcast("suggestions"); return s; });
put("/api/suggestions/{id}", async c => { await requireAuthorOrAdmin(c, "suggestions", id(c), "Vorschlag"); const s = await c.repo.updateSuggestion(id(c), await c.body(), actor(c)); await c.broadcast("suggestions"); return s; });
del("/api/suggestions/{id}", async c => { await requireAuthorOrAdmin(c, "suggestions", id(c), "Vorschlag"); await c.repo.deleteSuggestion(id(c)); await c.broadcast("suggestions"); return ok(); });
post("/api/suggestions/{id}/vote", async c => { await c.repo.voteSuggestion(id(c), actor(c), Number((await c.body<{ value: number }>()).value)); await c.broadcast("suggestions"); return ok(); });
post("/api/suggestions/{id}/comments", async c => { await c.repo.commentSuggestion(id(c), actor(c), (await c.body<{ text: string }>()).text); await c.broadcast("suggestions"); return ok(); });
del("/api/suggestions/comments/{id}", async c => { await requireAuthorOrAdmin(c, "suggestion_comments", id(c), "Kommentar"); await c.repo.deleteSuggestionComment(id(c)); await c.broadcast("suggestions"); return ok(); });
post("/api/suggestions/{id}/adopt", async c => { const g = await c.repo.adoptSuggestion(id(c), actor(c)); await c.broadcast("suggestions"); await c.broadcast("games"); return g; });

// ---------------- Forum
get("/api/forum", async c => c.repo.forum());
post("/api/forum", async c => { const p = await c.repo.createPost(await c.body(), actor(c)); await c.broadcast("forum"); return p; });
put("/api/forum/{id}", async c => { await requireAuthorOrAdmin(c, "forum_posts", id(c), "Beitrag"); const p = await c.repo.updatePost(id(c), await c.body(), actor(c), isAdmin(c)); await c.broadcast("forum"); return p; });
del("/api/forum/{id}", async c => { requireAdmin(c); await c.repo.deletePost(id(c)); await c.broadcast("forum"); return ok(); });
post("/api/forum/{id}/comments", async c => { const r = await c.body<{ text: string; mediaIds?: number[] }>(); await c.repo.commentPostWithMedia(id(c), actor(c), r.text, r.mediaIds ?? []); await c.broadcast("forum"); return ok(); });

// ---------------- Änderungsprotokoll (für Admins, aus der Git-Historie beim Deploy)
interface ChangeEntry { hash: string; ts: number; subject: string; items: string[] }
get("/api/changelog", async c => {
  const s = session(c);
  const seen = Number(await c.db.setting(`changelogSeen:${s.member.id}`) ?? 0);
  return { seen, entries: (changelog as ChangeEntry[]).slice(0, 40) };
});
post("/api/changelog/seen", async c => {
  const s = session(c);
  const latest = Math.max(0, ...(changelog as ChangeEntry[]).map(e => e.ts));
  await c.db.setSetting(`changelogSeen:${s.member.id}`, String(latest));
  return ok();
});

// ---------------- Discord (Admin hinterlegt Einladung und optional die Server-ID fürs Widget)
const discordConfig = async (c: Ctx) => ({ invite: (await c.db.setting("discordInvite")) ?? "", guildId: (await c.db.setting("discordGuildId")) ?? "" });
get("/api/discord", async c => {
  const cfg = await discordConfig(c);
  let widget: unknown = null, widgetError: string | null = null;
  if (cfg.guildId) {
    try {
      const r = await fetch(`https://discord.com/api/guilds/${cfg.guildId}/widget.json`, { cf: { cacheTtl: 60 } } as RequestInit);
      if (r.ok) {
        const w = await r.json() as any;
        widget = { name: w.name, presenceCount: w.presence_count, instantInvite: w.instant_invite,
          channels: (w.channels ?? []).map((ch: any) => ({ id: ch.id, name: ch.name })),
          members: (w.members ?? []).slice(0, 60).map((m: any) => ({ name: m.username, status: m.status, avatar: m.avatar_url, channelId: m.channel_id ?? null, game: m.activity?.name ?? null })) };
      } else widgetError = r.status === 403 ? "Server-Widget ist in Discord nicht aktiviert (Servereinstellungen → Widget)" : `Discord antwortet mit ${r.status}`;
    } catch (e) { widgetError = `Discord nicht erreichbar: ${(e as Error).message}`; }
  }
  return { ...cfg, widget, widgetError };
});
put("/api/discord", async c => {
  requireAdmin(c);
  const r = await c.body<{ invite?: string; guildId?: string }>();
  const invite = String(r.invite ?? "").trim();
  if (invite && !/^https:\/\/(discord\.gg|discord\.com\/invite)\/[\w-]+$/i.test(invite)) throw new BadRequest("Einladungslink muss wie https://discord.gg/abc123 aussehen");
  const guildId = String(r.guildId ?? "").trim();
  if (guildId && !/^\d{15,22}$/.test(guildId)) throw new BadRequest("Server-ID besteht nur aus Ziffern (Discord: Rechtsklick auf den Server → Server-ID kopieren)");
  await c.db.setSetting("discordInvite", invite);
  await c.db.setSetting("discordGuildId", guildId);
  await c.broadcast("discord");
  return discordConfig(c);
});

// ---------------- Medien (Bilder/GIFs im Forum)
post("/api/media/url", async c => {
  // Eingefügter Bild-/GIF-Link: der Server holt die Datei, damit sie nicht vom fremden Host abhängt
  const s = session(c);
  const { url } = await c.body<{ url: string }>();
  let u: URL; try { u = new URL(String(url)); } catch { throw new BadRequest("Ungültiger Link"); }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new BadRequest("Ungültiger Link");
  const res = await fetch(u.toString(), { headers: { "User-Agent": "BinaryBrotherhood/2.0", Accept: "image/*" }, redirect: "follow" });
  if (!res.ok) throw new BadRequest(`Bild nicht abrufbar (${res.status})`);
  const ct = (res.headers.get("Content-Type") ?? "").split(";")[0].trim();
  if (!/^image\/(jpeg|png|gif|webp)$/.test(ct)) throw new BadRequest("Der Link zeigt auf kein Bild (JPG, PNG, GIF, WebP)");
  const len = Number(res.headers.get("Content-Length") ?? 0);
  if (len > 1_900_000) throw new BadRequest("Datei ist zu groß (max. 1,9 MB)");
  const data = await res.arrayBuffer();
  if (data.byteLength > 1_900_000) throw new BadRequest("Datei ist zu groß (max. 1,9 MB)");
  const name = decodeURIComponent(u.pathname.split("/").pop() || "bild").slice(0, 120);
  return c.repo.createMedia(data, ct, name, s.member.id);
});
post("/api/media", async c => {
  const s = session(c);
  const ct = (c.req.headers.get("Content-Type") ?? "").split(";")[0].trim();
  if (!/^image\/(jpeg|png|gif|webp)$/.test(ct)) throw new BadRequest("Nur JPG, PNG, GIF oder WebP");
  const data = await c.req.arrayBuffer();
  if (!data.byteLength) throw new BadRequest("Datei ist leer");
  if (data.byteLength > 1_500_000) throw new BadRequest("Datei ist zu groß (max. 1,5 MB)");
  return c.repo.createMedia(data, ct, decodeURIComponent(c.req.headers.get("X-File-Name") ?? ""), s.member.id);
});
get("/api/media/{id}", async c => {
  const m = await c.repo.media(id(c));
  if (!m) throw new NotFound("Bild nicht gefunden");
  return new Response(m.data as unknown as BodyInit, { headers: { "Content-Type": m.contentType, "Cache-Control": "public, max-age=31536000, immutable" } });
});
del("/api/forum/comments/{id}", async c => { requireAdmin(c); await c.repo.deleteForumComment(id(c)); await c.broadcast("forum"); return ok(); });

// ---------------- LAN-Party-Ausgaben
get("/api/events", async c => c.repo.events());
post("/api/events", async c => { const e = await c.repo.createEvent(await c.body()); await c.broadcast("events"); await c.broadcast("equipment"); await c.broadcast("suggestions"); return e; });
put("/api/events/{id}", async c => { const e = await c.repo.updateEvent(id(c), await c.body()); await c.broadcast("events"); return e; });
post("/api/events/{id}/activate", async c => { await c.repo.activateEvent(id(c)); await c.broadcast("events"); return ok(); });
del("/api/events/{id}", async c => { await c.repo.deleteEvent(id(c)); await c.broadcast("events"); return ok(); });

// ---------------- Kosten
get("/api/costs", async c => c.repo.costs(eventId(c)));
put("/api/costs/attendance", async c => { await c.repo.setAttendance(eventId(c), await c.body()); await c.broadcast("costs"); await c.broadcast("members"); return ok(); });
post("/api/costs/expenses", async c => { const e = await c.repo.createExpense(eventId(c), await c.body()); await c.broadcast("costs"); return e; });
put("/api/costs/expenses/{id}", async c => { const e = await c.repo.updateExpense(id(c), await c.body()); await c.broadcast("costs"); return e; });
del("/api/costs/expenses/{id}", async c => { await c.repo.deleteExpense(id(c)); await c.broadcast("costs"); return ok(); });
post("/api/costs/payments", async c => { const p = await c.repo.createPayment(eventId(c), await c.body()); await c.broadcast("costs"); return p; });
del("/api/costs/payments/{id}", async c => { await c.repo.deletePayment(id(c)); await c.broadcast("costs"); return ok(); });

// ---------------- Ausrüstung
get("/api/equipment", async c => c.repo.equipment(eventId(c)));
post("/api/equipment", async c => { const e = await c.repo.createEquipment(eventId(c), await c.body()); await c.broadcast("equipment"); return e; });
put("/api/equipment/{id}", async c => { const e = await c.repo.updateEquipment(id(c), await c.body()); await c.broadcast("equipment"); return e; });
del("/api/equipment/{id}", async c => { await c.repo.deleteEquipment(id(c)); await c.broadcast("equipment"); return ok(); });
post("/api/equipment/{id}/claim", async c => { const r = await c.body<{ memberId?: number | null }>(); const e = await c.repo.claimEquipment(id(c), r.memberId ?? null); await c.broadcast("equipment"); return e; });
post("/api/equipment/{id}/done", async c => { const e = await c.repo.setEquipmentDone(id(c), !!(await c.body<{ done: boolean }>()).done); await c.broadcast("equipment"); await c.broadcast("members"); return e; });
post("/api/equipment/template", async c => { const n = await c.repo.applyEquipmentTemplate((await c.body<{ fromEventId?: number | null }>()).fromEventId ?? null); await c.broadcast("equipment"); return ok(n); });

// ---------------- Klänge
const SOUND_KINDS = new Set(["spin", "winner"]);
const soundKind = (c: Ctx) => { const k = c.params.kind; if (!SOUND_KINDS.has(k)) throw new NotFound("Unbekannter Klang"); return k; };
get("/api/sounds", async c => c.repo.sounds());
get("/api/sounds/{kind}", async c => {
  const s = await c.repo.sound(soundKind(c));
  if (!s) throw new NotFound("Kein eigener Klang hinterlegt");
  return new Response(s.data as unknown as BodyInit, { headers: { "Content-Type": s.contentType, "Cache-Control": "public, max-age=86400" } });
});
post("/api/sounds/{kind}", async c => {
  requireAdmin(c);
  const kind = soundKind(c);
  const ct = c.req.headers.get("Content-Type") ?? "";
  if (!ct.startsWith("audio/")) throw new BadRequest("Bitte eine Audiodatei hochladen (MP3, OGG, WAV, M4A)");
  const data = await c.req.arrayBuffer();
  if (!data.byteLength) throw new BadRequest("Datei ist leer");
  if (data.byteLength > 1_500_000) throw new BadRequest("Datei ist zu groß (max. 1,5 MB) – kurzen Clip nehmen");
  await c.repo.setSound(kind, data, ct.split(";")[0], decodeURIComponent(c.req.headers.get("X-File-Name") ?? kind));
  await c.broadcast("sounds");
  return c.repo.sounds();
});
del("/api/sounds/{kind}", async c => { requireAdmin(c); await c.repo.deleteSound(soundKind(c)); await c.broadcast("sounds"); return c.repo.sounds(); });

// ---------------- Steam
get("/api/steam/search", async c => { try { return await steamSearch(c.url.searchParams.get("q") ?? ""); } catch (e) { throw new BadRequest(`Steam nicht erreichbar: ${(e as Error).message}`); } });
get("/api/steam/app/{id}", async c => { let d; try { d = await steamDetails(id(c)); } catch (e) { throw new BadRequest(`Steam nicht erreichbar: ${(e as Error).message}`); } if (!d) throw new NotFound("Steam-App nicht gefunden"); return d; });
get("/api/steam/parse", async c => { const a = steamAppIdFromUrl(c.url.searchParams.get("url") ?? ""); if (!a) throw new BadRequest("Keine Steam-App-ID im Link gefunden"); return { appId: a }; });

// ---------------- Export / Import (Datenumzug vom Handy)
const TABLES = ["events", "members", "auth_tokens", "games", "shares", "sessions", "session_participants", "suggestions", "suggestion_votes", "suggestion_comments", "forum_posts", "forum_comments", "attendance", "expenses", "expense_shares", "payments", "equipment", "polls", "poll_votes", "xp_log"] as const;
interface ExportData { format: string; exportedAt: number; tables: Record<string, Record<string, unknown>[]>; avatars?: Record<string, string> }
async function exportAll(c: Ctx): Promise<ExportData> {
  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const t of TABLES) {
    const rows = await c.db.all(t === "members" ? "SELECT id, name, motto, color, hasAvatar, createdAt, password, isAdmin, avatarUpdatedAt FROM members" : `SELECT * FROM ${t}`);
    tables[t] = rows;
  }
  const avatars: Record<string, string> = {};
  for (const m of await c.db.all<{ id: number; avatar: ArrayBuffer | number[] | null }>("SELECT id, avatar FROM members WHERE avatar IS NOT NULL")) {
    if (m.avatar) { const b = toBytes(m.avatar); let s = ""; for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192)); avatars[String(m.id)] = btoa(s); }
  }
  return { format: "binary-brotherhood/1", exportedAt: Date.now(), tables, avatars };
}
/** Ersetzt den gesamten Datenbestand durch den Export (z. B. aus der Android-App). Tokens werden nicht übernommen. */
async function importAll(c: Ctx, data: ExportData) {
  if (data?.format !== "binary-brotherhood/1" || !data.tables) throw new BadRequest("Kein gültiger Export");
  const stmts: { sql: string; params?: unknown[] }[] = [];
  for (const t of TABLES) stmts.push({ sql: `DELETE FROM ${t}` });
  let count = 0;
  for (const t of TABLES) {
    if (t === "auth_tokens") continue;
    for (const row of data.tables[t] ?? []) {
      const r: Record<string, unknown> = { ...row };
      if (t === "members") { delete r.avatar; r.isAdmin = r.isAdmin ?? 0; }
      if (t === "shares") { delete r.username; delete r.password; delete r.domain; r.uploadKey = r.uploadKey ?? randomCode(20); }
      const cols = Object.keys(r);
      stmts.push({ sql: `INSERT INTO ${t} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`, params: cols.map(k => r[k] === undefined ? null : r[k]) });
      count++;
    }
  }
  await c.db.batch(stmts);
  for (const [mid, b64] of Object.entries(data.avatars ?? {})) {
    const bytes = Uint8Array.from(atob(b64), ch => ch.charCodeAt(0));
    await c.db.run("UPDATE members SET avatar = ?, hasAvatar = 1, avatarUpdatedAt = ? WHERE id = ?", bytes.buffer, Date.now(), Number(mid));
  }
  // Ohne Admin wäre niemand handlungsfähig: der Importierende bleibt Admin, sonst das erste Mitglied
  if ((await c.repo.adminCount()) === 0) {
    const self = await c.db.first<{ id: number }>("SELECT id FROM members WHERE id = ?", c.session!.member.id);
    const first = self ?? (await c.db.first<{ id: number }>("SELECT id FROM members ORDER BY id LIMIT 1"));
    if (first) await c.db.run("UPDATE members SET isAdmin = 1 WHERE id = ?", first.id);
  }
  return { ok: true, rows: count };
}

/**
 * Führt einen Export (z. B. vom Handy) mit dem Cloud-Bestand zusammen: Mitglieder, LAN-Ausgaben, Spiele und
 * Ausrüstung werden über den Namen abgeglichen, alles andere mit neuen IDs angehängt. Nichts wird gelöscht.
 */
async function mergeAll(c: Ctx, data: ExportData) {
  if (data?.format !== "binary-brotherhood/1" || !data.tables) throw new BadRequest("Kein gültiger Export");
  const t = (name: string) => (data.tables[name] ?? []) as Record<string, any>[];
  const n = (v: unknown) => (v == null ? null : Number(v));
  const added: Record<string, number> = {};
  const bump = (k: string) => (added[k] = (added[k] ?? 0) + 1);
  const db = c.db;
  const key = (s: string) => String(s ?? "").trim().toLowerCase();

  // Mitglieder (Name)
  const memberMap = new Map<number, number>();
  const existingMembers = await db.all<{ id: number; name: string }>("SELECT id, name FROM members");
  for (const m of t("members")) {
    const ex = existingMembers.find(x => key(x.name) === key(m.name));
    if (ex) { memberMap.set(Number(m.id), ex.id); continue; }
    const id = await db.insert("INSERT INTO members (name, motto, color, hasAvatar, createdAt, password, isAdmin) VALUES (?, ?, ?, 0, ?, ?, 0)", m.name, m.motto ?? "", m.color ?? "#8e97a8", m.createdAt ?? Date.now(), m.password ?? "");
    memberMap.set(Number(m.id), id); bump("members");
    const b64 = data.avatars?.[String(m.id)];
    if (b64) { const bytes = Uint8Array.from(atob(b64), ch => ch.charCodeAt(0)); await db.run("UPDATE members SET avatar = ?, hasAvatar = 1, avatarUpdatedAt = ? WHERE id = ?", bytes.buffer, Date.now(), id); }
  }
  const mm = (v: unknown) => (v == null ? null : memberMap.get(Number(v)) ?? null);

  // LAN-Ausgaben (Name); die aktuelle Ausgabe der Cloud bleibt aktuell
  const eventMap = new Map<number, number>();
  const existingEvents = await db.all<{ id: number; name: string }>("SELECT id, name FROM events");
  for (const e of t("events")) {
    const ex = existingEvents.find(x => key(x.name) === key(e.name));
    if (ex) { eventMap.set(Number(e.id), ex.id); continue; }
    const id = await db.insert("INSERT INTO events (name, year, startDate, days, isCurrent, createdAt) VALUES (?, ?, ?, ?, 0, ?)", e.name, e.year ?? new Date().getFullYear(), e.startDate ?? "", e.days ?? 3, e.createdAt ?? Date.now());
    eventMap.set(Number(e.id), id); bump("events");
  }
  const em = (v: unknown) => { const r = v == null ? null : eventMap.get(Number(v)); return r ?? null; };
  const fallbackEvent = (await c.repo.ensureCurrentEvent()).id;
  const emf = (v: unknown) => em(v) ?? fallbackEvent;

  // Freigaben (Pfad)
  const shareMap = new Map<number, number>();
  const existingShares = await db.all<{ id: number; path: string }>("SELECT id, path FROM shares");
  for (const sh of t("shares")) {
    const ex = existingShares.find(x => key(x.path) === key(sh.path));
    if (ex) { shareMap.set(Number(sh.id), ex.id); continue; }
    const id = await db.insert("INSERT INTO shares (path, addedById, lastScanAt, lastError, lastCount, knownFolders, uploadKey, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", sh.path, mm(sh.addedById), n(sh.lastScanAt), sh.lastError ?? "", sh.lastCount ?? 0, sh.knownFolders ?? "", randomCode(20), sh.createdAt ?? Date.now());
    shareMap.set(Number(sh.id), id); bump("shares");
  }

  // Spiele (Namensschlüssel)
  const gameMap = new Map<number, number>();
  const existingGames = await db.all<{ id: number; name: string }>("SELECT id, name FROM games");
  for (const g of t("games")) {
    const ex = existingGames.find(x => gameKey(x.name) === gameKey(g.name));
    if (ex) { gameMap.set(Number(g.id), ex.id); continue; }
    const id = await db.insert("INSERT INTO games (name, description, steamUrl, steamAppId, imageUrl, players, addedById, selectedForNext, createdAt, sharePath, shareId) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)",
      g.name, g.description ?? "", g.steamUrl ?? "", n(g.steamAppId), g.imageUrl ?? "", g.players ?? "", mm(g.addedById), g.createdAt ?? Date.now(), g.sharePath ?? "", g.shareId == null ? null : shareMap.get(Number(g.shareId)) ?? null);
    gameMap.set(Number(g.id), id); bump("games");
  }
  const gm = (v: unknown) => (v == null ? null : gameMap.get(Number(v)) ?? null);

  // Runden
  const sessionMap = new Map<number, number>();
  const exists = async (sql: string, ...p: unknown[]) => (await db.first<{ id: number }>(sql, ...p))?.id ?? null;
  for (const s of t("sessions")) {
    const gid = gm(s.gameId); if (gid == null) continue;
    const dup = await exists("SELECT id FROM sessions WHERE gameId = ? AND startedAt = ?", gid, s.startedAt);
    if (dup) { sessionMap.set(Number(s.id), dup); continue; }
    const id = await db.insert("INSERT INTO sessions (gameId, eventId, startedAt, endedAt, chosenBy, note) VALUES (?, ?, ?, ?, ?, ?)", gid, emf(s.eventId), s.startedAt, n(s.endedAt), s.chosenBy ?? "manual", s.note ?? "");
    sessionMap.set(Number(s.id), id); bump("sessions");
  }
  for (const p of t("session_participants")) { const sid = sessionMap.get(Number(p.sessionId)), mid = mm(p.memberId); if (sid && mid) await db.run("INSERT OR IGNORE INTO session_participants (sessionId, memberId) VALUES (?, ?)", sid, mid); }

  // Vorschläge, Forum
  const sugMap = new Map<number, number>(), sugCommentMap = new Map<number, number>();
  for (const sg of t("suggestions")) {
    const dup = await exists("SELECT id FROM suggestions WHERE title = ? AND createdAt = ?", sg.title, sg.createdAt ?? 0);
    if (dup) { sugMap.set(Number(sg.id), dup); continue; }
    const id = await db.insert("INSERT INTO suggestions (scope, title, description, steamUrl, steamAppId, imageUrl, authorId, adoptedGameId, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", sg.scope ?? "current", sg.title, sg.description ?? "", sg.steamUrl ?? "", n(sg.steamAppId), sg.imageUrl ?? "", mm(sg.authorId), gm(sg.adoptedGameId), sg.createdAt ?? Date.now());
    sugMap.set(Number(sg.id), id); bump("suggestions");
  }
  for (const v of t("suggestion_votes")) { const sid = sugMap.get(Number(v.suggestionId)), mid = mm(v.memberId); if (sid && mid) await db.run("INSERT OR IGNORE INTO suggestion_votes (suggestionId, memberId, value) VALUES (?, ?, ?)", sid, mid, v.value ?? 1); }
  for (const cm of t("suggestion_comments")) { const sid = sugMap.get(Number(cm.suggestionId)); if (!sid) continue; const dup = await exists("SELECT id FROM suggestion_comments WHERE suggestionId = ? AND createdAt = ?", sid, cm.createdAt ?? 0); if (dup) { sugCommentMap.set(Number(cm.id), dup); continue; } const id = await db.insert("INSERT INTO suggestion_comments (suggestionId, authorId, text, createdAt) VALUES (?, ?, ?, ?)", sid, mm(cm.authorId), cm.text ?? "", cm.createdAt ?? Date.now()); sugCommentMap.set(Number(cm.id), id); }
  const postMap = new Map<number, number>(), postCommentMap = new Map<number, number>();
  for (const p of t("forum_posts")) { const dup = await exists("SELECT id FROM forum_posts WHERE title = ? AND createdAt = ?", p.title ?? "", p.createdAt ?? 0); if (dup) { postMap.set(Number(p.id), dup); continue; } const id = await db.insert("INSERT INTO forum_posts (authorId, title, body, pinned, createdAt) VALUES (?, ?, ?, ?, ?)", mm(p.authorId), p.title ?? "", p.body ?? "", p.pinned ? 1 : 0, p.createdAt ?? Date.now()); postMap.set(Number(p.id), id); bump("forum_posts"); }
  for (const cm of t("forum_comments")) { const pid = postMap.get(Number(cm.postId)); if (!pid) continue; const dup = await exists("SELECT id FROM forum_comments WHERE postId = ? AND createdAt = ?", pid, cm.createdAt ?? 0); if (dup) { postCommentMap.set(Number(cm.id), dup); continue; } const id = await db.insert("INSERT INTO forum_comments (postId, authorId, body, createdAt) VALUES (?, ?, ?, ?)", pid, mm(cm.authorId), cm.body ?? "", cm.createdAt ?? Date.now()); postCommentMap.set(Number(cm.id), id); }

  // Kosten, Anwesenheit
  for (const a of t("attendance")) { const mid = mm(a.memberId); if (mid) await db.run("INSERT OR IGNORE INTO attendance (eventId, memberId, day) VALUES (?, ?, ?)", emf(a.eventId), mid, a.day); }
  const expenseMap = new Map<number, number>();
  for (const e of t("expenses")) { const mid = mm(e.paidById); if (!mid) continue; const dup = await exists("SELECT id FROM expenses WHERE title = ? AND createdAt = ?", e.title ?? "", e.createdAt ?? 0); if (dup) { expenseMap.set(Number(e.id), dup); continue; } const id = await db.insert("INSERT INTO expenses (eventId, title, amountCents, paidById, day, note, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)", emf(e.eventId), e.title ?? "", e.amountCents ?? 0, mid, n(e.day), e.note ?? "", e.createdAt ?? Date.now()); expenseMap.set(Number(e.id), id); bump("expenses"); }
  for (const sh of t("expense_shares")) { const eid = expenseMap.get(Number(sh.expenseId)), mid = mm(sh.memberId); if (eid && mid) await db.run("INSERT OR IGNORE INTO expense_shares (expenseId, memberId) VALUES (?, ?)", eid, mid); }
  for (const p of t("payments")) { const f = mm(p.fromId), to = mm(p.toId); if (f && to) { if (await exists("SELECT id FROM payments WHERE fromId = ? AND toId = ? AND createdAt = ?", f, to, p.createdAt ?? 0)) continue; await db.run("INSERT INTO payments (eventId, fromId, toId, amountCents, createdAt) VALUES (?, ?, ?, ?, ?)", emf(p.eventId), f, to, p.amountCents ?? 0, p.createdAt ?? Date.now()); bump("payments"); } }

  // Ausrüstung (Name + Kategorie je Ausgabe)
  const equipMap = new Map<number, number>();
  const existingEquip = await db.all<{ id: number; eventId: number; name: string; category: string }>("SELECT id, eventId, name, category FROM equipment");
  for (const e of t("equipment")) {
    const evId = emf(e.eventId);
    const ex = existingEquip.find(x => x.eventId === evId && key(x.name) === key(e.name) && key(x.category) === key(e.category));
    if (ex) { equipMap.set(Number(e.id), ex.id); if (e.bringerId != null && mm(e.bringerId)) await db.run("UPDATE equipment SET bringerId = COALESCE(bringerId, ?), done = MAX(done, ?) WHERE id = ?", mm(e.bringerId), e.done ? 1 : 0, ex.id); continue; }
    const id = await db.insert("INSERT INTO equipment (eventId, name, category, quantity, note, bringerId, done, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", evId, e.name, e.category ?? "Sonstiges", e.quantity ?? 1, e.note ?? "", mm(e.bringerId), e.done ? 1 : 0, e.createdAt ?? Date.now());
    equipMap.set(Number(e.id), id); bump("equipment");
  }

  // Abstimmungen
  const pollMap = new Map<number, number>();
  for (const p of t("polls")) { const dup = await exists("SELECT id FROM polls WHERE eventId = ? AND createdAt = ?", emf(p.eventId), p.createdAt ?? 0); if (dup) { pollMap.set(Number(p.id), dup); continue; } const id = await db.insert("INSERT INTO polls (eventId, open, winnerGameId, createdAt, closedAt) VALUES (?, ?, ?, ?, ?)", emf(p.eventId), 0, gm(p.winnerGameId), p.createdAt ?? Date.now(), n(p.closedAt)); pollMap.set(Number(p.id), id); }
  for (const v of t("poll_votes")) { const pid = pollMap.get(Number(v.pollId)), mid = mm(v.memberId), gid = gm(v.gameId); if (pid && mid && gid) await db.run("INSERT OR IGNORE INTO poll_votes (pollId, memberId, gameId) VALUES (?, ?, ?)", pid, mid, gid); }

  // XP-Protokoll: refId je nach Typ auf die neuen IDs umsetzen
  const refMap: Record<string, (v: number) => number | null | undefined> = {
    game_played: v => sessionMap.get(v), game_added: v => gameMap.get(v), suggestion: v => sugMap.get(v), suggestion_adopted: v => sugMap.get(v),
    forum_post: v => postMap.get(v), forum_comment: v => postCommentMap.get(v), suggestion_comment: v => sugCommentMap.get(v), equipment: v => equipMap.get(v),
    expense: v => expenseMap.get(v), attendance: v => { const ev = em(Math.floor(v / 100)); return ev == null ? null : ev * 100 + (v % 100); }, vote: v => pollMap.get(v),
  };
  for (const x of t("xp_log")) {
    const mid = mm(x.memberId); const f = refMap[x.type]; if (!mid || !f) continue;
    const ref = f(Number(x.refId)); if (ref == null) continue;
    const r = await db.run("INSERT OR IGNORE INTO xp_log (memberId, type, refId, amount, createdAt) VALUES (?, ?, ?, ?, ?)", mid, x.type, ref, x.amount ?? 0, x.createdAt ?? Date.now());
    if (r.meta.changes) bump("xp");
  }
  return { ok: true, added };
}

// ---------------- Dispatcher
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      // Token aus der URL → Mitglied an das Hub-Objekt melden (für die Online-Anzeige)
      const sess = await resolveSession(new Db(env.DB), url.searchParams.get("token"));
      const headers = new Headers(req.headers);
      if (sess) { headers.set("X-Member-Id", String(sess.member.id)); headers.set("X-Member-Name", encodeURIComponent(sess.member.name)); }
      const stub = env.HUB.get(env.HUB.idFromName("hub"));
      return stub.fetch(new Request(req, { headers }));
    }
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);

    const db = new Db(env.DB);
    const repo = new Repo(db);
    const token = req.headers.get("Authorization")?.replace(/^Bearer\s*/i, "").trim() ?? null;
    const sess = await resolveSession(db, token);
    const isAvatarGet = req.method === "GET" && (/^\/api\/members\/\d+\/avatar$/.test(url.pathname) || /^\/api\/sounds(\/\w+)?$/.test(url.pathname) || /^\/api\/media\/\d+$/.test(url.pathname));
    const isFolderUpload = (req.method === "POST" && /^\/api\/shares\/\d+\/folders$/.test(url.pathname)) || (req.method === "GET" && /^\/api\/shares\/\d+\/setup\.ps1$/.test(url.pathname));
    if (!sess && !PUBLIC.has(url.pathname) && !isAvatarGet && !isFolderUpload) return json({ error: "Bitte anmelden" }, 401);

    const broadcast = async (topic: string, payload?: unknown) => {
      await repo.touch(topic);
      const msg = JSON.stringify({ type: "change", topic, ts: Date.now(), ...(payload !== undefined ? { payload } : {}) });
      try { await env.HUB.get(env.HUB.idFromName("hub")).fetch("https://hub/broadcast", { method: "POST", body: msg }); } catch (e) { console.warn("broadcast", e); }
    };
    const ctx: Ctx = { req, env, db, repo, session: sess, params: {}, url, body: async () => { try { return await req.json(); } catch { throw new BadRequest("Ungültiges JSON"); } }, broadcast };

    try {
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = r.pattern.exec(url.pathname);
        if (!m) continue;
        r.keys.forEach((k, i) => (ctx.params[k] = decodeURIComponent(m[i + 1])));
        const result = await r.handler(ctx);
        return result instanceof Response ? result : json(result);
      }
      return json({ error: "Unbekannter Endpunkt" }, 404);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: (e as Error).message || "Interner Fehler" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
