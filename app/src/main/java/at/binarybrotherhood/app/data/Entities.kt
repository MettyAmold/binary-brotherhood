package at.binarybrotherhood.app.data

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * Eine LAN-Party-Ausgabe (z. B. "LAN 2026"). Genau eine Ausgabe ist "aktuell".
 * Spielhistorie, Ausgaben, Anwesenheit und Ausrüstung hängen an einer Ausgabe.
 */
@Entity(tableName = "events")
data class EventEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val name: String,
    val year: Int,
    /** ISO-Datum des ersten Tages, z. B. 2026-11-13 */
    val startDate: String,
    val days: Int,
    val isCurrent: Boolean,
    val createdAt: Long,
)

@Entity(tableName = "members")
data class MemberEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val name: String,
    val motto: String = "",
    /** Hex-Farbe für Avatar-Platzhalter und Rad-Segmente */
    val color: String,
    val hasAvatar: Boolean = false,
    val createdAt: Long,
    /** PBKDF2-Hash im Format pbkdf2:<Iterationen>:<Salt>:<Hash>; leer = noch kein Passwort gesetzt */
    @ColumnInfo(defaultValue = "") val password: String = "",
)

/** Login-Sitzung eines Mitglieds auf einem Gerät. Gespeichert wird nur der SHA-256 des Tokens. */
@Entity(tableName = "auth_tokens", indices = [Index("memberId")])
data class AuthTokenEntity(
    @PrimaryKey val tokenHash: String,
    val memberId: Long,
    val device: String,
    val createdAt: Long,
    val lastUsedAt: Long,
)

@Entity(tableName = "games", indices = [Index("steamAppId")])
data class GameEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val name: String,
    val description: String = "",
    val steamUrl: String = "",
    val steamAppId: Long? = null,
    val imageUrl: String = "",
    val players: String = "",
    val addedById: Long? = null,
    val selectedForNext: Boolean = false,
    val createdAt: Long,
    /** UNC-Pfad des Spielordners auf einer Freigabe, z. B. \\PC\Spiele\Portal 2 (leer = manuell angelegt) */
    @ColumnInfo(defaultValue = "") val sharePath: String = "",
    val shareId: Long? = null,
)

/**
 * Eine Windows-Freigabe im LAN, die die App als Client durchsucht. Jeder Unterordner
 * wird zu einem Spiel; die Dateien holen sich die Leute direkt vom jeweiligen PC.
 */
@Entity(tableName = "shares")
data class ShareEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    /** Normalisiert als \\host\freigabe\unterordner */
    val path: String,
    val username: String = "",
    val password: String = "",
    val domain: String = "",
    val addedById: Long? = null,
    val lastScanAt: Long? = null,
    val lastError: String = "",
    val lastCount: Int = 0,
    /** Bereits gesehene Ordnernamen (zeilenweise), damit gelöschte Spiele nicht wieder auftauchen */
    val knownFolders: String = "",
    val createdAt: Long,
)

/** Eine gespielte (oder gerade laufende) Runde eines Spiels. endedAt == null → läuft gerade. */
@Entity(tableName = "sessions", indices = [Index("gameId"), Index("eventId")])
data class SessionEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val gameId: Long,
    val eventId: Long,
    val startedAt: Long,
    val endedAt: Long? = null,
    /** wheel | vote | manual */
    val chosenBy: String = "manual",
    val note: String = "",
)

@Entity(tableName = "session_participants", primaryKeys = ["sessionId", "memberId"])
data class SessionParticipantEntity(val sessionId: Long, val memberId: Long)

@Entity(tableName = "suggestions", indices = [Index("scope")])
data class SuggestionEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    /** current | next */
    val scope: String,
    val title: String,
    val description: String = "",
    val steamUrl: String = "",
    val steamAppId: Long? = null,
    val imageUrl: String = "",
    val authorId: Long? = null,
    val adoptedGameId: Long? = null,
    val createdAt: Long,
)

@Entity(tableName = "suggestion_votes", primaryKeys = ["suggestionId", "memberId"])
data class SuggestionVoteEntity(val suggestionId: Long, val memberId: Long, val value: Int)

@Entity(tableName = "suggestion_comments", indices = [Index("suggestionId")])
data class SuggestionCommentEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val suggestionId: Long,
    val authorId: Long?,
    val text: String,
    val createdAt: Long,
)

@Entity(tableName = "forum_posts")
data class ForumPostEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val authorId: Long?,
    val title: String,
    val body: String,
    val pinned: Boolean = false,
    val createdAt: Long,
)

@Entity(tableName = "forum_comments", indices = [Index("postId")])
data class ForumCommentEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val postId: Long,
    val authorId: Long?,
    val body: String,
    val createdAt: Long,
)

/** Anwesenheit eines Mitglieds an einem Tag (1-basiert) einer Ausgabe. */
@Entity(tableName = "attendance", primaryKeys = ["eventId", "memberId", "day"])
data class AttendanceEntity(val eventId: Long, val memberId: Long, val day: Int)

/**
 * Ein gemeinsamer Einkauf. amountCents in Cent.
 * day == null → betrifft die ganze LAN (Aufteilung nach Anwesenheitstagen),
 * day != null → nur die an diesem Tag Anwesenden.
 * Wenn explizite Teilnehmer (ExpenseShareEntity) existieren, wird gleichmäßig unter diesen geteilt.
 */
@Entity(tableName = "expenses", indices = [Index("eventId")])
data class ExpenseEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val eventId: Long,
    val title: String,
    val amountCents: Long,
    val paidById: Long,
    val day: Int? = null,
    val note: String = "",
    val createdAt: Long,
)

@Entity(tableName = "expense_shares", primaryKeys = ["expenseId", "memberId"])
data class ExpenseShareEntity(val expenseId: Long, val memberId: Long)

/** Ausgleichszahlung: from hat to Geld gegeben ("als bezahlt markiert"). */
@Entity(tableName = "payments", indices = [Index("eventId")])
data class PaymentEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val eventId: Long,
    val fromId: Long,
    val toId: Long,
    val amountCents: Long,
    val createdAt: Long,
)

@Entity(tableName = "equipment", indices = [Index("eventId")])
data class EquipmentEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val eventId: Long,
    val name: String,
    val category: String,
    val quantity: Int = 1,
    val note: String = "",
    val bringerId: Long? = null,
    val done: Boolean = false,
    val createdAt: Long,
)

/** Abstimmung über das nächste Spiel (Alternative zum Glücksrad). */
@Entity(tableName = "polls", indices = [Index("eventId")])
data class PollEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val eventId: Long,
    val open: Boolean = true,
    val winnerGameId: Long? = null,
    val createdAt: Long,
    val closedAt: Long? = null,
)

@Entity(tableName = "poll_votes", primaryKeys = ["pollId", "memberId"])
data class PollVoteEntity(val pollId: Long, val memberId: Long, val gameId: Long)

/** XP-Protokoll: jede Aktion, die Erfahrungspunkte bringt. */
@Entity(tableName = "xp_log", indices = [Index("memberId"), Index(value = ["type", "refId", "memberId"], unique = true)])
data class XpLogEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val memberId: Long,
    val type: String,
    val refId: Long,
    val amount: Int,
    val createdAt: Long,
)
