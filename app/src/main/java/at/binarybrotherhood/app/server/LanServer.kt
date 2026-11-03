package at.binarybrotherhood.app.server

import android.content.Context
import android.util.Log
import at.binarybrotherhood.app.BuildConfig
import at.binarybrotherhood.app.domain.BadRequestException
import at.binarybrotherhood.app.domain.NotFoundException
import at.binarybrotherhood.app.domain.Repository
import at.binarybrotherhood.app.util.NetUtils
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.PartData
import io.ktor.http.content.forEachPart
import io.ktor.serialization.kotlinx.json.json
import io.ktor.server.application.Application
import io.ktor.server.application.ApplicationCall
import io.ktor.server.application.install
import io.ktor.server.cio.CIO
import io.ktor.server.engine.EmbeddedServer
import io.ktor.server.engine.embeddedServer
import io.ktor.server.plugins.contentnegotiation.ContentNegotiation
import io.ktor.server.plugins.statuspages.StatusPages
import io.ktor.server.request.receive
import io.ktor.server.request.receiveMultipart
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
import io.ktor.utils.io.jvm.javaio.toInputStream
import io.ktor.websocket.Frame
import io.ktor.websocket.readText
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.util.Collections
import kotlin.time.Duration.Companion.seconds

/**
 * Der eingebettete HTTP-/WebSocket-Server. Liefert die Web-App aus den Assets aus,
 * stellt die REST-API bereit und schickt Änderungen per WebSocket an alle Clients.
 */
class LanServer(private val context: Context, val port: Int = DEFAULT_PORT) {

    companion object {
        const val DEFAULT_PORT = 8080
        private const val TAG = "LanServer"
    }

    private val repo = Repository(context)
    private val steam = SteamClient()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true; explicitNulls = false }
    private val sessions = Collections.synchronizedSet(mutableSetOf<DefaultWebSocketServerSession>())
    private var engine: EmbeddedServer<*, *>? = null

    private val _clientCount = MutableStateFlow(0)
    val clientCount: StateFlow<Int> = _clientCount

    fun start() {
        if (engine != null) return
        scope.launch {
            runCatching { repo.ensureCurrentEvent(); repo.seedDefaultEquipmentIfEmpty() }.onFailure { Log.e(TAG, "seed", it) }
        }
        engine = embeddedServer(CIO, port = port, host = "0.0.0.0") { module() }.also { it.start(wait = false) }
        Log.i(TAG, "Server gestartet auf Port $port")
    }

    fun stop() {
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
            exception<Throwable> { call, e ->
                Log.e(TAG, "Fehler bei ${call.request.local.uri}", e)
                call.respond(HttpStatusCode.InternalServerError, ErrorDto(e.message ?: "Interner Fehler"))
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

    private suspend fun ApplicationCall.serveAsset(path: String): Boolean {
        val clean = path.trimStart('/').ifBlank { "index.html" }
        if (clean.contains("..")) return false
        val bytes = runCatching { context.assets.open("web/$clean").use { it.readBytes() } }.getOrNull() ?: return false
        val type = when (clean.substringAfterLast('.', "").lowercase()) {
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
        val cacheable = clean.startsWith("fonts/") || clean.endsWith(".png")
        response.header("Cache-Control", if (cacheable) "public, max-age=86400" else "no-cache")
        respondBytes(bytes, type)
        return true
    }

    private fun ApplicationCall.actor(): Long? = request.headers["X-Member-Id"]?.toLongOrNull()
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

        // ---- Mitglieder
        route("/members") {
            get { call.respond(repo.members()) }
            post { call.respond(repo.createMember(call.receive()).also { broadcast("members") }) }
            get("/{id}") { call.respond(repo.member(call.id())) }
            put("/{id}") { call.respond(repo.updateMember(call.id(), call.receive()).also { broadcast("members") }) }
            delete("/{id}") { repo.deleteMember(call.id()); broadcast("members"); call.respond(OkDto()) }
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
                val result = runCatching { steam.search(q) }.getOrElse { throw BadRequestException("Steam nicht erreichbar (Host-Handy braucht Internet)") }
                call.respond(result)
            }
            get("/app/{id}") {
                val id = call.id()
                val d = runCatching { steam.details(id) }.getOrElse { throw BadRequestException("Steam nicht erreichbar (Host-Handy braucht Internet)") }
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

