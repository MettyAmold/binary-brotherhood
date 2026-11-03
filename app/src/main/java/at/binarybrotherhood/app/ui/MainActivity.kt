package at.binarybrotherhood.app.ui

import android.Manifest
import android.annotation.SuppressLint
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.isImeVisible
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.TextButton
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import at.binarybrotherhood.app.BuildConfig
import at.binarybrotherhood.app.R
import at.binarybrotherhood.app.server.LanServer
import at.binarybrotherhood.app.server.ServerService
import at.binarybrotherhood.app.domain.Repository
import at.binarybrotherhood.app.update.UpdateManager
import io.ktor.client.HttpClient
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import at.binarybrotherhood.app.update.UpdateState
import at.binarybrotherhood.app.util.NetUtils

/**
 * Host-Oberfläche: startet den Server, zeigt die Adresse/QR-Code und bettet die Web-App ein,
 * sodass der Host dieselbe Oberfläche wie alle Browser-Teilnehmer nutzt.
 */
class MainActivity : ComponentActivity() {

    private var service by mutableStateOf<ServerService?>(null)
    private var bound = false
    private var webView: WebView? = null
    private lateinit var updateManager: UpdateManager
    /** Ergebnis- oder Fehlertext der Übertragung der Handy-Daten in die Cloud (null = kein Dialog) */
    private var transferMessage by mutableStateOf<String?>(null)
    private var transferRunning by mutableStateOf(false)

    /** Liest das Login-Token der Web-App aus dem WebView (localStorage). */
    private suspend fun webToken(): String? = suspendCancellableCoroutine { cont ->
        val wv = webView ?: return@suspendCancellableCoroutine cont.resume(null)
        wv.evaluateJavascript("localStorage.getItem('bb.token')") { v ->
            cont.resume(v?.trim('"')?.takeIf { it.isNotBlank() && it != "null" })
        }
    }

    /** Exportiert die lokale Datenbank des Handys und führt sie in der Cloud zusammen (Admin-Login nötig). */
    private fun transferToCloud() {
        if (transferRunning) return
        transferRunning = true
        lifecycleScope.launch {
            transferMessage = try {
                val token = webToken() ?: error("Bitte zuerst in der App als Admin anmelden.")
                val json = withContext(Dispatchers.IO) { Repository(applicationContext).exportAll().toString() }
                val client = HttpClient(OkHttp)
                val res = client.post("${BuildConfig.CLOUD_URL}/api/admin/merge") {
                    header("Authorization", "Bearer $token")
                    contentType(ContentType.Application.Json)
                    setBody(json)
                }
                val body = res.bodyAsText()
                client.close()
                if (!res.status.isSuccess()) error(Regex("\"error\":\"([^\"]*)\"").find(body)?.groupValues?.get(1) ?: "Fehler ${res.status.value}")
                val added = Regex("\"(\\w+)\":(\\d+)").findAll(body.substringAfter("\"added\":")).map { "${it.groupValues[1]}: ${it.groupValues[2]}" }.joinToString(", ")
                "Zusammengeführt. Neu in der Cloud: ${added.ifBlank { "nichts, alles war schon vorhanden" }}"
            } catch (e: Exception) {
                "Übertragung fehlgeschlagen: ${e.message ?: e.javaClass.simpleName}"
            }
            transferRunning = false
        }
    }
    private var fileCallback: ValueCallback<Array<Uri>>? = null

    private val fileChooser = registerForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        fileCallback?.onReceiveValue(if (uri != null) arrayOf(uri) else arrayOf())
        fileCallback = null
    }

    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { startAndBind() }

    private val connection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, binder: IBinder?) {
            service = (binder as ServerService.LocalBinder).service
            service?.startServer()
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            service = null
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        updateManager = UpdateManager(applicationContext, lifecycleScope)
        updateManager.check() // beim Start still prüfen; bei neuer Version leuchtet das Update-Symbol
        setContent {
            BinaryBrotherhoodTheme {
                transferMessage?.let { msg ->
                    AlertDialog(
                        onDismissRequest = { transferMessage = null },
                        confirmButton = { TextButton(onClick = { transferMessage = null; webView?.reload() }) { Text("OK") } },
                        title = { Text("Handy-Daten in die Cloud") },
                        text = { Text(msg) },
                    )
                }
                HostScreen(
                    service = service,
                    updateManager = updateManager,
                    onTransfer = { transferToCloud() },
                    transferRunning = transferRunning,
                    onToggleServer = { s -> if (s.running.value) s.stopServer() else s.startServer() },
                    onReload = { webView?.reload() },
                    onShare = { shareAddress() },
                    webViewFactory = { ctx -> createWebView(ctx) },
                )
            }
        }
        // Die App ist ein Client der Cloud-Variante; der LAN-Server (ServerService) wird nicht mehr gestartet.
    }

    override fun onResume() {
        super.onResume()
        updateManager.onResume(this)
    }

    private fun startAndBind() {
        ServerService.start(this)
        if (!bound) {
            bindService(Intent(this, ServerService::class.java), connection, Context.BIND_AUTO_CREATE)
            bound = true
        }
    }

    override fun onDestroy() {
        if (bound) {
            unbindService(connection)
            bound = false
        }
        super.onDestroy()
    }

    private fun shareAddress() {
        val port = service?.server?.port ?: LanServer.DEFAULT_PORT
        val addr = NetUtils.localAddresses(this).firstOrNull() ?: return
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, "BINARY BROTHERHOOD LAN-App: http://$addr:$port")
        }
        startActivity(Intent.createChooser(intent, "Adresse teilen"))
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createWebView(ctx: Context): WebView = WebView(ctx).apply {
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.allowFileAccess = false
        settings.mediaPlaybackRequiresUserGesture = false
        settings.setSupportZoom(false)
        setBackgroundColor(android.graphics.Color.parseColor("#07090D"))
        webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                // Externe Links (z. B. Steam) im System-Browser öffnen, die Cloud-App selbst bleibt im WebView
                val cloudHost = Uri.parse(BuildConfig.CLOUD_URL).host
                return if (url.host == cloudHost || url.host == "127.0.0.1" || url.host == "localhost") false else {
                    runCatching { startActivity(Intent(Intent.ACTION_VIEW, url)) }
                    true
                }
            }
        }
        webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(webView: WebView, filePathCallback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(arrayOf())
                fileCallback = filePathCallback
                fileChooser.launch("image/*")
                return true
            }
        }
        webView = this
        loadUrl(BuildConfig.CLOUD_URL)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun HostScreen(
    service: ServerService?,
    updateManager: UpdateManager,
    onTransfer: () -> Unit,
    transferRunning: Boolean,
    onToggleServer: (ServerService) -> Unit,
    onReload: () -> Unit,
    onShare: () -> Unit,
    webViewFactory: (Context) -> WebView,
) {
    val running by (service?.running ?: remember { kotlinx.coroutines.flow.MutableStateFlow(false) }).collectAsStateWithLifecycle()
    val clients by (service?.server?.clientCount ?: remember { kotlinx.coroutines.flow.MutableStateFlow(0) }).collectAsStateWithLifecycle()
    var showHost by remember { mutableStateOf(false) }
    var showUpdate by remember { mutableStateOf(false) }
    val updateState by updateManager.state.collectAsStateWithLifecycle()
    var webViewRef by remember { mutableStateOf<WebView?>(null) }

    BackHandler(enabled = showHost || (webViewRef?.canGoBack() == true)) {
        if (showHost) showHost = false else webViewRef?.goBack()
    }

    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        // imePadding: bei offener Tastatur schrumpft der WebView, sonst verdeckt sie die unten verankerten Dialoge
        val imeVisible = WindowInsets.isImeVisible
        Column(modifier = Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().imePadding()) {
            // Bei offener Tastatur die Leiste ausblenden, damit Dialoge im WebView mehr Höhe bekommen
            if (!imeVisible) TopBar(
                running = running,
                clients = clients,
                updateAvailable = updateState is UpdateState.Available || updateState is UpdateState.ReadyToInstall,
                onHost = { showHost = !showHost },
                onReload = onReload,
                onTransfer = onTransfer,
                transferRunning = transferRunning,
                onUpdate = {
                    val s = updateManager.state.value
                    if (s is UpdateState.Idle || s is UpdateState.UpToDate || s is UpdateState.Error) { updateManager.reset(); updateManager.check() }
                    showUpdate = true
                },
            )
            Box(modifier = Modifier.fillMaxSize()) {
                AndroidView(
                    factory = { ctx -> webViewFactory(ctx).also { webViewRef = it } },
                    modifier = Modifier.fillMaxSize(),
                )
                if (showHost && service != null) {
                    HostPanel(service = service, running = running, clients = clients, onToggleServer = { onToggleServer(service) }, onShare = onShare, onClose = { showHost = false })
                }
                if (showUpdate) {
                    UpdateDialog(manager = updateManager, onClose = { showUpdate = false })
                }
            }
        }
    }
}

@Composable
private fun TopBar(running: Boolean, clients: Int, updateAvailable: Boolean, onHost: () -> Unit, onReload: () -> Unit, onUpdate: () -> Unit, onTransfer: () -> Unit, transferRunning: Boolean) {
    var menuOpen by remember { mutableStateOf(false) }
    Row(
        modifier = Modifier.fillMaxWidth().background(Panel).padding(horizontal = 12.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Image(painter = painterResource(R.drawable.bb_logo), contentDescription = null, modifier = Modifier.size(32.dp).clip(CircleShape))
        Spacer(Modifier.width(10.dp))
        Text("BINARY BROTHERHOOD", style = MaterialTheme.typography.titleMedium, color = Gold)
        Spacer(Modifier.weight(1f))
        IconButton(onClick = onReload) { Icon(Icons.Default.Refresh, contentDescription = "Neu laden", tint = Muted) }
        Box {
            IconButton(onClick = { menuOpen = true }) { Icon(Icons.Default.MoreVert, contentDescription = "Menü", tint = Muted) }
            DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                DropdownMenuItem(
                    text = { Text(if (transferRunning) "Übertrage …" else "Handy-Daten in die Cloud übertragen") },
                    enabled = !transferRunning,
                    onClick = { menuOpen = false; onTransfer() },
                )
            }
        }
        IconButton(onClick = onUpdate) {
            Box {
                Icon(painterResource(R.drawable.ic_update), contentDescription = "App-Update", tint = if (updateAvailable) Gold else Muted)
                if (updateAvailable) {
                    Box(
                        modifier = Modifier
                            .align(Alignment.TopEnd)
                            .offset(x = 3.dp, y = (-3).dp)
                            .size(9.dp)
                            .clip(CircleShape)
                            .background(Color(0xFFE05C5C)),
                    )
                }
            }
        }
    }
}

@Composable
private fun StartingPanel(service: ServerService?, onToggleServer: (ServerService) -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Image(painter = painterResource(R.drawable.bb_logo), contentDescription = null, modifier = Modifier.size(200.dp))
        Spacer(Modifier.height(24.dp))
        Text("BINARY BROTHERHOOD", style = MaterialTheme.typography.titleLarge, color = Gold)
        Spacer(Modifier.height(8.dp))
        if (service == null) {
            CircularProgressIndicator(color = Gold)
            Spacer(Modifier.height(8.dp))
            Text("Server wird gestartet …", color = Muted)
        } else {
            Text("Der Server ist gestoppt.", color = Muted)
            Spacer(Modifier.height(16.dp))
            Button(onClick = { onToggleServer(service) }) { Text("Server starten") }
        }
    }
}
