package ua.jarvis.assistant.core

import android.content.Context
import androidx.core.content.edit
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONArray
import org.json.JSONObject

data class LogEntry(val time: Long, val command: String, val result: String, val ok: Boolean)

/** Журнал останніх 20 команд (зберігається між запусками). */
object CommandLog {
    private const val MAX = 20
    private const val KEY = "log"
    private val _entries = MutableStateFlow<List<LogEntry>>(emptyList())
    val entries: StateFlow<List<LogEntry>> = _entries.asStateFlow()

    private fun prefs(ctx: Context) = ctx.applicationContext.getSharedPreferences("jarvis_log", Context.MODE_PRIVATE)

    fun load(ctx: Context) {
        val raw = prefs(ctx).getString(KEY, null) ?: return
        _entries.value = runCatching {
            val arr = JSONArray(raw)
            (0 until arr.length()).map { i ->
                val o = arr.getJSONObject(i)
                LogEntry(o.getLong("t"), o.getString("c"), o.optString("r"), o.optBoolean("ok", true))
            }
        }.getOrDefault(emptyList())
    }

    @Synchronized
    fun add(ctx: Context, command: String, result: String, ok: Boolean) {
        val list = (listOf(LogEntry(System.currentTimeMillis(), command, result, ok)) + _entries.value).take(MAX)
        _entries.value = list
        val arr = JSONArray()
        list.forEach { e ->
            arr.put(JSONObject().put("t", e.time).put("c", e.command).put("r", e.result).put("ok", e.ok))
        }
        prefs(ctx).edit { putString(KEY, arr.toString()) }
    }

    fun clear(ctx: Context) {
        _entries.value = emptyList()
        prefs(ctx).edit { remove(KEY) }
    }
}
