package at.binarybrotherhood.app.data

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update

@Dao
interface EventDao {
    @Query("SELECT * FROM events ORDER BY startDate DESC, id DESC") suspend fun all(): List<EventEntity>
    @Query("SELECT * FROM events WHERE id = :id") suspend fun byId(id: Long): EventEntity?
    @Query("SELECT * FROM events WHERE isCurrent = 1 LIMIT 1") suspend fun current(): EventEntity?
    @Query("SELECT * FROM events WHERE id != :exceptId ORDER BY startDate DESC, id DESC LIMIT 1") suspend fun previous(exceptId: Long): EventEntity?
    @Insert suspend fun insert(e: EventEntity): Long
    @Update suspend fun update(e: EventEntity)
    @Query("UPDATE events SET isCurrent = (id = :id)") suspend fun setCurrent(id: Long)
    @Query("DELETE FROM events WHERE id = :id") suspend fun delete(id: Long)
}

@Dao
interface MemberDao {
    @Query("SELECT * FROM members ORDER BY name COLLATE NOCASE") suspend fun all(): List<MemberEntity>
    @Query("SELECT * FROM members WHERE id = :id") suspend fun byId(id: Long): MemberEntity?
    @Insert suspend fun insert(m: MemberEntity): Long
    @Update suspend fun update(m: MemberEntity)
    @Query("DELETE FROM members WHERE id = :id") suspend fun delete(id: Long)
    @Query("UPDATE members SET password = :hash WHERE id = :id") suspend fun setPassword(id: Long, hash: String)
}

@Dao
interface AuthDao {
    @Query("SELECT * FROM auth_tokens WHERE tokenHash = :hash") suspend fun byHash(hash: String): AuthTokenEntity?
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun insert(t: AuthTokenEntity)
    @Query("UPDATE auth_tokens SET lastUsedAt = :ts WHERE tokenHash = :hash") suspend fun touch(hash: String, ts: Long)
    @Query("DELETE FROM auth_tokens WHERE tokenHash = :hash") suspend fun delete(hash: String)
    @Query("DELETE FROM auth_tokens WHERE memberId = :memberId") suspend fun deleteForMember(memberId: Long)
    @Query("SELECT COUNT(*) FROM auth_tokens WHERE memberId = :memberId") suspend fun countForMember(memberId: Long): Int
}

@Dao
interface GameDao {
    @Query("SELECT * FROM games ORDER BY name COLLATE NOCASE") suspend fun all(): List<GameEntity>
    @Query("SELECT * FROM games WHERE id = :id") suspend fun byId(id: Long): GameEntity?
    @Insert suspend fun insert(g: GameEntity): Long
    @Update suspend fun update(g: GameEntity)
    @Query("DELETE FROM games WHERE id = :id") suspend fun delete(id: Long)
    @Query("UPDATE games SET selectedForNext = :selected WHERE id = :id") suspend fun setSelected(id: Long, selected: Boolean)
    @Query("UPDATE games SET selectedForNext = 0") suspend fun clearSelection()
    @Query("UPDATE games SET sharePath = '', shareId = NULL WHERE shareId = :shareId") suspend fun clearShare(shareId: Long)
}

@Dao
interface ShareDao {
    @Query("SELECT * FROM shares ORDER BY path COLLATE NOCASE") suspend fun all(): List<ShareEntity>
    @Query("SELECT * FROM shares WHERE id = :id") suspend fun byId(id: Long): ShareEntity?
    @Insert suspend fun insert(s: ShareEntity): Long
    @Update suspend fun update(s: ShareEntity)
    @Query("DELETE FROM shares WHERE id = :id") suspend fun delete(id: Long)
}

@Dao
interface SessionDao {
    @Query("SELECT * FROM sessions ORDER BY startedAt DESC") suspend fun all(): List<SessionEntity>
    @Query("SELECT * FROM sessions WHERE eventId = :eventId ORDER BY startedAt DESC") suspend fun byEvent(eventId: Long): List<SessionEntity>
    @Query("SELECT * FROM sessions WHERE id = :id") suspend fun byId(id: Long): SessionEntity?
    @Query("SELECT * FROM sessions WHERE endedAt IS NULL ORDER BY startedAt DESC") suspend fun running(): List<SessionEntity>
    @Query("SELECT DISTINCT gameId FROM sessions WHERE eventId = :eventId") suspend fun playedGameIds(eventId: Long): List<Long>
    @Insert suspend fun insert(s: SessionEntity): Long
    @Update suspend fun update(s: SessionEntity)
    @Query("DELETE FROM sessions WHERE id = :id") suspend fun delete(id: Long)
    @Query("SELECT * FROM session_participants") suspend fun allParticipants(): List<SessionParticipantEntity>
    @Query("SELECT * FROM session_participants WHERE sessionId = :sessionId") suspend fun participants(sessionId: Long): List<SessionParticipantEntity>
    @Insert(onConflict = OnConflictStrategy.IGNORE) suspend fun insertParticipants(p: List<SessionParticipantEntity>)
    @Query("DELETE FROM session_participants WHERE sessionId = :sessionId") suspend fun clearParticipants(sessionId: Long)
    @Query("SELECT COUNT(*) FROM sessions WHERE gameId = :gameId") suspend fun countForGame(gameId: Long): Int
}

@Dao
interface SuggestionDao {
    @Query("SELECT * FROM suggestions ORDER BY createdAt DESC") suspend fun all(): List<SuggestionEntity>
    @Query("SELECT * FROM suggestions WHERE id = :id") suspend fun byId(id: Long): SuggestionEntity?
    @Insert suspend fun insert(s: SuggestionEntity): Long
    @Update suspend fun update(s: SuggestionEntity)
    @Query("DELETE FROM suggestions WHERE id = :id") suspend fun delete(id: Long)
    @Query("SELECT * FROM suggestion_votes") suspend fun allVotes(): List<SuggestionVoteEntity>
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun vote(v: SuggestionVoteEntity)
    @Query("DELETE FROM suggestion_votes WHERE suggestionId = :suggestionId AND memberId = :memberId") suspend fun unvote(suggestionId: Long, memberId: Long)
    @Query("SELECT * FROM suggestion_comments ORDER BY createdAt ASC") suspend fun allComments(): List<SuggestionCommentEntity>
    @Insert suspend fun insertComment(c: SuggestionCommentEntity): Long
    @Query("DELETE FROM suggestion_comments WHERE id = :id") suspend fun deleteComment(id: Long)
    @Query("UPDATE suggestions SET scope = 'current' WHERE scope = 'next' AND adoptedGameId IS NULL") suspend fun promoteNextToCurrent()
}

@Dao
interface ForumDao {
    @Query("SELECT * FROM forum_posts ORDER BY pinned DESC, createdAt DESC") suspend fun posts(): List<ForumPostEntity>
    @Query("SELECT * FROM forum_posts WHERE id = :id") suspend fun post(id: Long): ForumPostEntity?
    @Insert suspend fun insertPost(p: ForumPostEntity): Long
    @Update suspend fun updatePost(p: ForumPostEntity)
    @Query("DELETE FROM forum_posts WHERE id = :id") suspend fun deletePost(id: Long)
    @Query("SELECT * FROM forum_comments ORDER BY createdAt ASC") suspend fun comments(): List<ForumCommentEntity>
    @Insert suspend fun insertComment(c: ForumCommentEntity): Long
    @Query("DELETE FROM forum_comments WHERE id = :id") suspend fun deleteComment(id: Long)
    @Query("DELETE FROM forum_comments WHERE postId = :postId") suspend fun deleteCommentsOfPost(postId: Long)
}

@Dao
interface CostDao {
    @Query("SELECT * FROM attendance WHERE eventId = :eventId") suspend fun attendance(eventId: Long): List<AttendanceEntity>
    @Insert(onConflict = OnConflictStrategy.IGNORE) suspend fun insertAttendance(a: List<AttendanceEntity>)
    @Query("DELETE FROM attendance WHERE eventId = :eventId AND memberId = :memberId") suspend fun clearAttendance(eventId: Long, memberId: Long)
    @Query("SELECT * FROM expenses WHERE eventId = :eventId ORDER BY createdAt DESC") suspend fun expenses(eventId: Long): List<ExpenseEntity>
    @Query("SELECT * FROM expenses WHERE id = :id") suspend fun expense(id: Long): ExpenseEntity?
    @Insert suspend fun insertExpense(e: ExpenseEntity): Long
    @Update suspend fun updateExpense(e: ExpenseEntity)
    @Query("DELETE FROM expenses WHERE id = :id") suspend fun deleteExpense(id: Long)
    @Query("SELECT * FROM expense_shares") suspend fun allShares(): List<ExpenseShareEntity>
    @Insert(onConflict = OnConflictStrategy.IGNORE) suspend fun insertShares(s: List<ExpenseShareEntity>)
    @Query("DELETE FROM expense_shares WHERE expenseId = :expenseId") suspend fun clearShares(expenseId: Long)
    @Query("SELECT * FROM payments WHERE eventId = :eventId ORDER BY createdAt DESC") suspend fun payments(eventId: Long): List<PaymentEntity>
    @Insert suspend fun insertPayment(p: PaymentEntity): Long
    @Query("DELETE FROM payments WHERE id = :id") suspend fun deletePayment(id: Long)
}

@Dao
interface EquipmentDao {
    @Query("SELECT * FROM equipment WHERE eventId = :eventId ORDER BY category, name COLLATE NOCASE") suspend fun byEvent(eventId: Long): List<EquipmentEntity>
    @Query("SELECT * FROM equipment WHERE id = :id") suspend fun byId(id: Long): EquipmentEntity?
    @Insert suspend fun insert(e: EquipmentEntity): Long
    @Insert suspend fun insertAll(e: List<EquipmentEntity>)
    @Update suspend fun update(e: EquipmentEntity)
    @Query("DELETE FROM equipment WHERE id = :id") suspend fun delete(id: Long)
    @Query("SELECT COUNT(*) FROM equipment WHERE eventId = :eventId") suspend fun count(eventId: Long): Int
}

@Dao
interface PollDao {
    @Query("SELECT * FROM polls WHERE eventId = :eventId ORDER BY createdAt DESC LIMIT 1") suspend fun latest(eventId: Long): PollEntity?
    @Query("SELECT * FROM polls WHERE id = :id") suspend fun byId(id: Long): PollEntity?
    @Insert suspend fun insert(p: PollEntity): Long
    @Update suspend fun update(p: PollEntity)
    @Query("SELECT * FROM poll_votes WHERE pollId = :pollId") suspend fun votes(pollId: Long): List<PollVoteEntity>
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun vote(v: PollVoteEntity)
    @Query("DELETE FROM poll_votes WHERE pollId = :pollId AND memberId = :memberId") suspend fun unvote(pollId: Long, memberId: Long)
}

@Dao
interface XpDao {
    @Query("SELECT * FROM xp_log ORDER BY createdAt DESC") suspend fun all(): List<XpLogEntity>
    @Query("SELECT * FROM xp_log WHERE memberId = :memberId ORDER BY createdAt DESC") suspend fun forMember(memberId: Long): List<XpLogEntity>
    @Insert(onConflict = OnConflictStrategy.IGNORE) suspend fun insert(x: XpLogEntity): Long
    @Query("DELETE FROM xp_log WHERE type = :type AND refId = :refId") suspend fun deleteByRef(type: String, refId: Long)
    @Query("DELETE FROM xp_log WHERE type = :type AND refId = :refId AND memberId = :memberId") suspend fun deleteByRefAndMember(type: String, refId: Long, memberId: Long)
    @Delete suspend fun delete(x: XpLogEntity)
}
