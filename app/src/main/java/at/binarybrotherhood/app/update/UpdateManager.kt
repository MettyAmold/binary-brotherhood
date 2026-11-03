package at.binarybrotherhood.app.update

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.core.content.FileProvider
import at.binarybrotherhood.app.BuildConfig
import io.ktor.client.HttpClient
import io.ktor.client.engine.cio.CIO
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.prepareGet
import io.ktor.client.statement.bodyAsChannel
import io.ktor.client.statement.bodyAsText
import io.ktor.http.contentLength
import io.ktor.utils.io.readAvailable
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import java.io.File
import java.util.concurrent.CancellationException

/** Ein auf GitHub veröffentlichter Build mit APK-Asset. */
data class ReleaseInfo(
    val versionCode: Int,
    val versionName: String,
    val tag: String,
    val prerelease: Boolean,
    val apkUrl: String,
    val apkName: String,
    val sizeBytes: Long,
    val notes: String,
    val htmlUrl: String,
)

sealed class UpdateState {
    data object Idle : UpdateState()
    data object Checking : UpdateState()
    data object UpToDate : UpdateState()
    data class Available(val release: ReleaseInfo) : UpdateState()
    /** [progress] in 0..1, null solange die Größe unbekannt ist. */
    data class Downloading(val release: ReleaseInfo, val progress: Float?) : UpdateState()
    data class ReadyToInstall(val release: ReleaseInfo, val file: File, val needsPermission: Boolean = false) : UpdateState()
    data class Error(val message: String) : UpdateState()
}

/**
 * Selbst-Update über die GitHub-Releases des Projekts.
 *
 * Der Workflow schreibt in jede Release-Beschreibung einen Marker `<!-- versionCode: N -->`.
 * Darüber wird verglichen, nicht über den Versionsnamen, denn der versionCode (= Build-Nummer)
 * ist streng monoton. Releases ohne Marker werden ignoriert.
 *
 * Kanal-Logik: Ist ein Dev-Build installiert (Versionsname enthält „-dev“), werden auch
 * Pre-Releases (das Rolling-Release „latest“) angeboten; sonst nur reguläre Releases.
 */
class UpdateManager(private val context: Context, private val scope: CoroutineScope) {

    private val _state = MutableStateFlow<UpdateState>(UpdateState.Idle)
    val state: StateFlow<UpdateState> = _state.asStateFlow()

    private val client = HttpClient(CIO) {
        engine { requestTimeout = 0 }
        install(HttpTimeout) {
            connectTimeoutMillis = 15_000
            requestTimeoutMillis = 10 * 60_000
        }
    }
    private val json = Json { ignoreUnknownKeys = true }
    private var downloadJob: Job? = null
    /** Installer nach Rückkehr aus den Einstellungen automatisch starten. */
    private var pendingInstall = false

    val installedVersionName: String get() = BuildConfig.VERSION_NAME
    val installedVersionCode: Int get() = BuildConfig.VERSION_CODE
    private val devChannel get() = installedVersionName.contains("-dev")

    /** Sucht nach einem neueren Build. Laufende Downloads werden nicht unterbrochen. */
    fun check() {
        val s = _state.value
        if (s is UpdateState.Checking || s is UpdateState.Downloading || s is UpdateState.ReadyToInstall) return
        _state.value = UpdateState.Checking
        scope.launch {
            _state.value = try {
                val newest = fetchReleases()
                    .filter { devChannel || !it.prerelease }
                    .maxByOrNull { it.versionCode }
                if (newest != null && newest.versionCode > installedVersionCode) UpdateState.Available(newest) else UpdateState.UpToDate
            } catch (e: Exception) {
                UpdateState.Error("Update-Prüfung fehlgeschlagen: ${e.message ?: e.javaClass.simpleName}")
            }
        }
    }

    /** Lädt die APK des angebotenen Releases und startet danach den Installer. */
    fun downloadAndInstall(activity: Activity) {
        val release = (_state.value as? UpdateState.Available)?.release ?: return
        _state.value = UpdateState.Downloading(release, null)
        downloadJob = scope.launch {
            try {
                val file = withContext(Dispatchers.IO) { download(release) }
                _state.value = UpdateState.ReadyToInstall(release, file)
                install(activity)
            } catch (e: CancellationException) {
                _state.value = UpdateState.Available(release)
            } catch (e: Exception) {
                _state.value = UpdateState.Error("Download fehlgeschlagen: ${e.message ?: e.javaClass.simpleName}")
            }
        }
    }

    fun cancelDownload() {
        downloadJob?.cancel()
    }

    /**
     * Öffnet den System-Installer. Fehlt die Erlaubnis „Unbekannte Apps installieren“, werden die
     * Einstellungen geöffnet; nach der Rückkehr ruft [onResume] den Installer automatisch auf.
     */
    fun install(activity: Activity) {
        val s = _state.value as? UpdateState.ReadyToInstall ?: return
        if (!context.packageManager.canRequestPackageInstalls()) {
            pendingInstall = true
            _state.value = s.copy(needsPermission = true)
            runCatching {
                activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}")))
            }
            return
        }
        pendingInstall = false
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", s.file)
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        _state.value = s.copy(needsPermission = false)
        runCatching { activity.startActivity(intent) }
            .onFailure { _state.value = UpdateState.Error("Installer konnte nicht geöffnet werden: ${it.message}") }
    }

    fun onResume(activity: Activity) {
        if (pendingInstall && context.packageManager.canRequestPackageInstalls()) install(activity)
    }

    /** Zurück in den Ausgangszustand, z. B. nach „Später“. */
    fun reset() {
        if (_state.value !is UpdateState.Downloading) _state.value = UpdateState.Idle
    }

    private suspend fun fetchReleases(): List<ReleaseInfo> {
        val text = client.get("$API_BASE/releases?per_page=15") {
            header("Accept", "application/vnd.github+json")
            header("User-Agent", "BinaryBrotherhood/$installedVersionName")
        }.bodyAsText()
        return json.parseToJsonElement(text).jsonArray.mapNotNull { el ->
            val o = el.jsonObject
            if (o["draft"]?.jsonPrimitive?.booleanOrNull == true) return@mapNotNull null
            val body = o["body"]?.jsonPrimitive?.content ?: ""
            val code = VERSION_CODE_MARKER.find(body)?.groupValues?.get(1)?.toIntOrNull() ?: return@mapNotNull null
            val apk = o["assets"]?.jsonArray?.map { it.jsonObject }?.firstOrNull { it["name"]?.jsonPrimitive?.content?.endsWith(".apk") == true }
                ?: return@mapNotNull null
            val tag = o["tag_name"]?.jsonPrimitive?.content ?: return@mapNotNull null
            ReleaseInfo(
                versionCode = code,
                versionName = VERSION_NAME_MARKER.find(body)?.groupValues?.get(1) ?: tag.removePrefix("v"),
                tag = tag,
                prerelease = o["prerelease"]?.jsonPrimitive?.booleanOrNull == true,
                apkUrl = apk["browser_download_url"]?.jsonPrimitive?.content ?: return@mapNotNull null,
                apkName = apk["name"]?.jsonPrimitive?.content ?: "update.apk",
                sizeBytes = apk["size"]?.jsonPrimitive?.longOrNull ?: 0L,
                notes = body.replace(MARKER_LINE, "").trim(),
                htmlUrl = o["html_url"]?.jsonPrimitive?.content ?: "",
            )
        }
    }

    private suspend fun download(release: ReleaseInfo): File {
        val dir = File(context.cacheDir, "updates").apply { mkdirs() }
        dir.listFiles()?.forEach { it.delete() }
        val target = File(dir, release.apkName.replace(Regex("[^A-Za-z0-9._-]"), "_"))
        client.prepareGet(release.apkUrl) {
            header("User-Agent", "BinaryBrotherhood/$installedVersionName")
        }.execute { response ->
            val total = response.contentLength() ?: release.sizeBytes.takeIf { it > 0 }
            val channel = response.bodyAsChannel()
            val buffer = ByteArray(64 * 1024)
            var done = 0L
            target.outputStream().use { out ->
                while (true) {
                    val n = channel.readAvailable(buffer, 0, buffer.size)
                    if (n <= 0) break
                    out.write(buffer, 0, n)
                    done += n
                    _state.value = UpdateState.Downloading(release, total?.let { (done.toFloat() / it).coerceIn(0f, 1f) })
                }
            }
        }
        if (target.length() == 0L) throw IllegalStateException("Leere Datei")
        return target
    }

    companion object {
        const val REPO = "MettyAmold/binary-brotherhood"
        const val RELEASES_URL = "https://github.com/$REPO/releases"
        private const val API_BASE = "https://api.github.com/repos/$REPO"
        private val VERSION_CODE_MARKER = Regex("""<!--\s*versionCode:\s*(\d+)\s*-->""")
        private val VERSION_NAME_MARKER = Regex("""<!--\s*versionName:\s*(\S+)\s*-->""")
        private val MARKER_LINE = Regex("""<!--\s*version\w+:[^>]*-->\s*""")
    }
}
