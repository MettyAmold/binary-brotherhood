package at.binarybrotherhood.app.domain

/**
 * XP-Regeln der Bruderschaft. Jede Aktion wird mit einem (type, refId, memberId)-Schlüssel
 * im XP-Protokoll gespeichert, damit sie nicht doppelt gezählt wird.
 */
object XpRules {
    const val GAME_PLAYED = "game_played"          // Teilnahme an einer gespielten Runde
    const val GAME_ADDED = "game_added"            // Spiel zur Liste hinzugefügt
    const val SUGGESTION_CREATED = "suggestion"    // Vorschlag eingereicht
    const val SUGGESTION_ADOPTED = "suggestion_adopted" // Vorschlag wurde übernommen
    const val FORUM_POST = "forum_post"
    const val FORUM_COMMENT = "forum_comment"
    const val SUGGESTION_COMMENT = "suggestion_comment"
    const val EQUIPMENT_BROUGHT = "equipment"      // Ausrüstung zugesagt und mitgebracht
    const val EXPENSE_PAID = "expense"             // Einkauf vorgestreckt
    const val ATTENDANCE = "attendance"            // Anwesenheitstag
    const val VOTE = "vote"                        // Bei Abstimmung mitgemacht

    fun amount(type: String): Int = when (type) {
        GAME_PLAYED -> 50
        GAME_ADDED -> 20
        SUGGESTION_CREATED -> 15
        SUGGESTION_ADOPTED -> 40
        FORUM_POST -> 10
        FORUM_COMMENT -> 5
        SUGGESTION_COMMENT -> 5
        EQUIPMENT_BROUGHT -> 25
        EXPENSE_PAID -> 15
        ATTENDANCE -> 30
        VOTE -> 5
        else -> 0
    }

    fun label(type: String): String = when (type) {
        GAME_PLAYED -> "Spiel gespielt"
        GAME_ADDED -> "Spiel hinzugefügt"
        SUGGESTION_CREATED -> "Vorschlag eingereicht"
        SUGGESTION_ADOPTED -> "Vorschlag übernommen"
        FORUM_POST -> "Forum-Beitrag"
        FORUM_COMMENT -> "Forum-Kommentar"
        SUGGESTION_COMMENT -> "Kommentar zu Vorschlag"
        EQUIPMENT_BROUGHT -> "Ausrüstung mitgebracht"
        EXPENSE_PAID -> "Einkauf vorgestreckt"
        ATTENDANCE -> "Anwesenheitstag"
        VOTE -> "Abgestimmt"
        else -> type
    }
}

data class LevelInfo(
    val level: Int,
    val rank: String,
    val xp: Int,
    val xpForCurrentLevel: Int,
    val xpForNextLevel: Int,
    val progress: Double,
)

object Levels {
    /** XP-Schwelle für Level n (Level 1 = 0 XP). Wächst quadratisch. */
    fun thresholdFor(level: Int): Int = if (level <= 1) 0 else 50 * (level - 1) * level

    private val ranks = listOf(
        1 to "Novize",
        3 to "Laienbruder",
        5 to "Bruder",
        8 to "Mönch",
        11 to "Prior",
        15 to "Abt",
        20 to "Erzabt",
        26 to "Großmeister",
        33 to "Binärer Erleuchteter",
    )

    fun rankFor(level: Int): String = ranks.last { level >= it.first }.second

    fun forXp(xp: Int): LevelInfo {
        var level = 1
        while (thresholdFor(level + 1) <= xp) level++
        val cur = thresholdFor(level)
        val next = thresholdFor(level + 1)
        val progress = if (next > cur) (xp - cur).toDouble() / (next - cur) else 1.0
        return LevelInfo(level, rankFor(level), xp, cur, next, progress.coerceIn(0.0, 1.0))
    }
}
