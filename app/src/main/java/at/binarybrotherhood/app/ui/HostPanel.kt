package at.binarybrotherhood.app.ui

import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import at.binarybrotherhood.app.server.ServerService
import at.binarybrotherhood.app.util.NetUtils
import at.binarybrotherhood.app.util.QrCode
import kotlinx.coroutines.delay

/** Overlay mit QR-Code, Adressen und Server-Steuerung für den Host. */
@Composable
fun HostPanel(service: ServerService, running: Boolean, clients: Int, onToggleServer: () -> Unit, onShare: () -> Unit, onClose: () -> Unit) {
    val context = LocalContext.current
    var addresses by remember { mutableStateOf(NetUtils.localAddresses(context)) }
    LaunchedEffect(Unit) {
        while (true) {
            addresses = NetUtils.localAddresses(context)
            delay(5000)
        }
    }
    val primary = addresses.firstOrNull()
    val url = primary?.let { "http://$it:${service.server.port}" }
    val qr: Bitmap? = remember(url) { url?.let { QrCode.render(it, 640) } }

    Box(
        modifier = Modifier.fillMaxSize().background(Color(0xCC000000)).clickable(onClick = onClose),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            modifier = Modifier
                .padding(20.dp)
                .clip(RoundedCornerShape(18.dp))
                .background(Panel)
                .clickable(enabled = false) {}
                .padding(20.dp)
                .verticalScroll(rememberScrollState()),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text("MIT DEM WLAN VERBINDEN", style = MaterialTheme.typography.titleMedium, color = Gold)
            Spacer(Modifier.height(6.dp))
            Text("QR-Code scannen oder Adresse im Browser eingeben.", color = Muted, fontSize = 13.sp)
            Spacer(Modifier.height(16.dp))
            if (qr != null) {
                Image(bitmap = qr.asImageBitmap(), contentDescription = "QR-Code", modifier = Modifier.size(220.dp).clip(RoundedCornerShape(12.dp)))
                Spacer(Modifier.height(14.dp))
                Text(url ?: "", color = Parchment, fontSize = 20.sp, fontFamily = FontFamily.Monospace)
            } else {
                Text("Kein WLAN gefunden. Bitte Host-Handy mit dem LAN-WLAN verbinden oder einen Hotspot öffnen.", color = MaterialTheme.colorScheme.error, fontSize = 13.sp)
            }
            if (addresses.size > 1) {
                Spacer(Modifier.height(8.dp))
                Text("Weitere Adressen: " + addresses.drop(1).joinToString(", "), color = Muted, fontSize = 12.sp)
            }
            Spacer(Modifier.height(16.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(if (running) "Server läuft · $clients Client(s)" else "Server gestoppt", color = if (running) Color(0xFF6BBF59) else MaterialTheme.colorScheme.error)
            }
            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = onToggleServer) { Text(if (running) "Server stoppen" else "Server starten") }
                Button(onClick = onShare, enabled = url != null, colors = ButtonDefaults.buttonColors(containerColor = Gold, contentColor = Ink)) { Text("Teilen") }
            }
            Spacer(Modifier.height(12.dp))
            Text("Alle Daten liegen nur auf diesem Handy. Backup: Einstellungen → Apps → Daten sichern.", color = Muted, fontSize = 11.sp)
        }
    }
}
