package at.binarybrotherhood.app.ui

import android.app.Activity
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import at.binarybrotherhood.app.update.UpdateManager
import at.binarybrotherhood.app.update.UpdateState

/** Dialog für Prüfung, Download und Installation eines neuen Builds von GitHub. */
@Composable
fun UpdateDialog(manager: UpdateManager, onClose: () -> Unit) {
    val state by manager.state.collectAsStateWithLifecycle()
    val activity = LocalContext.current as Activity
    val gold = ButtonDefaults.buttonColors(containerColor = Gold, contentColor = Ink)

    AlertDialog(
        onDismissRequest = { if (state !is UpdateState.Downloading) onClose() },
        containerColor = Panel,
        titleContentColor = Gold,
        textContentColor = Parchment,
        title = { Text("APP-UPDATE", style = MaterialTheme.typography.titleMedium) },
        text = {
            Column(modifier = Modifier.fillMaxWidth()) {
                Text("Installiert: ${manager.installedVersionName} (Build ${manager.installedVersionCode})", color = Muted, fontSize = 12.sp)
                Spacer(Modifier.height(10.dp))
                when (val s = state) {
                    UpdateState.Idle, UpdateState.Checking -> {
                        LinearProgressIndicator(modifier = Modifier.fillMaxWidth(), color = Gold)
                        Spacer(Modifier.height(8.dp))
                        Text("Suche auf GitHub nach neuen Versionen …")
                    }
                    UpdateState.UpToDate -> Text("Du hast bereits die neueste Version.")
                    is UpdateState.Available -> {
                        val r = s.release
                        Text("Neue Version ${r.versionName} (Build ${r.versionCode})" + if (r.prerelease) " · Dev-Build" else "", color = Gold)
                        Text("${r.apkName} · ${r.sizeBytes / 1024 / 1024} MB", color = Muted, fontSize = 12.sp)
                        if (r.notes.isNotBlank()) {
                            Spacer(Modifier.height(8.dp))
                            Text(r.notes.take(1500), fontSize = 12.sp, color = Muted, modifier = Modifier.heightIn(max = 180.dp).verticalScroll(rememberScrollState()))
                        }
                    }
                    is UpdateState.Downloading -> {
                        Text("Lade Version ${s.release.versionName} herunter …")
                        Spacer(Modifier.height(8.dp))
                        if (s.progress != null) {
                            LinearProgressIndicator(progress = { s.progress }, modifier = Modifier.fillMaxWidth(), color = Gold)
                            Spacer(Modifier.height(4.dp))
                            Text("${(s.progress * 100).toInt()} %", color = Muted, fontSize = 12.sp)
                        } else {
                            LinearProgressIndicator(modifier = Modifier.fillMaxWidth(), color = Gold)
                        }
                    }
                    is UpdateState.ReadyToInstall -> {
                        Text("Version ${s.release.versionName} ist heruntergeladen.")
                        if (s.needsPermission) {
                            Spacer(Modifier.height(8.dp))
                            Text("Bitte in den Einstellungen „Installation aus dieser Quelle erlauben“ aktivieren und zurückkehren. Die Installation startet dann automatisch.", color = Color(0xFFE0B35C), fontSize = 12.sp)
                        } else {
                            Spacer(Modifier.height(8.dp))
                            Text("Falls der Installer nicht erscheint, hier erneut starten.", color = Muted, fontSize = 12.sp)
                        }
                    }
                    is UpdateState.Error -> Text(s.message, color = MaterialTheme.colorScheme.error)
                }
            }
        },
        confirmButton = {
            when (state) {
                is UpdateState.Available -> Button(onClick = { manager.downloadAndInstall(activity) }, colors = gold) { Text("Jetzt aktualisieren") }
                is UpdateState.ReadyToInstall -> Button(onClick = { manager.install(activity) }, colors = gold) { Text("Installieren") }
                UpdateState.UpToDate, is UpdateState.Error -> Button(onClick = { manager.reset(); manager.check() }, colors = gold) { Text("Erneut prüfen") }
                else -> {}
            }
        },
        dismissButton = {
            when (state) {
                is UpdateState.Downloading -> TextButton(onClick = { manager.cancelDownload() }) { Text("Abbrechen", color = Muted) }
                else -> TextButton(onClick = onClose) { Text(if (state is UpdateState.Available) "Später" else "Schließen", color = Muted) }
            }
        },
    )
}
