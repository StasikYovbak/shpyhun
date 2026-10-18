package ua.jarvis.assistant.speech

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.speech.tts.Voice
import android.util.Log
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeoutOrNull
import ua.jarvis.assistant.core.Prefs
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

/**
 * Голос Джарвіса (TextToSpeech), короткі сигнали й вібрація.
 * [onSpeaking] повідомляє сервіс, коли треба «заглушити» мікрофон.
 */
class Speaker(context: Context, private val onSpeaking: (Boolean) -> Unit = {}) : TextToSpeech.OnInitListener {

    private val ctx = context.applicationContext
    private val prefs = Prefs(ctx)
    private val main = Handler(Looper.getMainLooper())
    private val audio = ctx.getSystemService(AudioManager::class.java)
    private val tts = TextToSpeech(ctx, this)
    private val pending = ConcurrentHashMap<String, CompletableDeferred<Unit>>()
    private val active = AtomicInteger(0)
    private val ids = AtomicInteger(0)
    private val queuedBeforeInit = mutableListOf<String>()

    @Volatile var ready = false
        private set

    /** Викликається один раз, коли синтезатор готовий (наприклад, щоб показати список голосів). */
    var onReady: (() -> Unit)? = null

    /** true, якщо на телефоні немає українського голосу (тоді говоримо голосом за замовчуванням). */
    @Volatile var ukrainianMissing = false
        private set

    private val focusRequest = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
        .setAudioAttributes(
            AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ASSISTANT)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build()
        ).build()

    override fun onInit(status: Int) {
        if (status != TextToSpeech.SUCCESS) {
            Log.e(TAG, "TTS init failed: $status")
            return
        }
        tts.setAudioAttributes(
            AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ASSISTANT)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build()
        )
        tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) {}
            override fun onDone(utteranceId: String?) = finished(utteranceId)
            @Deprecated("Deprecated in Java")
            override fun onError(utteranceId: String?) = finished(utteranceId)
            override fun onError(utteranceId: String?, errorCode: Int) = finished(utteranceId)
            override fun onStop(utteranceId: String?, interrupted: Boolean) = finished(utteranceId)
        })
        applySettings()
        ready = true
        main.post { onReady?.invoke() }
        synchronized(queuedBeforeInit) {
            queuedBeforeInit.forEach { speak(it) }
            queuedBeforeInit.clear()
        }
    }

    fun applySettings() {
        val uk = Locale.forLanguageTag("uk-UA")
        val res = tts.setLanguage(uk)
        ukrainianMissing = res == TextToSpeech.LANG_MISSING_DATA || res == TextToSpeech.LANG_NOT_SUPPORTED
        val wanted = prefs.ttsVoice
        if (wanted.isNotBlank()) {
            runCatching { tts.voices?.firstOrNull { it.name == wanted }?.let { tts.voice = it } }
        }
        tts.setSpeechRate(prefs.ttsRate)
        tts.setPitch(prefs.ttsPitch)
    }

    /** Українські голоси, встановлені на телефоні. */
    fun ukrainianVoices(): List<Voice> = runCatching {
        tts.voices.orEmpty().filter { it.locale.language == "uk" }.sortedBy { it.name }
    }.getOrDefault(emptyList())

    private fun finished(id: String?) {
        if (id == null) return
        val d = pending.remove(id) ?: return
        if (active.decrementAndGet() <= 0) {
            active.set(0)
            audio.abandonAudioFocusRequest(focusRequest)
            // невелика пауза, щоб мікрофон не впіймав «хвіст» репліки
            main.postDelayed({ if (active.get() == 0) onSpeaking(false) }, 350)
        }
        d.complete(Unit)
    }

    /** Сказати й не чекати. */
    fun speak(text: String): CompletableDeferred<Unit> {
        val done = CompletableDeferred<Unit>()
        if (text.isBlank()) { done.complete(Unit); return done }
        if (!ready) {
            synchronized(queuedBeforeInit) { queuedBeforeInit += text }
            done.complete(Unit)
            return done
        }
        val id = "u" + ids.incrementAndGet()
        pending[id] = done
        if (active.getAndIncrement() == 0) {
            onSpeaking(true)
            audio.requestAudioFocus(focusRequest)
        }
        val r = tts.speak(text, TextToSpeech.QUEUE_ADD, Bundle(), id)
        if (r != TextToSpeech.SUCCESS) finished(id)
        return done
    }

    /** Сказати й дочекатися кінця (але не довше за 20 с). */
    suspend fun say(text: String) {
        val d = speak(text)
        withTimeoutOrNull(20_000) { d.await() }
    }

    fun stopSpeaking() {
        tts.stop()
        pending.keys.toList().forEach { finished(it) }
    }

    // ---------------------------------------------------------------- сигнали

    fun signalStart() = feedback(ToneGenerator.TONE_PROP_BEEP, 120, longArrayOf(0, 60))
    fun signalDone() = feedback(ToneGenerator.TONE_PROP_ACK, 160, longArrayOf(0, 40, 60, 40))
    fun signalCancel() = feedback(ToneGenerator.TONE_PROP_NACK, 200, longArrayOf(0, 150))

    private fun feedback(tone: Int, ms: Int, pattern: LongArray) {
        if (prefs.beep) {
            runCatching {
                val tg = ToneGenerator(AudioManager.STREAM_MUSIC, 70)
                tg.startTone(tone, ms)
                main.postDelayed({ tg.release() }, ms + 200L)
            }
        }
        if (prefs.vibrate) vibrate(pattern)
    }

    private fun vibrate(pattern: LongArray) {
        val v: Vibrator? = if (Build.VERSION.SDK_INT >= 31) {
            ctx.getSystemService(VibratorManager::class.java)?.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            ctx.getSystemService(Vibrator::class.java)
        }
        runCatching { v?.vibrate(VibrationEffect.createWaveform(pattern, -1)) }
    }

    fun shutdown() {
        runCatching { tts.stop(); tts.shutdown() }
        pending.values.forEach { it.complete(Unit) }
        pending.clear()
    }

    companion object {
        private const val TAG = "Speaker"
    }
}
