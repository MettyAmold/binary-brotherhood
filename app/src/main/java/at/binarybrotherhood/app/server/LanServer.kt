package at.binarybrotherhood.app.server

import android.content.Context
import android.util.Log
import at.binarybrotherhood.app.BuildConfig
import at.binarybrotherhood.app.data.AppDatabase
import at.binarybrotherhood.app.domain.AuthService
import at.binarybrotherhood.app.domain.BadRequestException
import at.binarybrotherhood.app.domain.ForbiddenException
import at.binarybrotherhood.app.domain.NotFoundException
import at.binarybrotherhood.app.domain.Repository
import at.binarybrotherhood.app.domain.UnauthorizedException
import at.binarybrotherhood.app.util.NetUtils
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.PartData
import io.ktor.http.content.forEachPart
import io.ktor.serialization.kotlinx.json.json
import io.ktor.server.application.Application
import io.ktor.server.application.ApplicationCall
import io.ktor.server.application.ApplicationCallPipeline
import io.ktor.server.application.call
import io.ktor.server.application.install
import io.ktor.server.cio.CIO
import io.ktor.server.engine.EmbeddedServer
import io.ktor.server.engine.embeddedServer
import io.ktor.server.plugins.contentnegotiation.ContentNegotiation
import io.ktor.server.plugins.statuspages.StatusPages
import io.ktor.server.request.httpMethod
import io.ktor.server.request.path
import io.ktor.server.request.receive
import io.ktor.server.request.receiveMultipart
import io.ktor.server.request.uri
import io.ktor.server.response.header
import io.ktor.server.response.respond
import io.ktor.server.response.respondBytes
import io.ktor.server.response.respondFile
import io.ktor.server.response.respondRedirect
import io.ktor.server.response.respondText
import io.ktor.server.routing.delete
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.put
import io.ktor.server.routing.route
import io.ktor.server.routing.routing
import io.ktor.server.websocket.DefaultWebSocketServerSession
import io.ktor.server.websocket.WebSockets
import io.ktor.server.websocket.pingPeriod
import io.ktor.server.websocket.timeout
import io.ktor.server.websocket.webSocket
import io.ktor.util.AttributeKey
import io.ktor.utils.io.jvm.javaio.toInputStream
import io.ktor.websocket.Frame
import io.ktor.websocket.readText
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.util.Collections
import java.util.concurrent.ConcurrentHashMap
import java.util.zip.CRC32
import kotlin.time.Duration.Companion.seconds

/**
 * Der eingebettete HTTP-/WebSocket-Server. Liefert die Web-App aus den Assets aus,
 * stellt die REST-API bereit und schickt Änderungen per WebSocket an alle Clients.
 */
class LanServer(private val context: Context, val port: Int = DEFAULT_PORT) {

    companion object {
        const val DEFAULT_PORT = 8080
        private const val TAG = "LanServer"
        private val SessionKey = AttributeKey<AuthService.Session>("bb.session")
        /** Endpunkte, die ohne Login erreichbar sind (Login-Bildschirm, Avatare). */
        private val PUBLIC_PATHS = setOf("/api/auth/members", "/api/auth/login", "/api/auth/register", "/api/ping")
        private val AVATAR_PATH = Regex("""/api/members/\d+/avatar""")
        private val LOOPBACK = setOf("127.0.0.1", "::1", "0:0:0:0:0:0:0:1", "localhost")
    }

    private val repo = Repository(context)
    private val auth = AuthService(AppDatabase.get(context))
    private val steam = SteamClient()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true; explicitNulls = false }
    private val sessions = Collections.synchronizedSet(mutableSetOf<DefaultWebSocketServerSession>())
    private var engine: EmbeddedServer<*, *>? = null
    private var scanJob: Job? = null

    private val _clientCount = MutableStateFlow(0)
    val clientCount: StateFlow<Int> = _clientCount

    fun start() {
        if (engine != null) return
        scope.launch {
            runCatching { repo.ensureCurrentEvent(); repo.seedDefaultEquipmentIfEmpty() }.onFailure { Log.e(TAG, "seed", it) }
        }
        engine = embeddedServer(CIO, port = port, host = "0.0.0.0") { module() }.also { it.start(wait = false) }
        // Freigaben kurz nach dem Start und danach alle 15 Minuten neu einlesen
        scanJob = scope.launch {
            delay(5_000)
            while (isActive) {
                runCatching { if (repo.scanAll().any { it.added > 0 }) { broadcast("games"); broadcast("shares") } }
                    .onFailure { Log.w(TAG, "Freigaben-Scan", it) }
                delay(15 * 60_000)
            }
        }
        Log.i(TAG, "Server gestartet auf Port $port")
    }

    /** Export für den Umzug in die Cloud (wird vom Host-Panel in den Download-Ordner geschrieben). */
    suspend fun exportJson(): String = repo.exportAll().toString()

    fun stop() {
        scanJob?.cancel(); scanJob = null
        engine?.stop(500, 1500)
        engine = null
        sessions.clear()
        _clientCount.value = 0
        Log.i(TAG, "Server gestoppt")
    }

    /** Schickt eine Änderungsmeldung an alle verbundenen Browser. */
    fun broadcast(topic: String, payload: JsonElement? = null) {
        val msg = buildJsonObject {
            put("type", "change")
            put("topic", topic)
            put("ts", System.currentTimeMillis())
            if (payload != null) put("payload", payload)
        }.toString()
        val targets = synchronized(sessions) { sessions.toList() }
        targets.forEach { s ->
            scope.launch {
                runCatching { s.send(Frame.Text(msg)) }.onFailure { sessions.remove(s); _clientCount.value = sessions.size }
            }
        }
    }

    private fun Application.module() {
        install(ContentNegotiation) { json(json) }
        install(WebSockets) { pingPeriod = 20.seconds; timeout = 60.seconds }
        install(StatusPages) {
            exception<BadRequestException> { call, e -> call.respond(HttpStatusCode.BadRequest, ErrorDto(e.message ?: "Ungültige Anfrage")) }
            exception<NotFoundException> { call, e -> call.respond(HttpStatusCode.NotFound, ErrorDto(e.message ?: "Nicht gefunden")) }
            exception<UnauthorizedException> { call, e -> call.respond(HttpStatusCode.Unauthorized, ErrorDto(e.message ?: "Bitte anmelden")) }
            exception<ForbiddenException> { call, e -> call.respond(HttpStatusCode.Forbidden, ErrorDto(e.message ?: "Keine Berechtigung")) }
            exception<Throwable> { call, e ->
                Log.e(TAG, "Fehler bei ${call.request.local.uri}", e)
                call.respond(HttpStatusCode.InternalServerError, ErrorDto(e.message ?: "Interner Fehler"))
            }
        }

        // Langsame Anfragen protokollieren (Diagnose per logcat)
        intercept(ApplicationCallPipeline.Monitoring) {
            val t0 = System.nanoTime()
            try {
                proceed()
            } finally {
                val ms = (System.nanoTime() - t0) / 1_000_000
                if (ms > 300) Log.w(TAG, "Langsam: ${call.request.httpMethod.value} ${call.request.uri} (${ms} ms)")
            }
        }

        // Login-Pflicht für die API: Token aus dem Authorization-Header auflösen
        intercept(ApplicationCallPipeline.Plugins) {
            val path = call.request.path()
            if (!path.startsWith("/api/")) return@intercept
            val token = call.request.headers["Authorization"]?.removePrefix("Bearer")?.trim()
            val session = auth.resolve(token)
            if (session != null) {
                call.attributes.put(SessionKey, session)
            } else if (path !in PUBLIC_PATHS && !(call.request.httpMethod == io.ktor.http.HttpMethod.Get && AVATAR_PATH.matches(path))) {
                call.respond(HttpStatusCode.Unauthorized, ErrorDto("Bitte anmelden"))
                finish()
            }
        }

        routing {
            webSocket("/ws") {
                sessions.add(this)
                _clientCount.value = sessions.size
                try {
                    send(Frame.Text(buildJsonObject { put("type", "hello"); put("clients", sessions.size) }.toString()))
                    for (frame in incoming) {
                        if (frame is Frame.Text && frame.readText() == "ping") send(Frame.Text("""{"type":"pong"}"""))
                    }
                } finally {
                    sessions.remove(this)
                    _clientCount.value = sessions.size
                }
            }

            route("/api") { api() }

            // Web-App aus den Assets
            get("/") { call.serveAsset("index.html") }
            get("/{path...}") {
                val path = call.parameters.getAll("path")?.joinToString("/") ?: ""
                if (path.startsWith("api/")) {
                    call.respond(HttpStatusCode.NotFound, ErrorDto("Unbekannter Endpunkt"))
                } else if (!call.serveAsset(path)) {
                    call.serveAsset("index.html")
                }
            }
        }
    }

    private class Asset(val bytes: ByteArray, val type: ContentType, val etag: String)
    private val assetCache = ConcurrentHashMap<String, Asset>()

    /** Lädt eine Web-Datei einmal aus den Assets und hält sie samt ETag im Speicher. */
    private fun asset(clean: String): Asset? = assetCache[clean] ?: run {
        val bytes = runCatching { context.assets.open("web/$clean").use { it.readBytes() } }.getOrNull() ?: return null
        val crc = CRC32().apply { update(bytes) }.value
        Asset(bytes, contentTypeFor(clean), "\"${java.lang.Long.toHexString(crc)}-${bytes.size}\"").also { assetCache[clean] = it }
    }

    private suspend fun ApplicationCall.serveAsset(path: String): Boolean {
        val clean = path.trimStart('/').ifBlank { "index.html" }
        if (clean.contains("..")) return false
        val a = asset(clean) ?: return false
        val longLived = clean.startsWith("fonts/") || clean.startsWith("img/") || clean.endsWith(".png")
        response.header("Cache-Control", if (longLived) "public, max-age=604800" else "public, max-age=60, must-revalidate")
        response.header("ETag", a.etag)
        if (request.headers["If-None-Match"]?.split(",")?.any { it.trim() == a.etag } == true) {
            respond(HttpStatusCode.NotModified)
            return true
        }
        respondBytes(a.bytes, a.type)
        return true
    }

    private fun contentTypeFor(clean: String): ContentType {
        return when (clean.substringAfterLast('.', "").lowercase()) {
            "html" -> ContentType.Text.Html
            "css" -> ContentType.Text.CSS
            "js", "mjs" -> ContentType.Text.JavaScript
            "json" -> ContentType.Application.Json
            "png" -> ContentType.Image.PNG
            "jpg", "jpeg" -> ContentType.Image.JPEG
            "svg" -> ContentType.Image.SVG
            "ico" -> ContentType("image", "x-icon")
            "ttf" -> ContentType("font", "ttf")
            "woff2" -> ContentType("font", "woff2")
            "webmanifest" -> ContentType("application", "manifest+json")
            else -> ContentType.Application.OctetStream
        }
    }

    private fun ApplicationCall.session(): AuthService.Session = attributes.getOrNull(SessionKey) ?: throw UnauthorizedException("Bitte anmelden")
    private fun ApplicationCall.actor(): Long? = attributes.getOrNull(SessionKey)?.member?.id
    /** Der Host ist die App selbst (WebView über 127.0.0.1); nur sie darf Passwörter zurücksetzen. */
    private fun ApplicationCall.isHost(): Boolean = runCatching { request.local.remoteAddress }.getOrNull() in LOOPBACK
    private fun ApplicationCall.requireSelfOrHost(memberId: Long) {
        if (session().member.id != memberId && !isHost()) throw ForbiddenException("Nur das eigene Profil kann bearbeitet werden")
    }
    private fun ApplicationCall.requireHost() { if (!isHost()) throw ForbiddenException("Nur der Host darf das") }
    private fun ApplicationCall.id(name: String = "id"): Long = parameters[name]?.toLongOrNull() ?: throw BadRequestException("Ungültige ID")
    private fun ApplicationCall.eventId(): Long? = request.queryParameters["eventId"]?.toLongOrNull()

    private fun io.ktor.server.routing.Route.api() {
        get("/bootstrap") {
            val ev = repo.currentEvent()
            call.respond(
                BootstrapDto(
                    event = EventDto(ev.id, ev.name, ev.year, ev.startDate, ev.days, ev.isCurrent),
                    events = repo.events(), members = repo.members(), serverTime = System.currentTimeMillis(), appName = "BINARY BROTHERHOOD",
                )
            )
        }
        get("/host") {
            call.respond(HostInfoDto(NetUtils.localAddresses(context), port, sessions.size, BuildConfig.VERSION_NAME, repo.dbPath))
        }
        get("/export") { call.requireHost(); call.respondText(repo.exportAll().toString(), ContentType.Application.Json) }

        // ---- Login
        route("/auth") {
            get("/members") { call.respond(repo.authMembers()) }
            post("/login") {
                val r = call.receive<LoginRequest>()
                val (m, token) = auth.login(r.memberId, r.password, call.request.headers["User-Agent"] ?: "")
                broadcast("members")
                call.respond(AuthResponseDto(token, repo.member(m.id), call.isHost()))
            }
            post("/register") {
                val r = call.receive<RegisterRequest>()
                auth.validatePassword(r.password)
                val m = repo.createMember(MemberRequest(name = r.name, color = r.color))
                auth.setPassword(m.id, r.password)
                val token = auth.issueToken(m.id, call.request.headers["User-Agent"] ?: "")
                broadcast("members")
                call.respond(AuthResponseDto(token, repo.member(m.id), call.isHost()))
            }
            get("/me") { val s = call.session(); call.respond(AuthStateDto(repo.member(s.member.id), call.isHost())) }
            post("/logout") { auth.logout(call.session().tokenHash); call.respond(OkDto()) }
            post("/password") {
                val s = call.session()
                val r = call.receive<PasswordChangeRequest>()
                auth.changePassword(s.member.id, r.oldPassword, r.newPassword)
                val token = auth.issueToken(s.member.id, call.request.headers["User-Agent"] ?: "")
                call.respond(AuthResponseDto(token, repo.member(s.member.id), call.isHost()))
            }
            post("/reset/{id}") { call.requireHost(); auth.resetPassword(call.id()); broadcast("members"); call.respond(OkDto()) }
        }

        // ---- Mitglieder
        route("/members") {
            get { call.respond(repo.members()) }
            post { call.respond(repo.createMember(call.receive()).also { broadcast("members") }) }
            get("/{id}") { call.respond(repo.member(call.id())) }
            put("/{id}") { call.requireSelfOrHost(call.id()); call.respond(repo.updateMember(call.id(), call.receive()).also { broadcast("members") }) }
            delete("/{id}") { call.requireSelfOrHost(call.id()); repo.deleteMember(call.id()); broadcast("members"); call.respond(OkDto()) }
            get("/{id}/xp") { call.respond(repo.xpLog(call.id())) }
            get("/{id}/avatar") {
                val f = repo.avatarFile(call.id())
                if (f.exists()) {
                    call.response.header("Cache-Control", "public, max-age=3600")
                    call.respondFile(f)
                } else call.respondRedirect("/img/avatar-default.svg")
            }
            post("/{id}/avatar") {
                val id = call.id()
                call.requireSelfOrHost(id)
                var bytes: ByteArray? = null
                val ct = call.request.headers["Content-Type"] ?: ""
                if (ct.startsWith("multipart/")) {
                    call.receiveMultipart().forEachPart { part ->
                        if (part is PartData.FileItem && bytes == null) bytes = part.provider().toInputStream().readBytes()
                        part.dispose()
                    }
                } else {
                    bytes = call.receive<ByteArray>()
                }
                val data = bytes ?: throw BadRequestException("Kein Bild übermittelt")
                if (data.size > 6_000_000) throw BadRequestException("Bild ist zu groß (max. 6 MB)")
                repo.setAvatar(id, data)
                broadcast("members")
                call.respond(OkDto(id = id))
            }
        }

        // ---- Spiele
        route("/games") {
            get { call.respond(repo.games()) }
            post { call.respond(repo.createGame(call.receive(), call.actor()).also { broadcast("games") }) }
            put("/{id}") { call.respond(repo.updateGame(call.id(), call.receive()).also { broadcast("games") }) }
            delete("/{id}") { repo.deleteGame(call.id()); broadcast("games"); call.respond(OkDto()) }
            post("/{id}/select") { repo.selectGame(call.id(), call.receive<SelectRequest>().selected); broadcast("games"); call.respond(OkDto()) }
        }

        // ---- Windows-Freigaben mit Spielordnern
        route("/shares") {
            get { call.respond(repo.shares()) }
            post { call.respond(repo.createShare(call.receive(), call.actor()).also { broadcast("shares") }) }
            delete("/{id}") { repo.deleteShare(call.id(), call.session().member.id, call.isHost()); broadcast("shares"); broadcast("games"); call.respond(OkDto()) }
            post("/scan") { val r = repo.scanAll(); broadcast("games"); broadcast("shares"); call.respond(r) }
            post("/test") { call.respond(repo.testShare(call.receive())) }
            post("/browse") { call.respond(repo.browse(call.receive())) }
            get("/wizard") {
                val ip = runCatching { call.request.local.remoteAddress }.getOrDefault("")
                call.respond(ShareWizardDto(clientIp = ip, clientIsHostPhone = ip in LOOPBACK, hostAddresses = NetUtils.localAddresses(context)))
            }
            post("/{id}/scan") { val r = repo.scanShare(call.id()); broadcast("games"); broadcast("shares"); call.respond(r) }
        }

        // ---- Runden (aktuell gespielt + Historie)
        route("/sessions") {
            get { call.respond(repo.sessions(call.eventId())) }
            post { call.respond(repo.startSession(call.receive()).also { broadcast("sessions"); broadcast("games") }) }
            put("/{id}") {
                val req = call.receive<SessionUpdateRequest>()
                call.respond(repo.updateSession(call.id(), req.participantIds, req.note).also { broadcast("sessions"); broadcast("members") })
            }
            post("/{id}/end") { call.respond(repo.endSession(call.id()).also { broadcast("sessions") }) }
            delete("/{id}") { repo.deleteSession(call.id()); broadcast("sessions"); broadcast("games"); call.respond(OkDto()) }
        }

        // ---- Glücksrad
        route("/wheel") {
            get("/state") { repo.lastSpin?.let { call.respond(it) } ?: call.respond(HttpStatusCode.NoContent) }
            post("/spin") {
                val req = call.receive<SpinRequest>()
                val spin = repo.spin(req.excludePlayed, req.onlySelected, call.actor())
                broadcast("wheel", json.parseToJsonElement(json.encodeToString(spin)))
                call.respond(spin)
            }
        }

        // ---- Abstimmung
        route("/polls") {
            get("/current") { repo.currentPoll()?.let { call.respond(it) } ?: call.respond(HttpStatusCode.NoContent) }
            post { call.respond(repo.openPoll().also { broadcast("poll") }) }
            post("/{id}/vote") { call.respond(repo.votePoll(call.id(), call.actor(), call.receive<PollVoteRequest>().gameId).also { broadcast("poll") }) }
            post("/{id}/close") { call.respond(repo.closePoll(call.id()).also { broadcast("poll") }) }
        }

        // ---- Vorschläge
        route("/suggestions") {
            get { call.respond(repo.suggestions(call.actor())) }
            post { call.respond(repo.createSuggestion(call.receive(), call.actor()).also { broadcast("suggestions") }) }
            put("/{id}") { call.respond(repo.updateSuggestion(call.id(), call.receive(), call.actor()).also { broadcast("suggestions") }) }
            delete("/{id}") { repo.deleteSuggestion(call.id()); broadcast("suggestions"); call.respond(OkDto()) }
            post("/{id}/vote") { repo.voteSuggestion(call.id(), call.actor(), call.receive<VoteRequest>().value); broadcast("suggestions"); call.respond(OkDto()) }
            post("/{id}/comments") { repo.commentSuggestion(call.id(), call.actor(), call.receive<CommentRequest>().text); broadcast("suggestions"); call.respond(OkDto()) }
            delete("/comments/{id}") { repo.deleteSuggestionComment(call.id()); broadcast("suggestions"); call.respond(OkDto()) }
            post("/{id}/adopt") { call.respond(repo.adoptSuggestion(call.id(), call.actor()).also { broadcast("suggestions"); broadcast("games") }) }
        }

        // ---- Forum
        route("/forum") {
            get { call.respond(repo.forum()) }
            post { call.respond(repo.createPost(call.receive(), call.actor()).also { broadcast("forum") }) }
            put("/{id}") { call.respond(repo.updatePost(call.id(), call.receive()).also { broadcast("forum") }) }
            delete("/{id}") { repo.deletePost(call.id()); broadcast("forum"); call.respond(OkDto()) }
            post("/{id}/comments") { repo.commentPost(call.id(), call.actor(), call.receive<CommentRequest>().text); broadcast("forum"); call.respond(OkDto()) }
            delete("/comments/{id}") { repo.deleteForumComment(call.id()); broadcast("forum"); call.respond(OkDto()) }
        }

        // ---- LAN-Party-Ausgaben
        route("/events") {
            get { call.respond(repo.events()) }
            post { call.respond(repo.createEvent(call.receive()).also { broadcast("events"); broadcast("equipment"); broadcast("suggestions") }) }
            put("/{id}") { call.respond(repo.updateEvent(call.id(), call.receive()).also { broadcast("events") }) }
            post("/{id}/activate") { repo.activateEvent(call.id()); broadcast("events"); call.respond(OkDto()) }
            delete("/{id}") { repo.deleteEvent(call.id()); broadcast("events"); call.respond(OkDto()) }
        }

        // ---- Kosten
        route("/costs") {
            get { call.respond(repo.costs(call.eventId())) }
            put("/attendance") { repo.setAttendance(call.eventId(), call.receive()); broadcast("costs"); broadcast("members"); call.respond(OkDto()) }
            post("/expenses") { call.respond(repo.createExpense(call.eventId(), call.receive()).also { broadcast("costs") }) }
            put("/expenses/{id}") { call.respond(repo.updateExpense(call.id(), call.receive()).also { broadcast("costs") }) }
            delete("/expenses/{id}") { repo.deleteExpense(call.id()); broadcast("costs"); call.respond(OkDto()) }
            post("/payments") { call.respond(repo.createPayment(call.eventId(), call.receive()).also { broadcast("costs") }) }
            delete("/payments/{id}") { repo.deletePayment(call.id()); broadcast("costs"); call.respond(OkDto()) }
        }

        // ---- Ausrüstung
        route("/equipment") {
            get { call.respond(repo.equipment(call.eventId())) }
            post { call.respond(repo.createEquipment(call.eventId(), call.receive()).also { broadcast("equipment") }) }
            put("/{id}") { call.respond(repo.updateEquipment(call.id(), call.receive()).also { broadcast("equipment") }) }
            delete("/{id}") { repo.deleteEquipment(call.id()); broadcast("equipment"); call.respond(OkDto()) }
            post("/{id}/claim") { call.respond(repo.claimEquipment(call.id(), call.receive<ClaimRequest>().memberId).also { broadcast("equipment") }) }
            post("/{id}/done") { call.respond(repo.setEquipmentDone(call.id(), call.receive<DoneRequest>().done).also { broadcast("equipment"); broadcast("members") }) }
            post("/template") {
                val n = repo.applyEquipmentTemplate(call.receive<TemplateRequest>().fromEventId)
                broadcast("equipment")
                call.respond(OkDto(id = n.toLong()))
            }
        }

        // ---- Steam (Proxy, damit der Browser keine CORS-Probleme hat)
        route("/steam") {
            get("/search") {
                val q = call.request.queryParameters["q"] ?: ""
                val result = runCatching { steam.search(q) }.getOrElse {
                    Log.w(TAG, "Steam-Suche fehlgeschlagen", it)
                    throw BadRequestException("Steam nicht erreichbar (Host-Handy braucht Internet): ${it.message ?: it.javaClass.simpleName}")
                }
                call.respond(result)
            }
            get("/app/{id}") {
                val id = call.id()
                val d = runCatching { steam.details(id) }.getOrElse {
                    Log.w(TAG, "Steam-Details fehlgeschlagen", it)
                    throw BadRequestException("Steam nicht erreichbar (Host-Handy braucht Internet): ${it.message ?: it.javaClass.simpleName}")
                }
                d?.let { call.respond(it) } ?: call.respond(HttpStatusCode.NotFound, ErrorDto("Steam-App nicht gefunden"))
            }
            get("/parse") {
                val url = call.request.queryParameters["url"] ?: ""
                val id = SteamClient.appIdFromUrl(url) ?: throw BadRequestException("Keine Steam-App-ID im Link gefunden")
                call.respond(buildJsonObject { put("appId", id) })
            }
        }

        get("/ping") { call.respondText("pong") }
    }
}

