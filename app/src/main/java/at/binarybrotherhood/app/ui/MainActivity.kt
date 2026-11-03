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
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.Button
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
import at.binarybrotherhood.app.R
import at.binarybrotherhood.app.server.LanServer
import at.binarybrotherhood.app.server.ServerService
import at.binarybrotherhood.app.update.UpdateManager
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
                HostScreen(
                    service = service,
                    updateManager = updateManager,
                    onToggleServer = { s -> if (s.running.value) s.stopServer() else s.startServer() },
                    onReload = { webView?.reload() },
                    onShare = { shareAddress() },
                    webViewFactory = { ctx -> createWebView(ctx) },
                )
            }
        }
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else {
            startAndBind()
        }
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
                // Externe Links (z. B. Steam) im System-Browser öffnen
                return if (url.host == "127.0.0.1" || url.host == "localhost") false else {
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
        loadUrl("http://127.0.0.1:${LanServer.DEFAULT_PORT}/")
    }
}

@Composable
private fun HostScreen(
    service: ServerService?,
    updateManager: UpdateManager,
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
        Column(modifier = Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().imePadding()) {
            TopBar(
                running = running,
                clients = clients,
                updateAvailable = updateState is UpdateState.Available || updateState is UpdateState.ReadyToInstall,
                onHost = { showHost = !showHost },
                onReload = onReload,
                onUpdate = {
                    val s = updateManager.state.value
                    if (s is UpdateState.Idle || s is UpdateState.UpToDate || s is UpdateState.Error) { updateManager.reset(); updateManager.check() }
                    showUpdate = true
                },
            )
            Box(modifier = Modifier.fillMaxSize()) {
                if (running) {
                    AndroidView(
                        factory = { ctx -> webViewFactory(ctx).also { webViewRef = it } },
                        modifier = Modifier.fillMaxSize(),
                    )
                } else {
                    StartingPanel(service = service, onToggleServer = onToggleServer)
                }
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
private fun TopBar(running: Boolean, clients: Int, updateAvailable: Boolean, onHost: () -> Unit, onReload: () -> Unit, onUpdate: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().background(Panel).padding(horizontal = 12.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Image(painter = painterResource(R.drawable.bb_logo), contentDescription = null, modifier = Modifier.size(32.dp).clip(CircleShape))
        Spacer(Modifier.width(10.dp))
        Text("BINARY BROTHERHOOD", style = MaterialTheme.typography.titleMedium, color = Gold)
        Spacer(Modifier.weight(1f))
        Box(
            modifier = Modifier.clip(RoundedCornerShape(50)).background(if (running) Color(0xFF1E3A2A) else Color(0xFF3A1E1E)).padding(horizontal = 10.dp, vertical = 4.dp),
        ) {
            Text(if (running) "● $clients online" else "○ gestoppt", fontSize = 12.sp, color = if (running) Color(0xFF6BBF59) else Color(0xFFE05C5C))
        }
        IconButton(onClick = onReload) { Icon(Icons.Default.Refresh, contentDescription = "Neu laden", tint = Muted) }
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
        IconButton(onClick = onHost) { Icon(Icons.Default.Share, contentDescription = "Host-Info", tint = Gold) }
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
