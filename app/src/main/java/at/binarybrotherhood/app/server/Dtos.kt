package at.binarybrotherhood.app.server

import kotlinx.serialization.Serializable

// ---------- Antworten ----------

@Serializable
data class EventDto(
    val id: Long,
    val name: String,
    val year: Int,
    val startDate: String,
    val days: Int,
    val isCurrent: Boolean,
)

@Serializable
data class MemberStatsDto(
    val gamesPlayed: Int = 0,
    val forumPosts: Int = 0,
    val comments: Int = 0,
    val suggestions: Int = 0,
    val equipmentBrought: Int = 0,
    val expensesPaid: Int = 0,
    val attendanceDays: Int = 0,
    val favoriteGame: String? = null,
)

@Serializable
data class MemberDto(
    val id: Long,
    val name: String,
    val motto: String,
    val color: String,
    val hasAvatar: Boolean,
    val avatarUrl: String,
    val xp: Int,
    val level: Int,
    val rank: String,
    val xpForCurrentLevel: Int,
    val xpForNextLevel: Int,
    val progress: Double,
    val stats: MemberStatsDto,
    val createdAt: Long,
)

@Serializable
data class XpEntryDto(val type: String, val label: String, val amount: Int, val createdAt: Long)

@Serializable
data class GameDto(
    val id: Long,
    val name: String,
    val description: String,
    val steamUrl: String,
    val steamAppId: Long?,
    val imageUrl: String,
    val players: String,
    val addedById: Long?,
    val addedByName: String?,
    val selectedForNext: Boolean,
    val timesPlayed: Int,
    val playedThisEvent: Boolean,
    val lastPlayedAt: Long?,
    val createdAt: Long,
)

@Serializable
data class ParticipantDto(val id: Long, val name: String, val color: String, val hasAvatar: Boolean)

@Serializable
data class SessionDto(
    val id: Long,
    val gameId: Long,
    val gameName: String,
    val imageUrl: String,
    val eventId: Long,
    val startedAt: Long,
    val endedAt: Long?,
    val chosenBy: String,
    val note: String,
    val participants: List<ParticipantDto>,
)

@Serializable
data class SpinDto(
    val spinId: Long,
    val gameIds: List<Long>,
    val winnerGameId: Long,
    val durationMs: Long,
    val turns: Double,
    val startedAt: Long,
    val startedByName: String?,
)

@Serializable
data class PollVoteDto(val memberId: Long, val memberName: String, val gameId: Long)

@Serializable
data class PollDto(
    val id: Long,
    val open: Boolean,
    val winnerGameId: Long?,
    val votes: List<PollVoteDto>,
    val createdAt: Long,
    val closedAt: Long?,
)

@Serializable
data class CommentDto(
    val id: Long,
    val authorId: Long?,
    val authorName: String,
    val authorColor: String,
    val authorHasAvatar: Boolean,
    val text: String,
    val createdAt: Long,
)

@Serializable
data class SuggestionDto(
    val id: Long,
    val scope: String,
    val title: String,
    val description: String,
    val steamUrl: String,
    val steamAppId: Long?,
    val imageUrl: String,
    val authorId: Long?,
    val authorName: String,
    val authorColor: String,
    val authorHasAvatar: Boolean,
    val score: Int,
    val upvotes: Int,
    val downvotes: Int,
    val myVote: Int,
    val adoptedGameId: Long?,
    val comments: List<CommentDto>,
    val createdAt: Long,
)

@Serializable
data class ForumPostDto(
    val id: Long,
    val authorId: Long?,
    val authorName: String,
    val authorColor: String,
    val authorHasAvatar: Boolean,
    val title: String,
    val body: String,
    val pinned: Boolean,
    val comments: List<CommentDto>,
    val createdAt: Long,
)

@Serializable
data class ShareDto(val memberId: Long, val cents: Long)

@Serializable
data class ExpenseDto(
    val id: Long,
    val eventId: Long,
    val title: String,
    val amountCents: Long,
    val paidById: Long,
    val paidByName: String,
    val day: Int?,
    val note: String,
    val participantIds: List<Long>,
    val shares: List<ShareDto>,
    val createdAt: Long,
)

@Serializable
data class PaymentDto(val id: Long, val fromId: Long, val toId: Long, val amountCents: Long, val createdAt: Long)

@Serializable
data class BalanceDto(val memberId: Long, val paidCents: Long, val owedCents: Long, val netCents: Long)

@Serializable
data class TransferDto(val fromId: Long, val toId: Long, val cents: Long)

@Serializable
data class CostOverviewDto(
    val eventId: Long,
    val days: Int,
    val attendance: Map<Long, List<Int>>,
    val expenses: List<ExpenseDto>,
    val payments: List<PaymentDto>,
    val balances: List<BalanceDto>,
    val transfers: List<TransferDto>,
    val totalCents: Long,
)

@Serializable
data class EquipmentDto(
    val id: Long,
    val eventId: Long,
    val name: String,
    val category: String,
    val quantity: Int,
    val note: String,
    val bringerId: Long?,
    val bringerName: String?,
    val done: Boolean,
    val createdAt: Long,
)

@Serializable
data class SteamResultDto(val appId: Long, val name: String, val imageUrl: String, val price: String?)

@Serializable
data class SteamDetailsDto(val appId: Long, val name: String, val description: String, val imageUrl: String, val steamUrl: String)

@Serializable
data class HostInfoDto(val addresses: List<String>, val port: Int, val clients: Int, val version: String, val dbPath: String)

@Serializable
data class BootstrapDto(
    val event: EventDto?,
    val events: List<EventDto>,
    val members: List<MemberDto>,
    val serverTime: Long,
    val appName: String,
)

@Serializable
data class OkDto(val ok: Boolean = true, val id: Long? = null)

// ---------- Login ----------

/** Öffentliche Profilliste für den Login-Bildschirm (ohne Statistik, ohne Hash). */
@Serializable
data class AuthMemberDto(val id: Long, val name: String, val color: String, val hasAvatar: Boolean, val hasPassword: Boolean, val createdAt: Long)

@Serializable
data class AuthStateDto(val member: MemberDto, val isHost: Boolean)

@Serializable
data class AuthResponseDto(val token: String, val member: MemberDto, val isHost: Boolean)

@Serializable
data class ErrorDto(val error: String)

// ---------- Anfragen ----------

@Serializable data class MemberRequest(val name: String, val motto: String = "", val color: String? = null)
@Serializable data class LoginRequest(val memberId: Long, val password: String)
@Serializable data class RegisterRequest(val name: String, val password: String, val color: String? = null)
@Serializable data class PasswordChangeRequest(val oldPassword: String = "", val newPassword: String)
@Serializable data class GameRequest(
    val name: String,
    val description: String = "",
    val steamUrl: String = "",
    val steamAppId: Long? = null,
    val imageUrl: String = "",
    val players: String = "",
)
@Serializable data class SelectRequest(val selected: Boolean)
@Serializable data class SessionRequest(val gameId: Long, val participantIds: List<Long> = emptyList(), val chosenBy: String = "manual", val note: String = "")
@Serializable data class SessionUpdateRequest(val participantIds: List<Long>, val note: String = "")
@Serializable data class SpinRequest(val excludePlayed: Boolean = false, val onlySelected: Boolean = true)
@Serializable data class PollVoteRequest(val gameId: Long)
@Serializable data class SuggestionRequest(
    val scope: String,
    val title: String,
    val description: String = "",
    val steamUrl: String = "",
    val steamAppId: Long? = null,
    val imageUrl: String = "",
)
@Serializable data class VoteRequest(val value: Int)
@Serializable data class CommentRequest(val text: String)
@Serializable data class ForumPostRequest(val title: String, val body: String, val pinned: Boolean = false)
@Serializable data class EventRequest(val name: String, val year: Int, val startDate: String, val days: Int, val copyEquipment: Boolean = true, val activate: Boolean = true)
@Serializable data class AttendanceRequest(val memberId: Long, val days: List<Int>)
@Serializable data class ExpenseRequest(
    val title: String,
    val amountCents: Long,
    val paidById: Long,
    val day: Int? = null,
    val note: String = "",
    val participantIds: List<Long> = emptyList(),
)
@Serializable data class PaymentRequest(val fromId: Long, val toId: Long, val amountCents: Long)
@Serializable data class EquipmentRequest(val name: String, val category: String = "Sonstiges", val quantity: Int = 1, val note: String = "")
@Serializable data class ClaimRequest(val memberId: Long? = null)
@Serializable data class DoneRequest(val done: Boolean)
@Serializable data class TemplateRequest(val fromEventId: Long? = null)
