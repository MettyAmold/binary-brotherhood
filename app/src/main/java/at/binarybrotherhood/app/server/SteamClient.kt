package at.binarybrotherhood.app.server

import io.ktor.client.HttpClient
import io.ktor.client.engine.cio.CIO
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.statement.bodyAsText
import io.ktor.http.encodeURLParameter
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * Öffentliche Steam-Store-Endpunkte (kein API-Key nötig). Das Host-Handy braucht dafür Internet;
 * ohne Internet bleibt die manuelle Eingabe möglich.
 */
class SteamClient {
    private val client = HttpClient(CIO) {
        engine { requestTimeout = 10_000 }
    }
    private val json = Json { ignoreUnknownKeys = true }

    suspend fun search(term: String): List<SteamResultDto> {
        if (term.isBlank()) return emptyList()
        val url = "https://store.steampowered.com/api/storesearch/?term=${term.encodeURLParameter()}&l=german&cc=AT"
        val text = client.get(url) { header("User-Agent", "BinaryBrotherhood/1.0") }.bodyAsText()
        val root = json.parseToJsonElement(text).jsonObject
        val items = root["items"]?.jsonArray ?: return emptyList()
        return items.mapNotNull { el ->
            val o = el.jsonObject
            val id = o["id"]?.jsonPrimitive?.content?.toLongOrNull() ?: return@mapNotNull null
            val name = o["name"]?.jsonPrimitive?.content ?: return@mapNotNull null
            val img = o["tiny_image"]?.jsonPrimitive?.content ?: ""
            val price = o["price"]?.let { p ->
                runCatching {
                    val po = p.jsonObject
                    val cents = po["final"]?.jsonPrimitive?.content?.toLongOrNull()
                    val cur = po["currency"]?.jsonPrimitive?.content ?: "EUR"
                    cents?.let { "${it / 100},${(it % 100).toString().padStart(2, '0')} $cur" }
                }.getOrNull()
            }
            SteamResultDto(id, name, img, price)
        }
    }

    suspend fun details(appId: Long): SteamDetailsDto? {
        val url = "https://store.steampowered.com/api/appdetails?appids=$appId&l=german&cc=AT"
        val text = client.get(url) { header("User-Agent", "BinaryBrotherhood/1.0") }.bodyAsText()
        val root = json.parseToJsonElement(text).jsonObject
        val entry = root[appId.toString()]?.jsonObject ?: return null
        if (entry["success"]?.jsonPrimitive?.content != "true") return null
        val data = entry["data"]?.jsonObject ?: return null
        val name = data["name"]?.jsonPrimitive?.content ?: return null
        val desc = data["short_description"]?.jsonPrimitive?.content ?: ""
        val img = data["header_image"]?.jsonPrimitive?.content ?: ""
        return SteamDetailsDto(appId, name, stripHtml(desc), img, "https://store.steampowered.com/app/$appId/")
    }

    private fun stripHtml(s: String) = s.replace(Regex("<[^>]*>"), "").replace("&quot;", "\"").replace("&amp;", "&").replace("&#39;", "'").trim()

    companion object {
        /** Extrahiert die App-ID aus einem Steam-Link, z. B. https://store.steampowered.com/app/620/Portal_2/ */
        fun appIdFromUrl(url: String): Long? = Regex("""/app/(\d+)""").find(url)?.groupValues?.get(1)?.toLongOrNull()
    }
}
