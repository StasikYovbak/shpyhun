package ua.jarvis.assistant.actions

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Request
import org.json.JSONObject
import ua.jarvis.assistant.core.Http
import java.io.IOException

/**
 * Пошук відео через YouTube Data API v3 (метод search.list).
 * Один пошук коштує 100 одиниць квоти з 10 000 безкоштовних на добу — тобто ~100 пісень на день.
 */
class YouTubeApi {

    data class Video(val id: String, val title: String, val channel: String)

    class YouTubeException(message: String) : Exception(message)

    suspend fun searchFirst(query: String, apiKey: String): Video = withContext(Dispatchers.IO) {
        val url = "https://www.googleapis.com/youtube/v3/search".toHttpUrl().newBuilder()
            .addQueryParameter("part", "snippet")
            .addQueryParameter("type", "video")
            .addQueryParameter("maxResults", "5")
            .addQueryParameter("q", query)
            .addQueryParameter("key", apiKey)
            .build()
        val body = try {
            Http.client.newCall(Request.Builder().url(url).build()).execute().use { resp ->
                val text = resp.body?.string().orEmpty()
                if (!resp.isSuccessful) throw YouTubeException(explainError(resp.code, text))
                text
            }
        } catch (e: IOException) {
            throw YouTubeException("Немає з'єднання з YouTube")
        }
        val items = JSONObject(body).optJSONArray("items")
        for (i in 0 until (items?.length() ?: 0)) {
            val it = items!!.getJSONObject(i)
            val id = it.optJSONObject("id")?.optString("videoId").orEmpty()
            if (id.isNotBlank()) {
                val sn = it.optJSONObject("snippet")
                return@withContext Video(id, unescape(sn?.optString("title").orEmpty()), sn?.optString("channelTitle").orEmpty())
            }
        }
        throw YouTubeException("На YouTube нічого не знайшлося")
    }

    private fun explainError(code: Int, body: String): String {
        val reason = runCatching {
            JSONObject(body).getJSONObject("error").getJSONArray("errors").getJSONObject(0).optString("reason")
        }.getOrDefault("")
        return when {
            reason == "quotaExceeded" -> "Вичерпано денну квоту YouTube API. Спробуйте завтра"
            reason == "keyInvalid" || code == 400 && body.contains("API key not valid") -> "Ключ YouTube API недійсний"
            reason == "accessNotConfigured" || body.contains("has not been used") ->
                "У Google Cloud не ввімкнено YouTube Data API v3 для цього ключа"
            code == 403 -> "YouTube відмовив у доступі. Перевірте обмеження ключа"
            else -> "Помилка YouTube API: $code"
        }
    }

    private fun unescape(s: String) = s.replace("&quot;", "\"").replace("&#39;", "'").replace("&amp;", "&")
}
