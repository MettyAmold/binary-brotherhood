package at.binarybrotherhood.app.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

@Database(
    entities = [
        EventEntity::class, MemberEntity::class, GameEntity::class,
        SessionEntity::class, SessionParticipantEntity::class,
        SuggestionEntity::class, SuggestionVoteEntity::class, SuggestionCommentEntity::class,
        ForumPostEntity::class, ForumCommentEntity::class,
        AttendanceEntity::class, ExpenseEntity::class, ExpenseShareEntity::class, PaymentEntity::class,
        EquipmentEntity::class, PollEntity::class, PollVoteEntity::class, XpLogEntity::class,
    ],
    version = 1,
    exportSchema = false,
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun events(): EventDao
    abstract fun members(): MemberDao
    abstract fun games(): GameDao
    abstract fun sessions(): SessionDao
    abstract fun suggestions(): SuggestionDao
    abstract fun forum(): ForumDao
    abstract fun costs(): CostDao
    abstract fun equipment(): EquipmentDao
    abstract fun polls(): PollDao
    abstract fun xp(): XpDao

    companion object {
        @Volatile private var instance: AppDatabase? = null

        fun get(context: Context): AppDatabase = instance ?: synchronized(this) {
            instance ?: Room.databaseBuilder(context.applicationContext, AppDatabase::class.java, "binary_brotherhood.db")
                .fallbackToDestructiveMigration()
                .build()
                .also { instance = it }
        }
    }
}
