package at.binarybrotherhood.app.server

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.Binder
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleService
import androidx.lifecycle.lifecycleScope
import at.binarybrotherhood.app.R
import at.binarybrotherhood.app.ui.MainActivity
import at.binarybrotherhood.app.util.NetUtils
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch

/**
 * Hält den LAN-Server als Vordergrund-Dienst am Leben (auch bei ausgeschaltetem Display)
 * und verhindert, dass WLAN und CPU schlafen gehen.
 */
class ServerService : LifecycleService() {

    inner class LocalBinder : Binder() {
        val service: ServerService get() = this@ServerService
    }

    private val binder = LocalBinder()
    lateinit var server: LanServer
        private set
    private var wifiLock: WifiManager.WifiLock? = null
    private var wakeLock: PowerManager.WakeLock? = null

    private val _running = MutableStateFlow(false)
    val running: StateFlow<Boolean> = _running

    override fun onCreate() {
        super.onCreate()
        server = LanServer(applicationContext)
        createChannel()
        lifecycleScope.launch {
            server.clientCount.collectLatest { updateNotification() }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        super.onStartCommand(intent, flags, startId)
        when (intent?.action) {
            ACTION_STOP -> {
                stopServer()
                stopSelf()
                return START_NOT_STICKY
            }
            else -> startServer()
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent): IBinder {
        super.onBind(intent)
        return binder
    }

    fun startServer() {
        if (_running.value) return
        startForegroundCompat()
        acquireLocks()
        server.start()
        _running.value = true
        updateNotification()
    }

    fun stopServer() {
        if (!_running.value) return
        server.stop()
        releaseLocks()
        _running.value = false
        stopForeground(STOP_FOREGROUND_REMOVE)
    }

    override fun onDestroy() {
        stopServer()
        super.onDestroy()
    }

    private fun acquireLocks() {
        val wm = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
        wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "bb:wifi").also { it.acquire() }
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "bb:server").also { it.acquire() }
    }

    private fun releaseLocks() {
        wifiLock?.takeIf { it.isHeld }?.release(); wifiLock = null
        wakeLock?.takeIf { it.isHeld }?.release(); wakeLock = null
    }

    private fun createChannel() {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "LAN-Server", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Zeigt an, dass der BINARY BROTHERHOOD Server läuft"
            }
        )
    }

    private fun buildNotification(): Notification {
        val addr = NetUtils.localAddresses(this).firstOrNull()?.let { "http://$it:${server.port}" } ?: "Kein WLAN"
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val stop = PendingIntent.getService(
            this, 1, Intent(this, ServerService::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_server)
            .setContentTitle("BINARY BROTHERHOOD läuft")
            .setContentText("$addr · ${server.clientCount.value} verbunden")
            .setOngoing(true)
            .setContentIntent(open)
            .addAction(0, "Stoppen", stop)
            .build()
    }

    private fun startForegroundCompat() {
        val n = buildNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(NOTIFICATION_ID, n)
        }
    }

    private fun updateNotification() {
        if (!_running.value) return
        getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, buildNotification())
    }

    companion object {
        const val CHANNEL_ID = "bb_server"
        const val NOTIFICATION_ID = 4711
        const val ACTION_STOP = "at.binarybrotherhood.app.STOP"

        fun start(context: Context) {
            ContextCompat.startForegroundService(context, Intent(context, ServerService::class.java))
        }
    }
}
