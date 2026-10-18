@file:Suppress("DEPRECATION") // EncryptedSharedPreferences/MasterKey позначено застарілими, але вони робочі й безпечні

package ua.jarvis.assistant.core

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.core.content.edit
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Усі налаштування застосунку.
 * Звичайні — у SharedPreferences, API-ключі — в EncryptedSharedPreferences
 * (ключ шифрування живе в апаратному сховищі Android Keystore).
 */
class Prefs(context: Context) {

    private val app = context.applicationContext
    private val plain: SharedPreferences = app.getSharedPreferences("jarvis_prefs", Context.MODE_PRIVATE)
    private val secure: SharedPreferences by lazy { openSecure() }

    private fun openSecure(): SharedPreferences {
        fun create(): SharedPreferences {
            val key = MasterKey.Builder(app).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
            return EncryptedSharedPreferences.create(
                app, SECURE_FILE, key,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
            )
        }
        return try {
            create()
        } catch (e: Exception) {
            // Буває після відновлення з резервної копії: старий файл не розшифрувати.
            Log.w(TAG, "Encrypted prefs broken, recreating", e)
            app.deleteSharedPreferences(SECURE_FILE)
            create()
        }
    }

    // ---- головне
    var enabled: Boolean
        get() = plain.getBoolean("enabled", false)
        set(v) = plain.edit { putBoolean("enabled", v) }

    var onboardingDone: Boolean
        get() = plain.getBoolean("onboarding_done", false)
        set(v) = plain.edit { putBoolean("onboarding_done", v) }

    // ---- слова
    var wakeWord: String
        get() = plain.getString("wake_word", null)?.takeIf { it.isNotBlank() } ?: DEFAULT_WAKE
        set(v) = plain.edit { putString("wake_word", v.trim()) }

    /** Як модель іноді чує слово активації: «джервіс, жарвіс». Через кому. */
    var wakeVariants: String
        get() = plain.getString("wake_variants", DEFAULT_WAKE_VARIANTS) ?: ""
        set(v) = plain.edit { putString("wake_variants", v) }

    var execWord: String
        get() = plain.getString("exec_word", null)?.takeIf { it.isNotBlank() } ?: DEFAULT_EXEC
        set(v) = plain.edit { putString("exec_word", v.trim()) }

    var cancelWord: String
        get() = plain.getString("cancel_word", null)?.takeIf { it.isNotBlank() } ?: DEFAULT_CANCEL
        set(v) = plain.edit { putString("cancel_word", v.trim()) }

    var timeoutSec: Int
        get() = plain.getInt("timeout_sec", 30)
        set(v) = plain.edit { putInt("timeout_sec", v.coerceIn(5, 300)) }

    // ---- розумний режим
    var claudeKey: String
        get() = secure.getString("claude_key", "") ?: ""
        set(v) = secure.edit { putString("claude_key", v.trim()) }

    var claudeModel: String
        get() = plain.getString("claude_model", null)?.takeIf { it.isNotBlank() } ?: DEFAULT_MODEL
        set(v) = plain.edit { putString("claude_model", v.trim()) }

    /** low / medium / high — наскільки глибоко Claude думає. Для голосу краще low: швидше. */
    var claudeEffort: String
        get() = plain.getString("claude_effort", "low") ?: "low"
        set(v) = plain.edit { putString("claude_effort", v) }

    var smartMode: Boolean
        get() = plain.getBoolean("smart_mode", true)
        set(v) = plain.edit { putBoolean("smart_mode", v) }

    /** Виправляти через Claude назви пісень, почуті українською моделлю («білівер» → «Believer»). */
    var fixSongNames: Boolean
        get() = plain.getBoolean("fix_song_names", true)
        set(v) = plain.edit { putBoolean("fix_song_names", v) }

    // ---- YouTube
    var youtubeKey: String
        get() = secure.getString("youtube_key", "") ?: ""
        set(v) = secure.edit { putString("youtube_key", v.trim()) }

    // ---- голос
    var ttsVoice: String
        get() = plain.getString("tts_voice", "") ?: ""
        set(v) = plain.edit { putString("tts_voice", v) }

    var ttsRate: Float
        get() = plain.getFloat("tts_rate", 1.0f)
        set(v) = plain.edit { putFloat("tts_rate", v) }

    var ttsPitch: Float
        get() = plain.getFloat("tts_pitch", 1.0f)
        set(v) = plain.edit { putFloat("tts_pitch", v) }

    var beep: Boolean
        get() = plain.getBoolean("beep", true)
        set(v) = plain.edit { putBoolean("beep", v) }

    var vibrate: Boolean
        get() = plain.getBoolean("vibrate", true)
        set(v) = plain.edit { putBoolean("vibrate", v) }

    /** Казати «Виконую» перед дією. */
    var sayAck: Boolean
        get() = plain.getBoolean("say_ack", true)
        set(v) = plain.edit { putBoolean("say_ack", v) }

    // ---- розпізнавання
    var modelId: String
        get() = plain.getString("model_id", "uk-small") ?: "uk-small"
        set(v) = plain.edit { putString("model_id", v) }

    /** none / en / ru — друга модель для назв пісень. */
    var extraLang: String
        get() = plain.getString("extra_lang", "none") ?: "none"
        set(v) = plain.edit { putString("extra_lang", v) }

    val hasClaude get() = claudeKey.isNotBlank()
    val hasYouTube get() = youtubeKey.isNotBlank()

    companion object {
        private const val TAG = "JarvisPrefs"
        private const val SECURE_FILE = "jarvis_secrets"
        const val DEFAULT_WAKE = "Джарвіс"
        const val DEFAULT_WAKE_VARIANTS = "джарвис, джервіс, жарвіс"
        const val DEFAULT_EXEC = "Виконуй"
        const val DEFAULT_CANCEL = "Скасуй"
        const val DEFAULT_MODEL = "claude-opus-5-5"
    }
}
