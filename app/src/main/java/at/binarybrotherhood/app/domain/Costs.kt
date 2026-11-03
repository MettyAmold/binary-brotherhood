package at.binarybrotherhood.app.domain

import kotlin.math.abs
import kotlin.math.roundToLong

/** Eingabedaten für die Kostenberechnung (unabhängig von Room). */
data class ExpenseInput(
    val id: Long,
    val amountCents: Long,
    val paidById: Long,
    val day: Int?,
    val explicitParticipants: List<Long>,
)

data class PaymentInput(val fromId: Long, val toId: Long, val amountCents: Long)

data class ShareResult(val memberId: Long, val cents: Long)

data class MemberBalance(
    val memberId: Long,
    val paidCents: Long,
    val owedCents: Long,
    val settledOutCents: Long,
    val settledInCents: Long,
) {
    /** > 0: bekommt Geld, < 0: schuldet Geld */
    val netCents: Long get() = paidCents - owedCents + settledOutCents - settledInCents
}

data class Transfer(val fromId: Long, val toId: Long, val cents: Long)

data class CostSummary(
    val totalCents: Long,
    val balances: List<MemberBalance>,
    val transfers: List<Transfer>,
    val shares: Map<Long, List<ShareResult>>,
)

object CostSplitter {

    /**
     * Teilt einen Einkauf fair auf:
     *  - explizite Teilnehmer → gleich verteilt
     *  - Tages-Einkauf → unter den an diesem Tag Anwesenden
     *  - ganze LAN → gewichtet nach Anzahl der Anwesenheitstage
     * Rundungsreste (Cent) werden deterministisch verteilt, sodass die Summe stimmt.
     */
    fun split(expense: ExpenseInput, attendance: Map<Long, Set<Int>>, allMemberIds: List<Long>): List<ShareResult> {
        val weights: Map<Long, Double> = when {
            expense.explicitParticipants.isNotEmpty() -> expense.explicitParticipants.associateWith { 1.0 }
            expense.day != null -> {
                val present = attendance.filter { expense.day in it.value }.keys
                val base = if (present.isNotEmpty()) present else attendance.filter { it.value.isNotEmpty() }.keys
                (if (base.isNotEmpty()) base else setOf(expense.paidById)).associateWith { 1.0 }
            }
            else -> {
                val w = attendance.filter { it.value.isNotEmpty() }.mapValues { it.value.size.toDouble() }
                if (w.isNotEmpty()) w else mapOf(expense.paidById to 1.0)
            }
        }.filterKeys { it in allMemberIds || it == expense.paidById }

        val total = weights.values.sum()
        if (total <= 0.0) return listOf(ShareResult(expense.paidById, expense.amountCents))

        val ordered = weights.entries.sortedBy { it.key }
        val raw = ordered.map { it.key to expense.amountCents * it.value / total }
        val floored = raw.map { it.first to kotlin.math.floor(it.second).toLong() }.toMutableList()
        var rest = expense.amountCents - floored.sumOf { it.second }
        // Restcent an die mit dem größten Nachkommaanteil, danach reihum
        val byFraction = raw.indices.sortedByDescending { raw[it].second - kotlin.math.floor(raw[it].second) }
        var i = 0
        while (rest > 0 && byFraction.isNotEmpty()) {
            val idx = byFraction[i % byFraction.size]
            floored[idx] = floored[idx].first to floored[idx].second + 1
            rest--
            i++
        }
        return floored.map { ShareResult(it.first, it.second) }
    }

    fun summarize(
        memberIds: List<Long>,
        expenses: List<ExpenseInput>,
        payments: List<PaymentInput>,
        attendance: Map<Long, Set<Int>>,
    ): CostSummary {
        val paid = mutableMapOf<Long, Long>()
        val owed = mutableMapOf<Long, Long>()
        val out = mutableMapOf<Long, Long>()
        val inn = mutableMapOf<Long, Long>()
        val shares = mutableMapOf<Long, List<ShareResult>>()

        for (e in expenses) {
            paid[e.paidById] = (paid[e.paidById] ?: 0) + e.amountCents
            val s = split(e, attendance, memberIds)
            shares[e.id] = s
            for (sh in s) owed[sh.memberId] = (owed[sh.memberId] ?: 0) + sh.cents
        }
        for (p in payments) {
            out[p.fromId] = (out[p.fromId] ?: 0) + p.amountCents
            inn[p.toId] = (inn[p.toId] ?: 0) + p.amountCents
        }
        val ids = (memberIds + paid.keys + owed.keys + out.keys + inn.keys).distinct()
        val balances = ids.map {
            MemberBalance(it, paid[it] ?: 0, owed[it] ?: 0, out[it] ?: 0, inn[it] ?: 0)
        }
        return CostSummary(expenses.sumOf { it.amountCents }, balances, settle(balances), shares)
    }

    /** Greedy-Ausgleich: größter Schuldner zahlt an größten Gläubiger, bis alle bei 0 sind. */
    fun settle(balances: List<MemberBalance>): List<Transfer> {
        val creditors = balances.filter { it.netCents > 0 }.map { it.memberId to it.netCents }.sortedByDescending { it.second }.toMutableList()
        val debtors = balances.filter { it.netCents < 0 }.map { it.memberId to -it.netCents }.sortedByDescending { it.second }.toMutableList()
        val result = mutableListOf<Transfer>()
        var ci = 0
        var di = 0
        while (ci < creditors.size && di < debtors.size) {
            val (cId, cAmt) = creditors[ci]
            val (dId, dAmt) = debtors[di]
            val amt = minOf(cAmt, dAmt)
            if (amt > 0) result += Transfer(dId, cId, amt)
            creditors[ci] = cId to cAmt - amt
            debtors[di] = dId to dAmt - amt
            if (creditors[ci].second == 0L) ci++
            if (debtors[di].second == 0L) di++
        }
        return result
    }

    fun formatEuro(cents: Long): String {
        val sign = if (cents < 0) "-" else ""
        val a = abs(cents)
        return "$sign${a / 100},${(a % 100).toString().padStart(2, '0')} €"
    }

    fun parseEuroToCents(text: String): Long? {
        val cleaned = text.trim().replace("€", "").replace(" ", "").replace(",", ".")
        val v = cleaned.toDoubleOrNull() ?: return null
        return (v * 100).roundToLong()
    }
}
