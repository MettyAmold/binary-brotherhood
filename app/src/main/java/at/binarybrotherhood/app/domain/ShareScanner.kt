package at.binarybrotherhood.app.domain

import at.binarybrotherhood.app.data.ShareEntity
import jcifs.CIFSContext
import jcifs.config.PropertyConfiguration
import jcifs.context.BaseContext
import jcifs.smb.NtlmPasswordAuthenticator
import jcifs.smb.SmbFile
import java.util.Properties

/**
 * Durchsucht eine Windows-Freigabe (SMB) per jcifs-ng und liefert die Unterordner als Spielkandidaten.
 * Läuft blockierend, also immer auf Dispatchers.IO aufrufen.
 */
object ShareScanner {

    data class Parsed(val host: String, val share: String, val segments: List<String>)

    /** Akzeptiert \\host\freigabe\unter, //host/freigabe, smb://host/freigabe/ und liefert die Bestandteile. */
    fun parse(input: String): Parsed {
        var s = input.trim().removePrefix("smb:").replace('\\', '/').trim('/')
        if (s.isBlank()) throw BadRequestException("Pfad fehlt")
        val parts = s.split('/').filter { it.isNotBlank() }
        if (parts.size < 2) throw BadRequestException("Pfad muss Rechner und Freigabe enthalten, z. B. \\\\192.168.0.10\\Spiele")
        val host = parts[0]
        if (host.contains(':') || host.contains(' ')) throw BadRequestException("Ungültiger Rechnername")
        return Parsed(host, parts[1], parts.drop(2))
    }

    fun normalize(input: String): String {
        val p = parse(input)
        return (listOf("\\\\${p.host}", p.share) + p.segments).joinToString("\\")
    }

    fun listFolders(share: ShareEntity): List<String> {
        val p = parse(share.path)
        val props = Properties().apply {
            setProperty("jcifs.smb.client.minVersion", "SMB1")
            setProperty("jcifs.smb.client.maxVersion", "SMB311")
            setProperty("jcifs.smb.client.connTimeout", "8000")
            setProperty("jcifs.smb.client.responseTimeout", "15000")
            setProperty("jcifs.smb.client.soTimeout", "20000")
            setProperty("jcifs.resolveOrder", "DNS,BCAST")
            setProperty("jcifs.netbios.cachePolicy", "60")
        }
        val base: CIFSContext = BaseContext(PropertyConfiguration(props))
        val ctx = if (share.username.isBlank()) base.withGuestCrendentials()
        else base.withCredentials(NtlmPasswordAuthenticator(share.domain.ifBlank { null }, share.username, share.password))

        var dir = SmbFile("smb://${p.host}/${p.share}/", ctx)
        // Segmentweise absteigen, damit Leerzeichen und Sonderzeichen in Ordnernamen kein URL-Encoding brauchen
        for (seg in p.segments) dir = SmbFile(dir, "$seg/")
        return dir.use { d ->
            d.listFiles().filter { it.isDirectory }.map { it.name.trimEnd('/') }.filter(::isGameFolder).sorted()
        }
    }

    private val SYSTEM_FOLDERS = setOf("system volume information", "\$recycle.bin", "recycler", "found.000", "windows", "program files", "program files (x86)")

    fun isGameFolder(name: String): Boolean {
        val n = name.trim()
        if (n.isEmpty() || n.startsWith(".") || n.startsWith("$") || n.startsWith("_") || n.startsWith("~")) return false
        return n.lowercase() !in SYSTEM_FOLDERS
    }

    /** Vergleichsschlüssel für Dubletten: Kleinschreibung, nur Buchstaben und Ziffern. */
    fun gameKey(name: String): String = name.lowercase().replace(Regex("[^\\p{L}\\p{N}]+"), " ").trim()

    /** Hübscher Anzeigename aus dem Ordnernamen: Unterstriche/Punkte zu Leerzeichen. */
    fun displayName(folder: String): String = folder.replace(Regex("[_.]+"), " ").replace(Regex("\\s+"), " ").trim()
}
