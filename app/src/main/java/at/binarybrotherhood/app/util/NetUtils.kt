package at.binarybrotherhood.app.util

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import java.net.Inet4Address
import java.net.NetworkInterface

object NetUtils {
    /** Alle lokalen IPv4-Adressen (WLAN zuerst), unter denen der Server erreichbar ist. */
    fun localAddresses(context: Context): List<String> {
        val result = mutableListOf<String>()
        runCatching {
            val interfaces = NetworkInterface.getNetworkInterfaces()?.toList() ?: emptyList()
            for (ni in interfaces) {
                if (!ni.isUp || ni.isLoopback) continue
                for (addr in ni.inetAddresses) {
                    if (addr is Inet4Address && !addr.isLoopbackAddress) {
                        val ip = addr.hostAddress ?: continue
                        val name = ni.name.lowercase()
                        // WLAN (wlan0) und Hotspot (ap0/swlan0) nach vorne
                        if (name.startsWith("wlan") || name.startsWith("ap") || name.startsWith("swlan")) result.add(0, ip) else result.add(ip)
                    }
                }
            }
        }
        return result.distinct()
    }

    fun isOnWifi(context: Context): Boolean {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return false
        val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return false
        return caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
    }
}
