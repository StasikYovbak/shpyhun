package ua.jarvis.assistant.speech

import android.annotation.SuppressLint
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Handler
import android.os.Looper
import android.util.Log
import org.json.JSONObject
import org.vosk.Model
import org.vosk.Recognizer

/**
 * Безперервне офлайн-розпізнавання: мікрофон → Vosk → текст.
 *
 * Свій цикл AudioRecord замість готового SpeechService з Vosk потрібен для того, щоб:
 *  - «глушити» мікрофон, поки Джарвіс говорить сам (інакше почує власне «Виконую»);
 *  - паралельно годувати другу модель (англійську/російську) під час запису команди.
 *
 * Колбеки [Listener] викликаються в головному потоці.
 */
class SpeechEngine(
    private val mainModel: Model,
    private val extraModel: Model?,
    private val listener: Listener,
) {
    interface Listener {
        fun onPartial(text: String)
        fun onFinal(text: String, extra: String?)
        fun onEngineError(message: String)
    }

    @Volatile var muted = false
        set(value) {
            if (field && !value) resetRequested = true
            field = value
        }

    /** Годувати другу модель (вмикається на час запису команди). */
    @Volatile var captureExtra = false
        set(value) {
            if (value && !field) extraResetRequested = true
            field = value
        }

    @Volatile private var running = false
    @Volatile private var resetRequested = false
    @Volatile private var extraResetRequested = false
    private var thread: Thread? = null
    private val main = Handler(Looper.getMainLooper())

    fun start() {
        if (running) return
        running = true
        thread = Thread(::loop, "jarvis-audio").apply {
            priority = Thread.MAX_PRIORITY
            start()
        }
    }

    fun stop() {
        running = false
        thread?.join(1500)
        thread = null
    }

    /** Забути недосказане (наприклад, після власної репліки або тайм-ауту). */
    fun reset() {
        resetRequested = true
    }

    @SuppressLint("MissingPermission") // дозвіл перевіряє сервіс перед стартом
    private fun loop() {
        var recognizer: Recognizer? = null
        var extra: Recognizer? = null
        var audio: AudioRecord? = null
        try {
            recognizer = Recognizer(mainModel, SAMPLE_RATE.toFloat()).apply {
                setMaxAlternatives(0)
                setWords(false)
            }
            extra = extraModel?.let { Recognizer(it, SAMPLE_RATE.toFloat()) }

            val minBuf = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
            audio = AudioRecord(
                MediaRecorder.AudioSource.VOICE_RECOGNITION,
                SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT,
                maxOf(minBuf, SAMPLE_RATE) * 2,
            )
            if (audio.state != AudioRecord.STATE_INITIALIZED) {
                post { listener.onEngineError("Мікрофон недоступний (його зайняла інша програма?)") }
                return
            }
            audio.startRecording()

            val buf = ShortArray(SAMPLE_RATE / 10) // 100 мс
            var lastPartial = ""
            var extraText = StringBuilder()
            var errors = 0

            while (running) {
                val n = audio.read(buf, 0, buf.size)
                if (n < 0) {
                    if (++errors > 20) {
                        post { listener.onEngineError("Помилка мікрофона: $n") }
                        return
                    }
                    Thread.sleep(50)
                    continue
                }
                errors = 0
                if (n == 0) continue

                if (muted) {
                    lastPartial = ""
                    continue
                }
                if (resetRequested) {
                    resetRequested = false
                    recognizer.reset()
                    lastPartial = ""
                }
                if (extra != null) {
                    if (extraResetRequested) {
                        extraResetRequested = false
                        extra.reset()
                        extraText = StringBuilder()
                    }
                    if (captureExtra) extra.acceptWaveForm(buf, n)
                }

                if (recognizer.acceptWaveForm(buf, n)) {
                    val text = textOf(recognizer.result, "text")
                    var extraOut: String? = null
                    if (extra != null && captureExtra) {
                        extraText.append(' ').append(textOf(extra.finalResult, "text"))
                        extraOut = extraText.toString().trim()
                    }
                    lastPartial = ""
                    if (text.isNotBlank()) post { listener.onFinal(text, extraOut) }
                } else {
                    val p = textOf(recognizer.partialResult, "partial")
                    if (p != lastPartial) {
                        lastPartial = p
                        if (p.isNotBlank()) post { listener.onPartial(p) }
                    }
                }
            }
        } catch (e: Throwable) {
            Log.e(TAG, "audio loop failed", e)
            post { listener.onEngineError(e.message ?: e.javaClass.simpleName) }
        } finally {
            runCatching { audio?.stop() }
            runCatching { audio?.release() }
            runCatching { recognizer?.close() }
            runCatching { extra?.close() }
        }
    }

    private fun post(block: () -> Unit) {
        main.post { if (running) block() }
    }

    private fun textOf(json: String, field: String): String =
        runCatching { JSONObject(json).optString(field, "") }.getOrDefault("").trim()

    companion object {
        private const val TAG = "SpeechEngine"
        const val SAMPLE_RATE = 16000
    }
}
