package at.binarybrotherhood.app.ui

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
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
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.isImeVisible
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
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
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import at.binarybrotherhood.app.BuildConfig
import at.binarybrotherhood.app.R
import at.binarybrotherhood.app.update.UpdateManager
import at.binarybrotherhood.app.update.UpdateState

/** Die App zeigt die Cloud-Web-App im WebView und kümmert sich um eigene Updates. */
class MainActivity : ComponentActivity() {

    private lateinit var updateManager: UpdateManager
    private var fileCallback: ValueCallback<Array<Uri>>? = null

    private val fileChooser = registerForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        fileCallback?.onReceiveValue(if (uri != null) arrayOf(uri) else arrayOf())
        fileCallback = null
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        updateManager = UpdateManager(applicationContext, lifecycleScope)
        updateManager.check()
        setContent {
            BinaryBrotherhoodTheme {
                AppScreen(updateManager = updateManager, webViewFactory = ::createWebView)
            }
        }
    }

    override fun onResume() {
        super.onResume()
        updateManager.onResume(this)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createWebView(ctx: Context): WebView = WebView(ctx).apply {
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.allowFileAccess = false
        settings.mediaPlaybackRequiresUserGesture = false
        settings.setSupportZoom(false)
        setBackgroundColor(android.graphics.Color.parseColor("#07090D"))
        val cloudHost = Uri.parse(BuildConfig.CLOUD_URL).host
        webViewClient = object : WebViewClient() {
            // Externe Links (z. B. Steam, Discord) im System-Browser öffnen
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (request.url.host == cloudHost) return false
                runCatching { startActivity(Intent(Intent.ACTION_VIEW, request.url)) }
                return true
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
        loadUrl(BuildConfig.CLOUD_URL)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun AppScreen(updateManager: UpdateManager, webViewFactory: (Context) -> WebView) {
    var showUpdate by remember { mutableStateOf(false) }
    var webView by remember { mutableStateOf<WebView?>(null) }
    val updateState by updateManager.state.collectAsStateWithLifecycle()

    BackHandler(enabled = webView?.canGoBack() == true) { webView?.goBack() }

    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        // imePadding: bei offener Tastatur schrumpft der WebView, damit Dialoge sichtbar bleiben
        Column(modifier = Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().imePadding()) {
            if (!WindowInsets.isImeVisible) TopBar(
                updateAvailable = updateState is UpdateState.Available || updateState is UpdateState.ReadyToInstall,
                onReload = { webView?.reload() },
                onUpdate = {
                    val s = updateManager.state.value
                    if (s is UpdateState.Idle || s is UpdateState.UpToDate || s is UpdateState.Error) { updateManager.reset(); updateManager.check() }
                    showUpdate = true
                },
            )
            Box(modifier = Modifier.fillMaxSize()) {
                AndroidView(factory = { ctx -> webViewFactory(ctx).also { webView = it } }, modifier = Modifier.fillMaxSize())
                if (showUpdate) UpdateDialog(manager = updateManager, onClose = { showUpdate = false })
            }
        }
    }
}

@Composable
private fun TopBar(updateAvailable: Boolean, onReload: () -> Unit, onUpdate: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().background(Panel).padding(horizontal = 12.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Image(painter = painterResource(R.drawable.bb_logo), contentDescription = null, modifier = Modifier.size(32.dp).clip(CircleShape))
        Spacer(Modifier.width(10.dp))
        Text("BINARY BROTHERHOOD", style = MaterialTheme.typography.titleMedium, color = Gold)
        Spacer(Modifier.weight(1f))
        IconButton(onClick = onReload) { Icon(Icons.Default.Refresh, contentDescription = "Neu laden", tint = Muted) }
        IconButton(onClick = onUpdate) {
            Box {
                Icon(painterResource(R.drawable.ic_update), contentDescription = "App-Update", tint = if (updateAvailable) Gold else Muted)
                if (updateAvailable) {
                    Box(Modifier.align(Alignment.TopEnd).offset(x = 3.dp, y = (-3).dp).size(9.dp).clip(CircleShape).background(Color(0xFFE05C5C)))
                }
            }
        }
    }
}
