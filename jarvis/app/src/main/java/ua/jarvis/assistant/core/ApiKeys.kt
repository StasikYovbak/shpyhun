package ua.jarvis.assistant.core

/** Де отримати ключі й як упізнати їх у скопійованому тексті. */
object ApiKeys {

    const val CLAUDE_KEYS_URL = "https://platform.claude.com/settings/keys"
    const val CLAUDE_BILLING_URL = "https://platform.claude.com/settings/billing"
    const val YOUTUBE_ENABLE_URL = "https://console.cloud.google.com/apis/library/youtube.googleapis.com"
    const val YOUTUBE_CREDENTIALS_URL = "https://console.cloud.google.com/apis/credentials"

    private val CLAUDE = Regex("sk-ant-[A-Za-z0-9_-]{20,}")
    private val YOUTUBE = Regex("AIza[0-9A-Za-z_-]{35}")

    /**
     * Ключ Claude із буфера обміну. Сайт іноді копіює зайве (пробіли, перенос рядка,
     * назву ключа поруч) — тому шукаємо сам ключ усередині тексту.
     */
    fun extractClaude(text: CharSequence?): String? = text?.let { CLAUDE.find(it)?.value }

    /** Ключ Google API: «AIza» і ще 35 символів. */
    fun extractYouTube(text: CharSequence?): String? = text?.let { YOUTUBE.find(it)?.value }
}
