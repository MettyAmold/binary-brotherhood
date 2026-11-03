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

    fun listFolders(share: ShareEntity): List<String> = listFolders(share.path, share.username, share.password, share.domain)

    private fun context(username: String, password: String, domain: String): CIFSContext {
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
        return if (username.isBlank()) base.withGuestCrendentials()
        else base.withCredentials(NtlmPasswordAuthenticator(domain.ifBlank { null }, username, password))
    }

    fun listFolders(path: String, username: String, password: String, domain: String = ""): List<String> {
        val p = parse(path)
        var dir = SmbFile("smb://${p.host}/${p.share}/", context(username, password, domain))
        // Segmentweise absteigen, damit Leerzeichen und Sonderzeichen in Ordnernamen kein URL-Encoding brauchen
        for (seg in p.segments) dir = SmbFile(dir, "$seg/")
        return dir.use { d ->
            d.listFiles().filter { it.isDirectory }.map { it.name.trimEnd('/') }.filter(::isGameFolder).sorted()
        }
    }

    /** Freigaben eines Rechners (ohne versteckte wie C$, IPC$). */
    fun listShares(host: String, username: String, password: String, domain: String = ""): List<String> {
        if (host.isBlank() || host.contains('/') || host.contains('\\')) throw BadRequestException("Ungültiger Rechnername")
        return SmbFile("smb://$host/", context(username, password, domain)).use { root ->
            root.listFiles().map { it.name.trimEnd('/') }.filter { !it.endsWith("$") }.sorted()
        }
    }

    /** Übersetzt jcifs-Fehler in Hinweise, mit denen Laien etwas anfangen können. */
    fun hint(e: Throwable): String {
        val msg = (e.message ?: "").lowercase()
        val name = e.javaClass.simpleName
        return when {
            name == "SmbAuthException" || msg.contains("logon fail") || msg.contains("access denied") && msg.contains("logon") ->
                "Anmeldung abgelehnt: Benutzer oder Passwort stimmen nicht, oder das Einrichtungs-Skript wurde noch nicht ausgeführt. Gastzugriff blockiert Windows meist."
            msg.contains("bad_network_name") || msg.contains("network name cannot be found") || msg.contains("invalid name") ->
                "Die Freigabe gibt es auf diesem PC nicht. Freigabename prüfen oder das Einrichtungs-Skript ausführen."
            msg.contains("access denied") || msg.contains("access_denied") ->
                "Zugriff verweigert: Der Benutzer darf den Ordner nicht lesen. Freigabe- und NTFS-Rechte prüfen."
            name == "UnknownHostException" || msg.contains("unknown host") || msg.contains("failed to connect") || msg.contains("timed out") || msg.contains("timeout") || msg.contains("connection refused") || msg.contains("unreachable") ->
                "PC nicht erreichbar: gleiches WLAN? Windows-Netzwerkprofil auf „Privat“? Firewall-Regel „Datei- und Druckerfreigabe“ aktiv? Am besten die IP-Adresse statt des Namens verwenden."
            msg.contains("object_name_not_found") || msg.contains("cannot find the file") || msg.contains("not found") ->
                "Den Unterordner gibt es nicht. Pfad prüfen."
            else -> "Verbindung fehlgeschlagen: ${e.message ?: name}"
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
