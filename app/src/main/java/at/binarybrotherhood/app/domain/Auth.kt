package at.binarybrotherhood.app.domain

import at.binarybrotherhood.app.data.AppDatabase
import at.binarybrotherhood.app.data.AuthTokenEntity
import at.binarybrotherhood.app.data.MemberEntity
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

class UnauthorizedException(msg: String) : RuntimeException(msg)
class ForbiddenException(msg: String) : RuntimeException(msg)

/**
 * Login mit Passwort pro Profil und Geräte-Tokens.
 *
 * Passwörter werden mit PBKDF2-HMAC-SHA256 gehasht. Der Browser bekommt beim Login ein zufälliges
 * Token, in der Datenbank liegt nur dessen SHA-256. Tokens bleiben über Server-Neustarts gültig,
 * bis sich jemand abmeldet oder das Passwort geändert/zurückgesetzt wird.
 */
class AuthService(private val db: AppDatabase) {

    data class Session(val member: MemberEntity, val tokenHash: String)

    private val random = SecureRandom()

    suspend fun resolve(token: String?): Session? {
        if (token.isNullOrBlank()) return null
        val hash = sha256(token)
        val t = db.auth().byHash(hash) ?: return null
        val m = db.members().byId(t.memberId) ?: run { db.auth().delete(hash); return null }
        val now = System.currentTimeMillis()
        if (now - t.lastUsedAt > 10 * 60_000) db.auth().touch(hash, now)
        return Session(m, hash)
    }

    /** Login; bei Profilen ohne Passwort wird das übergebene Passwort beim ersten Login festgelegt. */
    suspend fun login(memberId: Long, password: String, device: String): Pair<MemberEntity, String> {
        val m = db.members().byId(memberId) ?: throw NotFoundException("Profil nicht gefunden")
        if (m.password.isEmpty()) {
            validatePassword(password)
            db.members().setPassword(m.id, hash(password))
        } else if (!verify(password, m.password)) {
            throw UnauthorizedException("Falsches Passwort")
        }
        return db.members().byId(m.id)!! to issueToken(m.id, device)
    }

    suspend fun issueToken(memberId: Long, device: String): String {
        val bytes = ByteArray(32).also { random.nextBytes(it) }
        val token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
        val now = System.currentTimeMillis()
        db.auth().insert(AuthTokenEntity(tokenHash = sha256(token), memberId = memberId, device = device.take(120), createdAt = now, lastUsedAt = now))
        return token
    }

    suspend fun logout(tokenHash: String) = db.auth().delete(tokenHash)

    suspend fun setPassword(memberId: Long, password: String) {
        validatePassword(password)
        db.members().setPassword(memberId, hash(password))
    }

    suspend fun changePassword(memberId: Long, old: String, new: String) {
        val m = db.members().byId(memberId) ?: throw NotFoundException("Profil nicht gefunden")
        if (m.password.isNotEmpty() && !verify(old, m.password)) throw UnauthorizedException("Altes Passwort ist falsch")
        validatePassword(new)
        db.members().setPassword(memberId, hash(new))
        db.auth().deleteForMember(memberId) // alle Geräte abmelden
    }

    /** Host-Funktion: Passwort löschen, das Mitglied legt beim nächsten Login ein neues fest. */
    suspend fun resetPassword(memberId: Long) {
        db.members().byId(memberId) ?: throw NotFoundException("Profil nicht gefunden")
        db.members().setPassword(memberId, "")
        db.auth().deleteForMember(memberId)
    }

    fun validatePassword(pw: String) {
        if (pw.length < 4) throw BadRequestException("Passwort muss mindestens 4 Zeichen haben")
        if (pw.length > 128) throw BadRequestException("Passwort ist zu lang")
    }

    fun hash(password: String): String {
        val salt = ByteArray(16).also { random.nextBytes(it) }
        val derived = pbkdf2(password, salt, ITERATIONS)
        return "pbkdf2:$ITERATIONS:${b64(salt)}:${b64(derived)}"
    }

    fun verify(password: String, stored: String): Boolean {
        val parts = stored.split(":")
        if (parts.size != 4 || parts[0] != "pbkdf2") return false
        val iterations = parts[1].toIntOrNull() ?: return false
        val salt = runCatching { Base64.getDecoder().decode(parts[2]) }.getOrNull() ?: return false
        val expected = runCatching { Base64.getDecoder().decode(parts[3]) }.getOrNull() ?: return false
        return MessageDigest.isEqual(pbkdf2(password, salt, iterations), expected)
    }

    private fun pbkdf2(password: String, salt: ByteArray, iterations: Int): ByteArray {
        val spec = PBEKeySpec(password.toCharArray(), salt, iterations, 256)
        return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded
    }

    private fun b64(b: ByteArray) = Base64.getEncoder().encodeToString(b)

    companion object {
        private const val ITERATIONS = 50_000
        fun sha256(s: String): String = MessageDigest.getInstance("SHA-256").digest(s.toByteArray()).joinToString("") { "%02x".format(it) }
    }
}
