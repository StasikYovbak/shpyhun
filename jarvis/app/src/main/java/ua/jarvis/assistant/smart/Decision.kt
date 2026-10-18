package ua.jarvis.assistant.smart

import org.json.JSONObject

/** Рішення Claude на один крок: {"action": "...", "params": {...}, "say": "...", "done": bool, "dangerous": bool}. */
data class Decision(
    val action: String,
    val params: JSONObject,
    val say: String,
    val done: Boolean,
    val dangerous: Boolean,
) {
    fun str(key: String): String = params.optString(key, "").trim()
    fun int(key: String): Int? = if (params.has(key) && !params.isNull(key)) params.optInt(key) else null

    companion object {
        /**
         * Розбирає відповідь. Зі structured outputs це чистий JSON, але на моделях без
         * них відповідь може бути загорнута в ```json … ``` — тоді вирізаємо фігурні дужки.
         */
        fun parse(text: String): Decision {
            val start = text.indexOf('{')
            val end = text.lastIndexOf('}')
            require(start >= 0 && end > start) { "У відповіді немає JSON" }
            val o = JSONObject(text.substring(start, end + 1))
            return Decision(
                action = o.optString("action", "say").trim().ifEmpty { "say" },
                params = o.optJSONObject("params") ?: JSONObject(),
                say = o.optString("say", "").trim(),
                done = o.optBoolean("done", false),
                dangerous = o.optBoolean("dangerous", false),
            )
        }
    }
}
