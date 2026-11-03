// Einstieg des Workers: Routing der REST-API (gleiche Pfade wie die Android-App), Login-Pflicht,
// Live-Updates über das Hub-Durable-Object, Steam-Proxy, Admin-Funktionen, Export/Import.
import { Db, Env } from "./db";
import { Repo } from "./repo";
import { resolveMember, randomCode, Session } from "./auth";
import { Accounts, AuthInfo } from "./accounts";
import { pushProfile } from "./link";
import { Tournaments } from "./tournaments";
import { steamSearch, steamDetails, steamAppIdFromUrl } from "./steam";
import { HttpError, Unauthorized, Forbidden, BadRequest, NotFound } from "./logic";
import changelog from "./changelog.json";

/** Nur in LAN-Realms: Kosten/Anwesenheit, Ausrüstung, Freigaben, LAN-Ausgaben verwalten. */
const LAN_ONLY = ["/api/costs", "/api/equipment", "/api/shares", "/api/events"];
const PUBLIC = new Set(["/api/auth/me", "/api/ping", "/api/changes"]);

type Handler = (c: Ctx) => Promise<Response | unknown>;
interface Route { method: string; pattern: RegExp; keys: string[]; handler: Handler }
interface Ctx { req: Request; env: Env; db: Db; repo: Repo; realm: RealmInfo; auth: AuthInfo | null; session: Session | null; params: Record<string, string>; url: URL; body: <T = any>() => Promise<T>; broadcast: (topic: string, payload?: unknown) => Promise<void> }

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
/** Realm-Admin oder Super-Admin (darf in jedem Realm alles). */
const isAdmin = (c: Ctx) => !!c.session && (c.session.member.isAdmin === 1 || c.session.auth.superAdmin);
const requireSuperAdmin = (c: Ctx) => { if (!c.session?.auth.superAdmin) throw new Forbidden("Nur Super-Admins dürfen das"); };
/** Profil (Name, Avatar, Motto) gilt in allen Realms – ändern darf es nur der Inhaber oder ein Super-Admin. */
const requireSelfOrSuper = (c: Ctx, memberId: number) => { if (session(c).member.id !== memberId && !session(c).auth.superAdmin) throw new Forbidden("Nur das eigene Profil kann bearbeitet werden"); };
const requireAdmin = (c: Ctx) => { if (!isAdmin(c)) throw new Forbidden("Nur Admins dürfen das"); };
const requireSelfOrAdmin = (c: Ctx, memberId: number) => { if (session(c).member.id !== memberId && !isAdmin(c)) throw new Forbidden("Nur das eigene Profil kann bearbeitet werden"); };
/** Autor des Eintrags oder Admin – sonst 403. */
const requireAuthorOrAdmin = async (c: Ctx, table: string, rowId: number, what: string) => {
  const row = await c.db.first<{ authorId: number | null }>(`SELECT authorId FROM ${table} WHERE id = ?`, rowId);
  if (!row) throw new NotFound(`${what} nicht gefunden`);
  if (row.authorId !== session(c).member.id && !isAdmin(c)) throw new Forbidden(`Nur der Autor oder ein Admin darf ${what === "Kommentar" ? "den" : "diesen"} ${what} ändern`);
};
// ---------------- Login (Konten verwaltet der Worker, hier nur das Realm-Profil)
const meResponse = async (c: Ctx) => {
  const s = session(c); const m = await c.repo.member(s.member.id);
  return { member: m, isAdmin: isAdmin(c), isRealmAdmin: m.isAdmin, isSuperAdmin: s.auth.superAdmin, account: { id: s.auth.userId, name: s.auth.name } };
};
get("/api/auth/me", async c => {
  if (!c.auth) throw new Unauthorized();
  if (!c.session) return json({ error: "Du bist (noch) kein Mitglied dieses Realms", notMember: true }, 403);
  return meResponse(c);
});
/** Nur Super-Admins: Passwort gilt für alle Realms. */
post("/api/auth/reset/{id}", async c => {
  requireSuperAdmin(c);
  const m = await c.db.first<{ userId: number | null }>("SELECT userId FROM members WHERE id = ?", id(c));
  if (!m?.userId) throw new NotFound("Zu diesem Profil gibt es kein Konto");
  await new Accounts(c.env).resetPassword(m.userId); await c.broadcast("members"); return ok();
});

// ---------------- Admin
get("/api/admin/invite", async c => { requireAdmin(c); return { code: await c.repo.inviteCode() }; });
post("/api/admin/invite", async c => { requireAdmin(c); return { code: await c.repo.regenerateInviteCode() }; });
post("/api/admin/members/{id}/admin", async c => { requireAdmin(c); const r = await c.body<{ admin: boolean }>(); const m = await c.repo.setAdmin(id(c), !!r.admin); await c.broadcast("members"); return m; });
post("/api/admin/reset", async c => {
  requireAdmin(c);
  const r = await c.repo.resetEvent(await c.body());
  for (const t of ["games", "sessions", "poll", "costs", "equipment", "members", "suggestions", "forum"]) await c.broadcast(t);
  return r;
});

// ---------------- Allgemein
get("/api/bootstrap", async c => {
  const ev = await c.repo.ensureCurrentEvent();
  await c.repo.seedDefaultEquipmentIfEmpty(); // wie in der Android-App beim ersten Start
  return { event: { id: ev.id, name: ev.name, year: ev.year, startDate: ev.startDate, days: ev.days, isCurrent: true }, events: await c.repo.events(), members: await c.repo.members(), serverTime: Date.now(), appName: c.realm.name, realm: c.realm };
});
/** Admin: Realm umbenennen oder zwischen LAN-Party und Online-Runde umschalten. */
put("/api/realm", async c => {
  requireAdmin(c);
  const r = await c.body<{ name?: string; kind?: string }>();
  const name = String(r.name ?? c.realm.name).trim().slice(0, 60);
  if (name.length < 3) throw new BadRequest("Der Name braucht mindestens 3 Zeichen");
  const kind = r.kind === "online" ? "online" : r.kind === "lan" ? "lan" : c.realm.kind;
  const dup = await c.env.DB.prepare("SELECT slug FROM realms WHERE lower(name) = lower(?) AND slug <> ?").bind(name, c.realm.slug).first();
  if (dup) throw new BadRequest("Einen Realm mit diesem Namen gibt es schon");
  await c.env.DB.prepare("UPDATE realms SET name = ?, kind = ? WHERE slug = ?").bind(name, kind, c.realm.slug).run();
  c.realm.name = name; c.realm.kind = kind;
  await c.broadcast("realm", c.realm);
  return c.realm;
});
get("/api/ping", async () => new Response("pong"));
get("/api/changes", async c => ({ now: Date.now(), changes: await c.repo.changesSince(Number(c.url.searchParams.get("since") ?? 0)) }));

// ---------------- Mitglieder
get("/api/members", async c => c.repo.members());
post("/api/members", async () => { throw new BadRequest("Profile entstehen, wenn ein Konto dem Realm beitritt (Einladungscode)"); });
get("/api/members/{id}", async c => c.repo.member(id(c)));
put("/api/members/{id}", async c => {
  requireSelfOrSuper(c, id(c));
  const r = await c.body<{ name: string; motto?: string; color?: string | null }>();
  const row = await c.db.first<{ userId: number | null }>("SELECT userId FROM members WHERE id = ?", id(c));
  if (row?.userId && await c.env.DB.prepare("SELECT id FROM users WHERE name = ? COLLATE NOCASE AND id != ?").bind(String(r.name ?? "").trim(), row.userId).first()) throw new BadRequest("Den Namen hat schon ein anderes Konto");
  const m = await c.repo.updateMember(id(c), r);
  await pushProfile(c.db, c.env, c.realm, id(c), false);
  await c.broadcast("members"); return m;
});
/** Selbst austreten oder (Admin) aus dem Realm entfernen – das Konto bleibt bestehen. */
del("/api/members/{id}", async c => {
  requireSelfOrAdmin(c, id(c));
  const row = await c.db.first<{ userId: number | null; isAdmin: number }>("SELECT userId, isAdmin FROM members WHERE id = ?", id(c));
  if (!row) throw new NotFound("Mitglied nicht gefunden");
  const admins = (await c.db.first<{ n: number }>("SELECT COUNT(*) AS n FROM members WHERE isAdmin = 1"))!.n;
  const others = (await c.db.first<{ n: number }>("SELECT COUNT(*) AS n FROM members WHERE id != ?", id(c)))!.n;
  if (row.isAdmin === 1 && admins <= 1 && others > 0) throw new BadRequest("Erst einen anderen Admin ernennen – sonst hat der Realm keinen mehr");
  await c.repo.deleteMember(id(c));
  if (row.userId) await c.env.DB.prepare("DELETE FROM realm_members WHERE realmSlug = ? AND userId = ?").bind(c.realm.slug, row.userId).run();
  await c.broadcast("members"); return ok();
});
get("/api/members/{id}/xp", async c => c.repo.xpLog(id(c)));
get("/api/members/{id}/avatar", async c => {
  const data = await c.repo.avatar(id(c));
  if (!data) return Response.redirect(new URL("/img/avatar-default.svg", c.url).toString(), 302);
  return new Response(data as unknown as BodyInit, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=3600" } });
});
post("/api/members/{id}/avatar", async c => {
  requireSelfOrSuper(c, id(c));
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
  await c.repo.setAvatar(id(c), bytes); await pushProfile(c.db, c.env, c.realm, id(c), true); await c.broadcast("members"); return ok(id(c));
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
    `$r = Invoke-RestMethod -Method Post -Uri ${ps(`${c.url.origin}/api/shares/${share.id}/folders?realm=${encodeURIComponent(c.realm.slug)}`)} -Headers @{ 'X-Share-Key' = ${ps(share.uploadKey)} } -ContentType 'application/json; charset=utf-8' -Body $body`,
    `Write-Host ''; Write-Host ('Fertig! ' + $r.folders + ' Ordner gemeldet, ' + $r.added + ' neue Spiele.') -ForegroundColor Green`,
  );
  // Als ein Block, damit auch zeilenweises Einfügen in die Konsole als Ganzes läuft
  const script = "& {\r\n" + lines.map(l => "  " + l).join("\r\n") + "\r\n}\r\n";
  return new Response(script, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
});

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
      const r = await fetch(`https://discord.com/api/guilds/${cfg.guildId}/widget.json`, { cf: { cacheTtl: 20 } } as RequestInit);
      if (r.ok) {
        const w = await r.json() as any;
        const member = (m: any) => ({ name: m.username, status: m.status, avatar: m.avatar_url ?? null, game: m.activity?.name ?? null,
          muted: !!(m.mute || m.self_mute), deafened: !!(m.deaf || m.self_deaf) });
        const all = (w.members ?? []) as any[];
        // Sprachkanäle mit ihren Leuten, in Discord-Reihenfolge; Kanäle, die das Widget nicht nennt, gesammelt
        const known = new Map<string, { name: string; position: number }>((w.channels ?? []).map((ch: any) => [ch.id, { name: ch.name, position: ch.position ?? 0 }]));
        const groups = new Map<string, any[]>();
        for (const m of all) if (m.channel_id) (groups.get(m.channel_id) ?? groups.set(m.channel_id, []).get(m.channel_id)!).push(member(m));
        const voice = [...groups.entries()].map(([id, members]) => ({ id, name: known.get(id)?.name ?? "Privater Sprachkanal", position: known.get(id)?.position ?? 999, members }))
          .sort((a, b) => a.position - b.position);
        widget = { name: w.name, presenceCount: w.presence_count, instantInvite: w.instant_invite, voice,
          inVoice: voice.reduce((n, ch) => n + ch.members.length, 0),
          online: all.filter(m => !m.channel_id).slice(0, 100).map(member), listedOnline: all.length };
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

// ---------------- Turniere
const tour = (c: Ctx) => new Tournaments(c.db);
const requireTourManager = async (c: Ctx) => { if (!(await tour(c).canManage(id(c), session(c).member.id, isAdmin(c)))) throw new Forbidden("Nur wer das Turnier angelegt hat oder ein Admin darf das"); };
get("/api/tournaments", async c => tour(c).list(c.url.searchParams.get("all") ? null : (await c.repo.ensureCurrentEvent()).id));
get("/api/tournaments/{id}", async c => tour(c).get(id(c)));
post("/api/tournaments", async c => { const t = await tour(c).create((await c.repo.ensureCurrentEvent()).id, await c.body(), session(c).member.id); await c.broadcast("tournaments"); return t; });
put("/api/tournaments/{id}", async c => { await requireTourManager(c); const t = await tour(c).update(id(c), await c.body()); await c.broadcast("tournaments"); return t; });
del("/api/tournaments/{id}", async c => { await requireTourManager(c); await tour(c).remove(id(c)); await c.broadcast("tournaments"); await c.broadcast("members"); return ok(); });
post("/api/tournaments/{id}/start", async c => { await requireTourManager(c); const t = await tour(c).start(id(c)); await c.broadcast("tournaments"); return t; });
post("/api/tournaments/{id}/next-round", async c => { await requireTourManager(c); const t = await tour(c).nextRound(id(c)); await c.broadcast("tournaments"); return t; });
put("/api/tournaments/{id}/matches/{mid}", async c => {
  const mid = Number(c.params.mid);
  if (!(await tour(c).canReport(id(c), mid, session(c).member.id, isAdmin(c)))) throw new Forbidden("Ergebnisse tragen Turnierleitung, Admins oder die beteiligten Spieler ein");
  const r = await c.body<{ scoreA: number | null; scoreB: number | null }>();
  const t = await tour(c).report(id(c), mid, r.scoreA == null ? null : Number(r.scoreA), r.scoreB == null ? null : Number(r.scoreB));
  await c.broadcast("tournaments"); if (t.status === "done") await c.broadcast("members");
  return t;
});

// ---------------- Steam
get("/api/steam/search", async c => { try { return await steamSearch(c.url.searchParams.get("q") ?? ""); } catch (e) { throw new BadRequest(`Steam nicht erreichbar: ${(e as Error).message}`); } });
get("/api/steam/app/{id}", async c => { let d; try { d = await steamDetails(id(c)); } catch (e) { throw new BadRequest(`Steam nicht erreichbar: ${(e as Error).message}`); } if (!d) throw new NotFound("Steam-App nicht gefunden"); return d; });
get("/api/steam/parse", async c => { const a = steamAppIdFromUrl(c.url.searchParams.get("url") ?? ""); if (!a) throw new BadRequest("Keine Steam-App-ID im Link gefunden"); return { appId: a }; });

// ---------------- Dispatcher (läuft im Durable Object des Realms)
export interface RealmInfo { slug: string; name: string; kind: "lan" | "online" }

export async function handleApi(req: Request, env: Env, db: Db, realm: RealmInfo, auth: AuthInfo | null, publish: (msg: string) => void): Promise<Response> {
  const url = new URL(req.url);
  const repo = new Repo(db, realm.slug);
  const sess = await resolveMember(db, auth);
  const isAvatarGet = req.method === "GET" && (/^\/api\/members\/\d+\/avatar$/.test(url.pathname) || /^\/api\/sounds(\/\w+)?$/.test(url.pathname) || /^\/api\/media\/\d+$/.test(url.pathname));
  const isFolderUpload = (req.method === "POST" && /^\/api\/shares\/\d+\/folders$/.test(url.pathname)) || (req.method === "GET" && /^\/api\/shares\/\d+\/setup\.ps1$/.test(url.pathname));
  if (!sess && !PUBLIC.has(url.pathname) && !isAvatarGet && !isFolderUpload) return json({ error: "Bitte anmelden" }, 401);

  const broadcast = async (topic: string, payload?: unknown) => {
    await repo.touch(topic);
    publish(JSON.stringify({ type: "change", topic, ts: Date.now(), ...(payload !== undefined ? { payload } : {}) }));
  };
  const ctx: Ctx = { req, env, db, repo, realm, auth, session: sess, params: {}, url, body: async () => { try { return await req.json(); } catch { throw new BadRequest("Ungültiges JSON"); } }, broadcast };

  try {
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = r.pattern.exec(url.pathname);
      if (!m) continue;
      r.keys.forEach((k, i) => (ctx.params[k] = decodeURIComponent(m[i + 1])));
      if (realm.kind !== "lan" && LAN_ONLY.some(p => url.pathname.startsWith(p))) throw new BadRequest("In diesem Realm sind die LAN-Funktionen ausgeschaltet");
      const result = await r.handler(ctx);
      return result instanceof Response ? result : json(result);
    }
    return json({ error: "Unbekannter Endpunkt" }, 404);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: (e as Error).message || "Interner Fehler" }, 500);
  }
}
