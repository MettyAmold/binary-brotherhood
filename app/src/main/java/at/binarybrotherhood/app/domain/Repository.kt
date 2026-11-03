package at.binarybrotherhood.app.domain

import android.content.Context
import at.binarybrotherhood.app.data.AppDatabase
import at.binarybrotherhood.app.data.AttendanceEntity
import at.binarybrotherhood.app.data.EquipmentEntity
import at.binarybrotherhood.app.data.EventEntity
import at.binarybrotherhood.app.data.ExpenseEntity
import at.binarybrotherhood.app.data.ExpenseShareEntity
import at.binarybrotherhood.app.data.ForumCommentEntity
import at.binarybrotherhood.app.data.ForumPostEntity
import at.binarybrotherhood.app.data.GameEntity
import at.binarybrotherhood.app.data.MemberEntity
import at.binarybrotherhood.app.data.PaymentEntity
import at.binarybrotherhood.app.data.PollEntity
import at.binarybrotherhood.app.data.PollVoteEntity
import at.binarybrotherhood.app.data.SessionEntity
import at.binarybrotherhood.app.data.SessionParticipantEntity
import at.binarybrotherhood.app.data.ShareEntity
import at.binarybrotherhood.app.data.SuggestionCommentEntity
import at.binarybrotherhood.app.data.SuggestionEntity
import at.binarybrotherhood.app.data.SuggestionVoteEntity
import at.binarybrotherhood.app.data.XpLogEntity
import at.binarybrotherhood.app.server.AttendanceRequest
import at.binarybrotherhood.app.server.AuthMemberDto
import at.binarybrotherhood.app.server.BalanceDto
import at.binarybrotherhood.app.server.CommentDto
import at.binarybrotherhood.app.server.CostOverviewDto
import at.binarybrotherhood.app.server.EquipmentDto
import at.binarybrotherhood.app.server.EquipmentRequest
import at.binarybrotherhood.app.server.EventDto
import at.binarybrotherhood.app.server.EventRequest
import at.binarybrotherhood.app.server.ExpenseDto
import at.binarybrotherhood.app.server.ExpenseRequest
import at.binarybrotherhood.app.server.ForumPostDto
import at.binarybrotherhood.app.server.ForumPostRequest
import at.binarybrotherhood.app.server.GameDto
import at.binarybrotherhood.app.server.GameRequest
import at.binarybrotherhood.app.server.MemberDto
import at.binarybrotherhood.app.server.MemberRequest
import at.binarybrotherhood.app.server.MemberStatsDto
import at.binarybrotherhood.app.server.ParticipantDto
import at.binarybrotherhood.app.server.PaymentDto
import at.binarybrotherhood.app.server.PaymentRequest
import at.binarybrotherhood.app.server.PollDto
import at.binarybrotherhood.app.server.PollVoteDto
import at.binarybrotherhood.app.server.SessionDto
import at.binarybrotherhood.app.server.SessionRequest
import at.binarybrotherhood.app.server.NetworkShareDto
import at.binarybrotherhood.app.server.ShareRequest
import at.binarybrotherhood.app.server.ShareScanDto
import at.binarybrotherhood.app.server.ShareDto
import at.binarybrotherhood.app.server.SpinDto
import at.binarybrotherhood.app.server.SuggestionDto
import at.binarybrotherhood.app.server.SuggestionRequest
import at.binarybrotherhood.app.server.TransferDto
import at.binarybrotherhood.app.server.XpEntryDto
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.time.LocalDate
import kotlin.random.Random

class NotFoundException(msg: String) : RuntimeException(msg)
class BadRequestException(msg: String) : RuntimeException(msg)

/**
 * Zentrale Geschäftslogik. Alle Schreiboperationen laufen hier durch, damit XP-Vergabe und
 * Konsistenz an einer Stelle liegen. Der Server ruft nur diese Klasse auf.
 */
class Repository(private val context: Context, private val db: AppDatabase = AppDatabase.get(context)) {

    private val avatarDir: File get() = File(context.filesDir, "avatars").also { it.mkdirs() }
    fun avatarFile(memberId: Long): File = File(avatarDir, "$memberId.jpg")
    val dbPath: String get() = context.getDatabasePath("binary_brotherhood.db").absolutePath

    private fun now() = System.currentTimeMillis()

    private val palette = listOf(
        "#C9A24D", "#D96C4F", "#4FA3D9", "#6BBF59", "#B05ED9", "#E0B04C",
        "#48C9B0", "#E05C8A", "#8E9BFF", "#F08A24", "#5DD39E", "#D64545",
    )

    // ---------------------------------------------------------------- Events

    suspend fun ensureCurrentEvent(): EventEntity {
        db.events().current()?.let { return it }
        val year = LocalDate.now().year
        val id = db.events().insert(
            EventEntity(name = "LAN-Party $year", year = year, startDate = LocalDate.now().toString(), days = 3, isCurrent = true, createdAt = now())
        )
        return db.events().byId(id)!!
    }

    suspend fun currentEvent(): EventEntity = ensureCurrentEvent()

    suspend fun events(): List<EventDto> = db.events().all().map { it.toDto() }

    suspend fun createEvent(req: EventRequest): EventDto {
        if (req.name.isBlank()) throw BadRequestException("Name fehlt")
        val previous = db.events().current()
        val id = db.events().insert(
            EventEntity(name = req.name.trim(), year = req.year, startDate = req.startDate, days = req.days.coerceIn(1, 14), isCurrent = false, createdAt = now())
        )
        if (req.activate) {
            db.events().setCurrent(id)
            // Vorschläge "nächstes Jahr" werden zur aktuellen LAN
            db.suggestions().promoteNextToCurrent()
        }
        if (req.copyEquipment && previous != null) copyEquipment(previous.id, id)
        return db.events().byId(id)!!.toDto()
    }

    suspend fun updateEvent(id: Long, req: EventRequest): EventDto {
        val e = db.events().byId(id) ?: throw NotFoundException("Ausgabe nicht gefunden")
        db.events().update(e.copy(name = req.name.trim(), year = req.year, startDate = req.startDate, days = req.days.coerceIn(1, 14)))
        return db.events().byId(id)!!.toDto()
    }

    suspend fun activateEvent(id: Long) {
        db.events().byId(id) ?: throw NotFoundException("Ausgabe nicht gefunden")
        db.events().setCurrent(id)
    }

    suspend fun deleteEvent(id: Long) {
        val e = db.events().byId(id) ?: return
        if (e.isCurrent) throw BadRequestException("Die aktuelle Ausgabe kann nicht gelöscht werden")
        db.events().delete(id)
    }

    private fun EventEntity.toDto() = EventDto(id, name, year, startDate, days, isCurrent)

    // ---------------------------------------------------------------- Members

    suspend fun members(): List<MemberDto> {
        val xp = db.xp().all().groupBy { it.memberId }
        val sessions = db.sessions().all()
        val parts = db.sessions().allParticipants().groupBy { it.memberId }
        val games = db.games().all().associateBy { it.id }
        val posts = db.forum().posts().groupBy { it.authorId }
        val fComments = db.forum().comments().groupBy { it.authorId }
        val sComments = db.suggestions().allComments().groupBy { it.authorId }
        val suggestions = db.suggestions().all().groupBy { it.authorId }
        val event = currentEvent()
        val equipment = db.equipment().byEvent(event.id).filter { it.done && it.bringerId != null }.groupBy { it.bringerId }
        val expenses = db.costs().expenses(event.id).groupBy { it.paidById }
        val attendance = db.costs().attendance(event.id).groupBy { it.memberId }
        val sessionById = sessions.associateBy { it.id }

        return db.members().all().map { m ->
            val total = xp[m.id]?.sumOf { it.amount } ?: 0
            val lvl = Levels.forXp(total)
            val mySessions = parts[m.id]?.mapNotNull { sessionById[it.sessionId] } ?: emptyList()
            val favorite = mySessions.groupBy { it.gameId }.maxByOrNull { it.value.size }?.key?.let { games[it]?.name }
            MemberDto(
                id = m.id, name = m.name, motto = m.motto, color = m.color,
                hasAvatar = m.hasAvatar, avatarUrl = "/api/members/${m.id}/avatar?v=${m.createdAt}",
                xp = total, level = lvl.level, rank = lvl.rank,
                xpForCurrentLevel = lvl.xpForCurrentLevel, xpForNextLevel = lvl.xpForNextLevel, progress = lvl.progress,
                stats = MemberStatsDto(
                    gamesPlayed = mySessions.size,
                    forumPosts = posts[m.id]?.size ?: 0,
                    comments = (fComments[m.id]?.size ?: 0) + (sComments[m.id]?.size ?: 0),
                    suggestions = suggestions[m.id]?.size ?: 0,
                    equipmentBrought = equipment[m.id]?.size ?: 0,
                    expensesPaid = expenses[m.id]?.size ?: 0,
                    attendanceDays = attendance[m.id]?.size ?: 0,
                    favoriteGame = favorite,
                ),
                createdAt = m.createdAt,
            )
        }
    }

    suspend fun member(id: Long): MemberDto = members().firstOrNull { it.id == id } ?: throw NotFoundException("Mitglied nicht gefunden")

    /** Profilliste für den Login-Bildschirm, ohne Anmeldung abrufbar. */
    suspend fun authMembers(): List<AuthMemberDto> =
        db.members().all().map { AuthMemberDto(it.id, it.name, it.color, it.hasAvatar, it.password.isNotEmpty(), it.createdAt) }

    suspend fun createMember(req: MemberRequest): MemberDto {
        val name = req.name.trim()
        if (name.isBlank()) throw BadRequestException("Name fehlt")
        if (db.members().all().any { it.name.equals(name, ignoreCase = true) }) throw BadRequestException("Name ist bereits vergeben")
        val color = req.color?.takeIf { it.matches(Regex("#[0-9a-fA-F]{6}")) } ?: palette[Random.nextInt(palette.size)]
        val id = db.members().insert(MemberEntity(name = name, motto = req.motto.trim(), color = color, createdAt = now()))
        return member(id)
    }

    suspend fun updateMember(id: Long, req: MemberRequest): MemberDto {
        val m = db.members().byId(id) ?: throw NotFoundException("Mitglied nicht gefunden")
        val name = req.name.trim()
        if (name.isBlank()) throw BadRequestException("Name fehlt")
        if (db.members().all().any { it.id != id && it.name.equals(name, ignoreCase = true) }) throw BadRequestException("Name ist bereits vergeben")
        val color = req.color?.takeIf { it.matches(Regex("#[0-9a-fA-F]{6}")) } ?: m.color
        db.members().update(m.copy(name = name, motto = req.motto.trim(), color = color))
        return member(id)
    }

    suspend fun deleteMember(id: Long) {
        db.auth().deleteForMember(id)
        db.members().delete(id)
        avatarFile(id).delete()
    }

    suspend fun setAvatar(id: Long, bytes: ByteArray) {
        val m = db.members().byId(id) ?: throw NotFoundException("Mitglied nicht gefunden")
        avatarFile(id).writeBytes(bytes)
        // createdAt dient als Cache-Buster für die Avatar-URL
        db.members().update(m.copy(hasAvatar = true, createdAt = now()))
    }

    suspend fun xpLog(memberId: Long): List<XpEntryDto> =
        db.xp().forMember(memberId).map { XpEntryDto(it.type, XpRules.label(it.type), it.amount, it.createdAt) }

    private suspend fun grantXp(memberId: Long?, type: String, refId: Long) {
        if (memberId == null) return
        db.members().byId(memberId) ?: return
        db.xp().insert(XpLogEntity(memberId = memberId, type = type, refId = refId, amount = XpRules.amount(type), createdAt = now()))
    }

    private suspend fun requireMember(id: Long?): MemberEntity =
        id?.let { db.members().byId(it) } ?: throw BadRequestException("Bitte zuerst ein Profil wählen")

    // ---------------------------------------------------------------- Games

    suspend fun games(): List<GameDto> {
        val event = currentEvent()
        val sessions = db.sessions().all().groupBy { it.gameId }
        val members = db.members().all().associateBy { it.id }
        return db.games().all().map { g ->
            val s = sessions[g.id] ?: emptyList()
            GameDto(
                id = g.id, name = g.name, description = g.description, steamUrl = g.steamUrl, steamAppId = g.steamAppId,
                imageUrl = g.imageUrl, players = g.players, addedById = g.addedById, addedByName = g.addedById?.let { members[it]?.name },
                selectedForNext = g.selectedForNext, timesPlayed = s.size,
                playedThisEvent = s.any { it.eventId == event.id },
                lastPlayedAt = s.maxOfOrNull { it.startedAt }, createdAt = g.createdAt,
                sharePath = g.sharePath,
            )
        }
    }

    suspend fun createGame(req: GameRequest, actorId: Long?): GameDto {
        if (req.name.isBlank()) throw BadRequestException("Name fehlt")
        val id = db.games().insert(
            GameEntity(
                name = req.name.trim(), description = req.description.trim(), steamUrl = normalizeSteamUrl(req.steamUrl, req.steamAppId),
                steamAppId = req.steamAppId, imageUrl = req.imageUrl.trim(), players = req.players.trim(), addedById = actorId, createdAt = now(),
            )
        )
        grantXp(actorId, XpRules.GAME_ADDED, id)
        return games().first { it.id == id }
    }

    suspend fun updateGame(id: Long, req: GameRequest): GameDto {
        val g = db.games().byId(id) ?: throw NotFoundException("Spiel nicht gefunden")
        if (req.name.isBlank()) throw BadRequestException("Name fehlt")
        db.games().update(
            g.copy(
                name = req.name.trim(), description = req.description.trim(), steamUrl = normalizeSteamUrl(req.steamUrl, req.steamAppId),
                steamAppId = req.steamAppId, imageUrl = req.imageUrl.trim(), players = req.players.trim(),
            )
        )
        return games().first { it.id == id }
    }

    suspend fun deleteGame(id: Long) {
        db.games().delete(id)
        db.xp().deleteByRef(XpRules.GAME_ADDED, id)
    }

    suspend fun selectGame(id: Long, selected: Boolean) {
        db.games().byId(id) ?: throw NotFoundException("Spiel nicht gefunden")
        db.games().setSelected(id, selected)
    }

    // ---------------------------------------------------------------- Freigaben (SMB)

    suspend fun shares(): List<NetworkShareDto> {
        val members = db.members().all().associateBy { it.id }
        val games = db.games().all().groupingBy { it.shareId }.eachCount()
        return db.shares().all().map { it.toDto(members[it.addedById]?.name, games[it.id] ?: 0) }
    }

    private fun ShareEntity.toDto(addedByName: String?, gamesCount: Int) =
        NetworkShareDto(id, path, username, addedById, addedByName, lastScanAt, lastError, lastCount, gamesCount, createdAt)

    suspend fun createShare(req: ShareRequest, actorId: Long?): NetworkShareDto {
        val path = ShareScanner.normalize(req.path)
        if (db.shares().all().any { it.path.equals(path, ignoreCase = true) }) throw BadRequestException("Diese Freigabe ist schon eingetragen")
        val id = db.shares().insert(
            ShareEntity(path = path, username = req.username.trim(), password = req.password, domain = req.domain.trim(), addedById = actorId, createdAt = now())
        )
        return shares().first { it.id == id }
    }

    suspend fun deleteShare(id: Long, actorId: Long, isHost: Boolean) {
        val s = db.shares().byId(id) ?: return
        if (s.addedById != actorId && !isHost) throw ForbiddenException("Nur wer die Freigabe eingetragen hat, kann sie entfernen")
        db.games().clearShare(id)
        db.shares().delete(id)
    }

    suspend fun scanAll(): List<ShareScanDto> = db.shares().all().map { scanShare(it.id) }

    /**
     * Liest die Unterordner einer Freigabe ein. Neue Ordner werden zu Spielen, Dubletten (gleicher Name
     * oder Pfad) übersprungen, früher gesehene Ordner nicht erneut angelegt. Fehler landen im Ergebnis.
     */
    suspend fun scanShare(id: Long): ShareScanDto {
        val share = db.shares().byId(id) ?: throw NotFoundException("Freigabe nicht gefunden")
        val folders = try {
            withContext(Dispatchers.IO) { ShareScanner.listFolders(share) }
        } catch (e: Exception) {
            val msg = (e.message ?: e.javaClass.simpleName).take(200)
            db.shares().update(share.copy(lastScanAt = now(), lastError = msg))
            return ShareScanDto(share.id, share.path, 0, 0, msg)
        }
        val known = share.knownFolders.lines().filter { it.isNotBlank() }.toMutableSet()
        val games = db.games().all().toMutableList()
        var added = 0
        for (folder in folders) {
            val path = "${share.path}\\$folder"
            if (games.any { it.sharePath.equals(path, ignoreCase = true) }) continue
            val key = ShareScanner.gameKey(folder)
            val sameName = games.firstOrNull { ShareScanner.gameKey(it.name) == key }
            if (sameName != null) {
                if (sameName.sharePath.isBlank()) {
                    val updated = sameName.copy(sharePath = path, shareId = share.id)
                    db.games().update(updated)
                    games[games.indexOf(sameName)] = updated
                }
                continue
            }
            if (folder in known) continue
            val gid = db.games().insert(
                GameEntity(name = ShareScanner.displayName(folder), addedById = share.addedById, sharePath = path, shareId = share.id, createdAt = now())
            )
            games.add(GameEntity(id = gid, name = ShareScanner.displayName(folder), sharePath = path, shareId = share.id, createdAt = now()))
            added++
        }
        // Ordner verschwunden → Pfad am Spiel lösen, das Spiel selbst bleibt
        val present = folders.map { "${share.path}\\$it".lowercase() }.toSet()
        games.filter { it.shareId == share.id && it.sharePath.lowercase() !in present }
            .forEach { db.games().update(it.copy(sharePath = "", shareId = null)) }
        known += folders
        db.shares().update(share.copy(lastScanAt = now(), lastError = "", lastCount = folders.size, knownFolders = known.joinToString("\n")))
        return ShareScanDto(share.id, share.path, folders.size, added)
    }

    private fun normalizeSteamUrl(url: String, appId: Long?): String {
        val u = url.trim()
        if (u.isNotEmpty()) return u
        return if (appId != null) "https://store.steampowered.com/app/$appId/" else ""
    }

    // ---------------------------------------------------------------- Sessions (Historie / aktuell gespielt)

    suspend fun sessions(eventId: Long?): List<SessionDto> {
        val list = if (eventId == null) db.sessions().all() else db.sessions().byEvent(eventId)
        val games = db.games().all().associateBy { it.id }
        val members = db.members().all().associateBy { it.id }
        val parts = db.sessions().allParticipants().groupBy { it.sessionId }
        return list.map { s ->
            val g = games[s.gameId]
            SessionDto(
                id = s.id, gameId = s.gameId, gameName = g?.name ?: "Gelöschtes Spiel", imageUrl = g?.imageUrl ?: "",
                eventId = s.eventId, startedAt = s.startedAt, endedAt = s.endedAt, chosenBy = s.chosenBy, note = s.note,
                participants = parts[s.id]?.mapNotNull { p -> members[p.memberId]?.let { ParticipantDto(it.id, it.name, it.color, it.hasAvatar) } } ?: emptyList(),
            )
        }
    }

    suspend fun startSession(req: SessionRequest): SessionDto {
        db.games().byId(req.gameId) ?: throw NotFoundException("Spiel nicht gefunden")
        val event = currentEvent()
        val id = db.sessions().insert(SessionEntity(gameId = req.gameId, eventId = event.id, startedAt = now(), chosenBy = req.chosenBy, note = req.note.trim()))
        setParticipants(id, req.participantIds)
        // Ein gestartetes Spiel ist nicht mehr "für die nächste Runde ausgewählt"
        db.games().setSelected(req.gameId, false)
        return sessions(null).first { it.id == id }
    }

    suspend fun updateSession(id: Long, participantIds: List<Long>, note: String): SessionDto {
        val s = db.sessions().byId(id) ?: throw NotFoundException("Runde nicht gefunden")
        db.sessions().update(s.copy(note = note.trim()))
        setParticipants(id, participantIds)
        return sessions(null).first { it.id == id }
    }

    private suspend fun setParticipants(sessionId: Long, ids: List<Long>) {
        val valid = ids.distinct().filter { db.members().byId(it) != null }
        db.sessions().clearParticipants(sessionId)
        db.xp().deleteByRef(XpRules.GAME_PLAYED, sessionId)
        db.sessions().insertParticipants(valid.map { SessionParticipantEntity(sessionId, it) })
        valid.forEach { grantXp(it, XpRules.GAME_PLAYED, sessionId) }
    }

    suspend fun endSession(id: Long): SessionDto {
        val s = db.sessions().byId(id) ?: throw NotFoundException("Runde nicht gefunden")
        if (s.endedAt == null) db.sessions().update(s.copy(endedAt = now()))
        return sessions(null).first { it.id == id }
    }

    suspend fun deleteSession(id: Long) {
        db.sessions().clearParticipants(id)
        db.xp().deleteByRef(XpRules.GAME_PLAYED, id)
        db.sessions().delete(id)
    }

    // ---------------------------------------------------------------- Glücksrad

    @Volatile var lastSpin: SpinDto? = null
        private set

    suspend fun spin(excludePlayed: Boolean, onlySelected: Boolean, actorId: Long?): SpinDto {
        val event = currentEvent()
        val all = db.games().all()
        val played = if (excludePlayed) db.sessions().playedGameIds(event.id).toSet() else emptySet()
        var candidates = all.filter { it.id !in played }
        if (onlySelected && candidates.any { it.selectedForNext }) candidates = candidates.filter { it.selectedForNext }
        if (candidates.isEmpty()) throw BadRequestException("Keine Spiele für das Rad verfügbar")
        val winner = candidates[Random.nextInt(candidates.size)]
        val spin = SpinDto(
            spinId = now(),
            gameIds = candidates.map { it.id },
            winnerGameId = winner.id,
            durationMs = 6500 + Random.nextLong(0, 2000),
            turns = 5.0 + Random.nextDouble() * 3.0,
            startedAt = now(),
            startedByName = actorId?.let { db.members().byId(it)?.name },
        )
        lastSpin = spin
        return spin
    }

    // ---------------------------------------------------------------- Abstimmung

    suspend fun currentPoll(): PollDto? {
        val event = currentEvent()
        val p = db.polls().latest(event.id) ?: return null
        return p.toDto()
    }

    private suspend fun PollEntity.toDto(): PollDto {
        val members = db.members().all().associateBy { it.id }
        val votes = db.polls().votes(id).map { PollVoteDto(it.memberId, members[it.memberId]?.name ?: "?", it.gameId) }
        return PollDto(id, open, winnerGameId, votes, createdAt, closedAt)
    }

    suspend fun openPoll(): PollDto {
        val event = currentEvent()
        db.polls().latest(event.id)?.let { if (it.open) return it.toDto() }
        val id = db.polls().insert(PollEntity(eventId = event.id, open = true, createdAt = now()))
        return db.polls().byId(id)!!.toDto()
    }

    suspend fun votePoll(pollId: Long, memberId: Long?, gameId: Long): PollDto {
        val p = db.polls().byId(pollId) ?: throw NotFoundException("Abstimmung nicht gefunden")
        if (!p.open) throw BadRequestException("Abstimmung ist beendet")
        val m = requireMember(memberId)
        db.games().byId(gameId) ?: throw NotFoundException("Spiel nicht gefunden")
        db.polls().vote(PollVoteEntity(pollId, m.id, gameId))
        grantXp(m.id, XpRules.VOTE, pollId)
        return p.toDto()
    }

    suspend fun closePoll(pollId: Long): PollDto {
        val p = db.polls().byId(pollId) ?: throw NotFoundException("Abstimmung nicht gefunden")
        if (!p.open) return p.toDto()
        val counts = db.polls().votes(pollId).groupingBy { it.gameId }.eachCount()
        val max = counts.values.maxOrNull()
        val winners = counts.filter { it.value == max }.keys.toList()
        val winner = if (winners.isEmpty()) null else winners[Random.nextInt(winners.size)]
        db.polls().update(p.copy(open = false, winnerGameId = winner, closedAt = now()))
        return db.polls().byId(pollId)!!.toDto()
    }

    // ---------------------------------------------------------------- Vorschläge

    suspend fun suggestions(viewerId: Long?): List<SuggestionDto> {
        val members = db.members().all().associateBy { it.id }
        val votes = db.suggestions().allVotes().groupBy { it.suggestionId }
        val comments = db.suggestions().allComments().groupBy { it.suggestionId }
        return db.suggestions().all().map { s ->
            val v = votes[s.id] ?: emptyList()
            val a = members[s.authorId]
            SuggestionDto(
                id = s.id, scope = s.scope, title = s.title, description = s.description, steamUrl = s.steamUrl, steamAppId = s.steamAppId,
                imageUrl = s.imageUrl, authorId = s.authorId, authorName = a?.name ?: "Unbekannt", authorColor = a?.color ?: "#777777",
                authorHasAvatar = a?.hasAvatar ?: false,
                score = v.sumOf { it.value }, upvotes = v.count { it.value > 0 }, downvotes = v.count { it.value < 0 },
                myVote = v.firstOrNull { it.memberId == viewerId }?.value ?: 0,
                adoptedGameId = s.adoptedGameId,
                comments = comments[s.id]?.map { c -> c.toDto(members[c.authorId]) } ?: emptyList(),
                createdAt = s.createdAt,
            )
        }
    }

    private fun SuggestionCommentEntity.toDto(a: MemberEntity?) =
        CommentDto(id, authorId, a?.name ?: "Unbekannt", a?.color ?: "#777777", a?.hasAvatar ?: false, text, createdAt)

    private fun ForumCommentEntity.toDto(a: MemberEntity?) =
        CommentDto(id, authorId, a?.name ?: "Unbekannt", a?.color ?: "#777777", a?.hasAvatar ?: false, body, createdAt)

    suspend fun createSuggestion(req: SuggestionRequest, actorId: Long?): SuggestionDto {
        val m = requireMember(actorId)
        if (req.title.isBlank()) throw BadRequestException("Titel fehlt")
        val scope = if (req.scope == "next") "next" else "current"
        val id = db.suggestions().insert(
            SuggestionEntity(
                scope = scope, title = req.title.trim(), description = req.description.trim(), steamUrl = normalizeSteamUrl(req.steamUrl, req.steamAppId),
                steamAppId = req.steamAppId, imageUrl = req.imageUrl.trim(), authorId = m.id, createdAt = now(),
            )
        )
        grantXp(m.id, XpRules.SUGGESTION_CREATED, id)
        return suggestions(actorId).first { it.id == id }
    }

    suspend fun updateSuggestion(id: Long, req: SuggestionRequest, actorId: Long?): SuggestionDto {
        val s = db.suggestions().byId(id) ?: throw NotFoundException("Vorschlag nicht gefunden")
        if (req.title.isBlank()) throw BadRequestException("Titel fehlt")
        db.suggestions().update(
            s.copy(
                scope = if (req.scope == "next") "next" else "current", title = req.title.trim(), description = req.description.trim(),
                steamUrl = normalizeSteamUrl(req.steamUrl, req.steamAppId), steamAppId = req.steamAppId, imageUrl = req.imageUrl.trim(),
            )
        )
        return suggestions(actorId).first { it.id == id }
    }

    suspend fun deleteSuggestion(id: Long) {
        db.suggestions().delete(id)
        db.xp().deleteByRef(XpRules.SUGGESTION_CREATED, id)
        db.xp().deleteByRef(XpRules.SUGGESTION_ADOPTED, id)
    }

    suspend fun voteSuggestion(id: Long, actorId: Long?, value: Int) {
        db.suggestions().byId(id) ?: throw NotFoundException("Vorschlag nicht gefunden")
        val m = requireMember(actorId)
        if (value == 0) db.suggestions().unvote(id, m.id) else db.suggestions().vote(SuggestionVoteEntity(id, m.id, value.coerceIn(-1, 1)))
    }

    suspend fun commentSuggestion(id: Long, actorId: Long?, text: String) {
        db.suggestions().byId(id) ?: throw NotFoundException("Vorschlag nicht gefunden")
        val m = requireMember(actorId)
        if (text.isBlank()) throw BadRequestException("Kommentar ist leer")
        val cid = db.suggestions().insertComment(SuggestionCommentEntity(suggestionId = id, authorId = m.id, text = text.trim(), createdAt = now()))
        grantXp(m.id, XpRules.SUGGESTION_COMMENT, cid)
    }

    suspend fun deleteSuggestionComment(id: Long) {
        db.suggestions().deleteComment(id)
        db.xp().deleteByRef(XpRules.SUGGESTION_COMMENT, id)
    }

    /** Übernimmt einen Vorschlag in die Spieleliste und verknüpft beide. */
    suspend fun adoptSuggestion(id: Long, actorId: Long?): GameDto {
        val s = db.suggestions().byId(id) ?: throw NotFoundException("Vorschlag nicht gefunden")
        s.adoptedGameId?.let { gid -> db.games().byId(gid)?.let { return games().first { g -> g.id == gid } } }
        val game = createGame(
            GameRequest(name = s.title, description = s.description, steamUrl = s.steamUrl, steamAppId = s.steamAppId, imageUrl = s.imageUrl),
            actorId,
        )
        db.suggestions().update(s.copy(adoptedGameId = game.id))
        grantXp(s.authorId, XpRules.SUGGESTION_ADOPTED, id)
        return game
    }

    // ---------------------------------------------------------------- Forum

    suspend fun forum(): List<ForumPostDto> {
        val members = db.members().all().associateBy { it.id }
        val comments = db.forum().comments().groupBy { it.postId }
        return db.forum().posts().map { p ->
            val a = members[p.authorId]
            ForumPostDto(
                id = p.id, authorId = p.authorId, authorName = a?.name ?: "Unbekannt", authorColor = a?.color ?: "#777777",
                authorHasAvatar = a?.hasAvatar ?: false, title = p.title, body = p.body, pinned = p.pinned,
                comments = comments[p.id]?.map { c -> c.toDto(members[c.authorId]) } ?: emptyList(), createdAt = p.createdAt,
            )
        }
    }

    suspend fun createPost(req: ForumPostRequest, actorId: Long?): ForumPostDto {
        val m = requireMember(actorId)
        if (req.title.isBlank() && req.body.isBlank()) throw BadRequestException("Beitrag ist leer")
        val id = db.forum().insertPost(ForumPostEntity(authorId = m.id, title = req.title.trim(), body = req.body.trim(), pinned = req.pinned, createdAt = now()))
        grantXp(m.id, XpRules.FORUM_POST, id)
        return forum().first { it.id == id }
    }

    suspend fun updatePost(id: Long, req: ForumPostRequest): ForumPostDto {
        val p = db.forum().post(id) ?: throw NotFoundException("Beitrag nicht gefunden")
        db.forum().updatePost(p.copy(title = req.title.trim(), body = req.body.trim(), pinned = req.pinned))
        return forum().first { it.id == id }
    }

    suspend fun deletePost(id: Long) {
        db.forum().deleteCommentsOfPost(id)
        db.forum().deletePost(id)
        db.xp().deleteByRef(XpRules.FORUM_POST, id)
    }

    suspend fun commentPost(postId: Long, actorId: Long?, body: String) {
        db.forum().post(postId) ?: throw NotFoundException("Beitrag nicht gefunden")
        val m = requireMember(actorId)
        if (body.isBlank()) throw BadRequestException("Kommentar ist leer")
        val id = db.forum().insertComment(ForumCommentEntity(postId = postId, authorId = m.id, body = body.trim(), createdAt = now()))
        grantXp(m.id, XpRules.FORUM_COMMENT, id)
    }

    suspend fun deleteForumComment(id: Long) {
        db.forum().deleteComment(id)
        db.xp().deleteByRef(XpRules.FORUM_COMMENT, id)
    }

    // ---------------------------------------------------------------- Kosten

    suspend fun costs(eventId: Long?): CostOverviewDto {
        val event = eventId?.let { db.events().byId(it) } ?: currentEvent()
        val members = db.members().all()
        val memberIds = members.map { it.id }
        val memberById = members.associateBy { it.id }
        val attendance = db.costs().attendance(event.id).groupBy({ it.memberId }, { it.day }).mapValues { it.value.toSet() }
        val shares = db.costs().allShares().groupBy { it.expenseId }
        val expenses = db.costs().expenses(event.id)
        val payments = db.costs().payments(event.id)
        val inputs = expenses.map { e -> ExpenseInput(e.id, e.amountCents, e.paidById, e.day, shares[e.id]?.map { it.memberId } ?: emptyList()) }
        val summary = CostSplitter.summarize(memberIds, inputs, payments.map { PaymentInput(it.fromId, it.toId, it.amountCents) }, attendance)
        return CostOverviewDto(
            eventId = event.id,
            days = event.days,
            attendance = attendance.mapValues { it.value.sorted() },
            expenses = expenses.map { e ->
                ExpenseDto(
                    id = e.id, eventId = e.eventId, title = e.title, amountCents = e.amountCents, paidById = e.paidById,
                    paidByName = memberById[e.paidById]?.name ?: "Unbekannt", day = e.day, note = e.note,
                    participantIds = shares[e.id]?.map { it.memberId } ?: emptyList(),
                    shares = summary.shares[e.id]?.map { ShareDto(it.memberId, it.cents) } ?: emptyList(),
                    createdAt = e.createdAt,
                )
            },
            payments = payments.map { PaymentDto(it.id, it.fromId, it.toId, it.amountCents, it.createdAt) },
            balances = summary.balances.filter { it.memberId in memberById }.map { BalanceDto(it.memberId, it.paidCents, it.owedCents, it.netCents) },
            transfers = summary.transfers.map { TransferDto(it.fromId, it.toId, it.cents) },
            totalCents = summary.totalCents,
        )
    }

    suspend fun setAttendance(eventId: Long?, req: AttendanceRequest) {
        val event = eventId?.let { db.events().byId(it) } ?: currentEvent()
        db.members().byId(req.memberId) ?: throw NotFoundException("Mitglied nicht gefunden")
        val days = req.days.filter { it in 1..event.days }.distinct()
        db.costs().clearAttendance(event.id, req.memberId)
        db.costs().insertAttendance(days.map { AttendanceEntity(event.id, req.memberId, it) })
        // XP pro Anwesenheitstag (refId = eventId*100 + Tag)
        for (d in 1..event.days) db.xp().deleteByRefAndMember(XpRules.ATTENDANCE, event.id * 100 + d, req.memberId)
        days.forEach { grantXp(req.memberId, XpRules.ATTENDANCE, event.id * 100 + it) }
    }

    suspend fun createExpense(eventId: Long?, req: ExpenseRequest): ExpenseDto {
        val event = eventId?.let { db.events().byId(it) } ?: currentEvent()
        validateExpense(req, event)
        val id = db.costs().insertExpense(
            ExpenseEntity(eventId = event.id, title = req.title.trim(), amountCents = req.amountCents, paidById = req.paidById, day = req.day, note = req.note.trim(), createdAt = now())
        )
        db.costs().insertShares(req.participantIds.distinct().map { ExpenseShareEntity(id, it) })
        grantXp(req.paidById, XpRules.EXPENSE_PAID, id)
        return costs(event.id).expenses.first { it.id == id }
    }

    suspend fun updateExpense(id: Long, req: ExpenseRequest): ExpenseDto {
        val e = db.costs().expense(id) ?: throw NotFoundException("Einkauf nicht gefunden")
        val event = db.events().byId(e.eventId) ?: currentEvent()
        validateExpense(req, event)
        db.costs().updateExpense(e.copy(title = req.title.trim(), amountCents = req.amountCents, paidById = req.paidById, day = req.day, note = req.note.trim()))
        db.costs().clearShares(id)
        db.costs().insertShares(req.participantIds.distinct().map { ExpenseShareEntity(id, it) })
        db.xp().deleteByRef(XpRules.EXPENSE_PAID, id)
        grantXp(req.paidById, XpRules.EXPENSE_PAID, id)
        return costs(event.id).expenses.first { it.id == id }
    }

    private suspend fun validateExpense(req: ExpenseRequest, event: EventEntity) {
        if (req.title.isBlank()) throw BadRequestException("Bezeichnung fehlt")
        if (req.amountCents <= 0) throw BadRequestException("Betrag muss größer als 0 sein")
        db.members().byId(req.paidById) ?: throw BadRequestException("Zahler nicht gefunden")
        if (req.day != null && req.day !in 1..event.days) throw BadRequestException("Ungültiger Tag")
    }

    suspend fun deleteExpense(id: Long) {
        db.costs().clearShares(id)
        db.costs().deleteExpense(id)
        db.xp().deleteByRef(XpRules.EXPENSE_PAID, id)
    }

    suspend fun createPayment(eventId: Long?, req: PaymentRequest): PaymentDto {
        val event = eventId?.let { db.events().byId(it) } ?: currentEvent()
        if (req.amountCents <= 0) throw BadRequestException("Betrag muss größer als 0 sein")
        if (req.fromId == req.toId) throw BadRequestException("Zahler und Empfänger sind identisch")
        db.members().byId(req.fromId) ?: throw BadRequestException("Zahler nicht gefunden")
        db.members().byId(req.toId) ?: throw BadRequestException("Empfänger nicht gefunden")
        val id = db.costs().insertPayment(PaymentEntity(eventId = event.id, fromId = req.fromId, toId = req.toId, amountCents = req.amountCents, createdAt = now()))
        return costs(event.id).payments.first { it.id == id }
    }

    suspend fun deletePayment(id: Long) = db.costs().deletePayment(id)

    // ---------------------------------------------------------------- Ausrüstung

    suspend fun equipment(eventId: Long?): List<EquipmentDto> {
        val event = eventId?.let { db.events().byId(it) } ?: currentEvent()
        val members = db.members().all().associateBy { it.id }
        return db.equipment().byEvent(event.id).map { it.toDto(members[it.bringerId]?.name) }
    }

    private fun EquipmentEntity.toDto(bringerName: String?) =
        EquipmentDto(id, eventId, name, category, quantity, note, bringerId, bringerName, done, createdAt)

    suspend fun createEquipment(eventId: Long?, req: EquipmentRequest): EquipmentDto {
        val event = eventId?.let { db.events().byId(it) } ?: currentEvent()
        if (req.name.isBlank()) throw BadRequestException("Bezeichnung fehlt")
        val id = db.equipment().insert(
            EquipmentEntity(eventId = event.id, name = req.name.trim(), category = req.category.trim().ifBlank { "Sonstiges" }, quantity = req.quantity.coerceAtLeast(1), note = req.note.trim(), createdAt = now())
        )
        return equipment(event.id).first { it.id == id }
    }

    suspend fun updateEquipment(id: Long, req: EquipmentRequest): EquipmentDto {
        val e = db.equipment().byId(id) ?: throw NotFoundException("Gegenstand nicht gefunden")
        if (req.name.isBlank()) throw BadRequestException("Bezeichnung fehlt")
        db.equipment().update(e.copy(name = req.name.trim(), category = req.category.trim().ifBlank { "Sonstiges" }, quantity = req.quantity.coerceAtLeast(1), note = req.note.trim()))
        return equipment(e.eventId).first { it.id == id }
    }

    suspend fun deleteEquipment(id: Long) {
        db.equipment().delete(id)
        db.xp().deleteByRef(XpRules.EQUIPMENT_BROUGHT, id)
    }

    suspend fun claimEquipment(id: Long, memberId: Long?): EquipmentDto {
        val e = db.equipment().byId(id) ?: throw NotFoundException("Gegenstand nicht gefunden")
        if (memberId != null) db.members().byId(memberId) ?: throw NotFoundException("Mitglied nicht gefunden")
        db.equipment().update(e.copy(bringerId = memberId, done = if (memberId == null) false else e.done))
        db.xp().deleteByRef(XpRules.EQUIPMENT_BROUGHT, id)
        if (memberId != null && e.done) grantXp(memberId, XpRules.EQUIPMENT_BROUGHT, id)
        return equipment(e.eventId).first { it.id == id }
    }

    suspend fun setEquipmentDone(id: Long, done: Boolean): EquipmentDto {
        val e = db.equipment().byId(id) ?: throw NotFoundException("Gegenstand nicht gefunden")
        db.equipment().update(e.copy(done = done))
        db.xp().deleteByRef(XpRules.EQUIPMENT_BROUGHT, id)
        if (done) grantXp(e.bringerId, XpRules.EQUIPMENT_BROUGHT, id)
        return equipment(e.eventId).first { it.id == id }
    }

    /** Übernimmt die Ausrüstungsliste einer früheren Ausgabe (inkl. Zusagen) als Vorlage. */
    suspend fun applyEquipmentTemplate(fromEventId: Long?): Int {
        val target = currentEvent()
        val source = fromEventId?.let { db.events().byId(it) } ?: db.events().previous(target.id) ?: throw BadRequestException("Keine frühere LAN-Party vorhanden")
        if (source.id == target.id) throw BadRequestException("Quelle und Ziel sind identisch")
        return copyEquipment(source.id, target.id)
    }

    private suspend fun copyEquipment(fromEventId: Long, toEventId: Long): Int {
        val existing = db.equipment().byEvent(toEventId).map { it.name.lowercase() to it.category.lowercase() }.toSet()
        val items = db.equipment().byEvent(fromEventId)
            .filter { (it.name.lowercase() to it.category.lowercase()) !in existing }
            .map { EquipmentEntity(eventId = toEventId, name = it.name, category = it.category, quantity = it.quantity, note = it.note, bringerId = it.bringerId, done = false, createdAt = now()) }
        db.equipment().insertAll(items)
        return items.size
    }

    /** Standard-Ausrüstung für eine ganz neue Installation. */
    suspend fun seedDefaultEquipmentIfEmpty() {
        val event = currentEvent()
        if (db.equipment().count(event.id) > 0 || db.events().all().size > 1) return
        val defaults = listOf(
            "Nintendo Switch" to "Konsolen", "Beamer" to "Technik", "Controller" to "Technik", "HDMI-Kabel" to "Kabel",
            "Netzwerkkabel" to "Kabel", "Netzwerk-Switch" to "Netzwerk", "Mehrfachsteckdosen" to "Kabel", "Bier" to "Getränke",
            "Energy-Drinks" to "Getränke", "Snacks" to "Verpflegung", "Boxen / Lautsprecher" to "Technik",
        )
        db.equipment().insertAll(defaults.map { (n, c) -> EquipmentEntity(eventId = event.id, name = n, category = c, createdAt = now()) })
    }
}
