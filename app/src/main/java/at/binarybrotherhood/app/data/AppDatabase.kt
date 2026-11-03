package at.binarybrotherhood.app.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

@Database(
    entities = [
        EventEntity::class, MemberEntity::class, GameEntity::class,
        SessionEntity::class, SessionParticipantEntity::class,
        SuggestionEntity::class, SuggestionVoteEntity::class, SuggestionCommentEntity::class,
        ForumPostEntity::class, ForumCommentEntity::class,
        AttendanceEntity::class, ExpenseEntity::class, ExpenseShareEntity::class, PaymentEntity::class,
        EquipmentEntity::class, PollEntity::class, PollVoteEntity::class, XpLogEntity::class,
        AuthTokenEntity::class, ShareEntity::class,
    ],
    version = 3,
    exportSchema = true,
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
    abstract fun auth(): AuthDao
    abstract fun shares(): ShareDao

    companion object {
        @Volatile private var instance: AppDatabase? = null

        /** v2: Passwort pro Mitglied und Login-Tokens. Bestehende Daten bleiben erhalten. */
        private val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE `members` ADD COLUMN `password` TEXT NOT NULL DEFAULT ''")
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS `auth_tokens` (`tokenHash` TEXT NOT NULL, `memberId` INTEGER NOT NULL, " +
                        "`device` TEXT NOT NULL, `createdAt` INTEGER NOT NULL, `lastUsedAt` INTEGER NOT NULL, PRIMARY KEY(`tokenHash`))"
                )
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_auth_tokens_memberId` ON `auth_tokens` (`memberId`)")
            }
        }

        /** v3: Windows-Freigaben und Ordnerpfad pro Spiel. */
        private val MIGRATION_2_3 = object : Migration(2, 3) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE `games` ADD COLUMN `sharePath` TEXT NOT NULL DEFAULT ''")
                db.execSQL("ALTER TABLE `games` ADD COLUMN `shareId` INTEGER")
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS `shares` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `path` TEXT NOT NULL, " +
                        "`username` TEXT NOT NULL, `password` TEXT NOT NULL, `domain` TEXT NOT NULL, `addedById` INTEGER, `lastScanAt` INTEGER, " +
                        "`lastError` TEXT NOT NULL, `lastCount` INTEGER NOT NULL, `knownFolders` TEXT NOT NULL, `createdAt` INTEGER NOT NULL)"
                )
            }
        }

        fun get(context: Context): AppDatabase = instance ?: synchronized(this) {
            instance ?: Room.databaseBuilder(context.applicationContext, AppDatabase::class.java, "binary_brotherhood.db")
                .addMigrations(MIGRATION_1_2, MIGRATION_2_3)
                .fallbackToDestructiveMigrationOnDowngrade()
                .build()
                .also { instance = it }
        }
    }
}
