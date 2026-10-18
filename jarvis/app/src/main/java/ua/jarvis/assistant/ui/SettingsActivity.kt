package ua.jarvis.assistant.ui

import android.content.ActivityNotFoundException
import android.content.ClipboardManager
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.widget.ArrayAdapter
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updatePadding
import androidx.lifecycle.lifecycleScope
import com.google.android.material.button.MaterialButton
import com.google.android.material.textfield.TextInputEditText
import kotlinx.coroutines.launch
import ua.jarvis.assistant.R
import ua.jarvis.assistant.actions.YouTubeApi
import ua.jarvis.assistant.core.ApiKeys
import ua.jarvis.assistant.core.Prefs
import ua.jarvis.assistant.databinding.ActivitySettingsBinding
import ua.jarvis.assistant.service.JarvisService
import ua.jarvis.assistant.smart.ClaudeAgent
import ua.jarvis.assistant.speech.ModelManager
import ua.jarvis.assistant.speech.Speaker
import ua.jarvis.assistant.speech.VoskModels
import java.util.Locale

class SettingsActivity : AppCompatActivity() {

    private lateinit var b: ActivitySettingsBinding
    private lateinit var prefs: Prefs
    private lateinit var models: ModelManager
    private var speaker: Speaker? = null
    private var voiceNames: List<String> = emptyList()

    private val effortValues = listOf("low", "medium", "high")
    private val effortLabels = listOf("low — найшвидше (рекомендовано для голосу)", "medium — баланс", "high — найрозумніше, повільніше")
    private val extraValues = listOf("none", "en", "ru")
    private val extraLabels = listOf("Немає", "Англійська (+40 МБ)", "Російська (+45 МБ)")
    private val modelSuggestions = listOf("claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1")

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        b = ActivitySettingsBinding.inflate(layoutInflater)
        setContentView(b.root)
        prefs = Prefs(this)
        models = ModelManager(this)
        ViewCompat.setOnApplyWindowInsetsListener(b.content) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            v.updatePadding(top = bars.top + dp(12), bottom = bars.bottom + dp(16))
            insets
        }
        b.btnBack.setOnClickListener { finish() }
        load()
        wire()
        speaker = Speaker(this).also { sp -> sp.onReady = { fillVoices(sp) } }
    }

    private fun load() {
        b.wakeWord.setText(prefs.wakeWord)
        b.wakeVariants.setText(prefs.wakeVariants)
        b.execWord.setText(prefs.execWord)
        b.cancelWord.setText(prefs.cancelWord)
        b.timeout.value = (prefs.timeoutSec.coerceIn(10, 120) / 5 * 5).toFloat()
        b.timeoutLabel.text = "Тайм-аут запису команди: ${prefs.timeoutSec} с"

        b.smartMode.isChecked = prefs.smartMode
        b.claudeKey.setText(prefs.claudeKey)
        b.claudeModel.setText(prefs.claudeModel)
        b.claudeModel.setSimpleItems(modelSuggestions.toTypedArray())
        b.claudeEffort.setAdapter(ArrayAdapter(this, android.R.layout.simple_list_item_1, effortLabels))
        b.claudeEffort.setText(effortLabels[effortValues.indexOf(prefs.claudeEffort).coerceAtLeast(0)], false)
        b.fixSongs.isChecked = prefs.fixSongNames

        b.youtubeKey.setText(prefs.youtubeKey)

        b.ttsRate.value = prefs.ttsRate.coerceIn(0.5f, 2.0f).roundTo(0.1f)
        b.ttsPitch.value = prefs.ttsPitch.coerceIn(0.5f, 2.0f).roundTo(0.1f)
        b.beep.isChecked = prefs.beep
        b.vibrate.isChecked = prefs.vibrate
        b.sayAck.isChecked = prefs.sayAck

        b.modelSmall.text = VoskModels.UK_SMALL.title + " — ${VoskModels.UK_SMALL.zipSizeMb} МБ"
        b.modelNano.text = VoskModels.UK_NANO.title + " — ${VoskModels.UK_NANO.zipSizeMb} МБ"
        if (prefs.modelId == VoskModels.UK_NANO.id) b.modelNano.isChecked = true else b.modelSmall.isChecked = true
        b.extraLang.setAdapter(ArrayAdapter(this, android.R.layout.simple_list_item_1, extraLabels))
        b.extraLang.setText(extraLabels[extraValues.indexOf(prefs.extraLang).coerceAtLeast(0)], false)
        renderModels()
    }

    private fun wire() {
        b.timeout.addOnChangeListener { _, v, _ -> b.timeoutLabel.text = "Тайм-аут запису команди: ${v.toInt()} с" }

        b.btnTestClaude.setOnClickListener { testClaude() }
        b.btnTestYoutube.setOnClickListener { testYouTube() }

        b.btnGetClaude.setOnClickListener {
            showKeyGuide(
                "Ключ Claude API",
                "Сайт англійською, тож назви кнопок подано так, як на ньому.\n\n" +
                    "1. «Поповнити рахунок»: увійдіть або зареєструйтеся, далі Buy credits. Без коштів ключ не працює.\n\n" +
                    "2. «Створити ключ»: Create key → назва «Jarvis» → скопіюйте ключ (sk-ant-…). " +
                    "Його показують лише один раз.\n\n" +
                    "3. Поверніться в Джарвіс і натисніть «Вставити».\n\n" +
                    "Якщо це вікно зникло, коли ви поверталися, знову натисніть «Отримати ключ».",
                listOf(
                    "1. Поповнити рахунок" to ApiKeys.CLAUDE_BILLING_URL,
                    "2. Створити ключ" to ApiKeys.CLAUDE_KEYS_URL,
                ),
            )
        }
        b.btnGetYoutube.setOnClickListener {
            showKeyGuide(
                "Ключ YouTube Data API v3",
                "Це безкоштовно: до ~100 пісень на добу.\n\n" +
                    "1. «Увімкнути API»: увійдіть у Google. Якщо сайт попросить вибрати проєкт, створіть новий: " +
                    "«Новий проект» (New Project) → «Створити» (Create). Потім натисніть «Увімкнути» (Enable).\n\n" +
                    "2. «Створити ключ»: «+ Створити облікові дані» (Create credentials) → «Ключ API» (API key) → " +
                    "скопіюйте ключ (AIza…).\n\n" +
                    "3. Поверніться в Джарвіс і натисніть «Вставити».\n\n" +
                    "Якщо це вікно зникло, коли ви поверталися, знову натисніть «Отримати ключ».",
                listOf(
                    "1. Увімкнути API" to ApiKeys.YOUTUBE_ENABLE_URL,
                    "2. Створити ключ" to ApiKeys.YOUTUBE_CREDENTIALS_URL,
                ),
            )
        }
        b.btnPasteClaude.setOnClickListener {
            pasteKey(b.claudeKey, b.claudeResult, ApiKeys::extractClaude, "Claude", "sk-ant-", ::testClaude)
        }
        b.btnPasteYoutube.setOnClickListener {
            pasteKey(b.youtubeKey, b.youtubeResult, ApiKeys::extractYouTube, "YouTube", "AIza", ::testYouTube)
        }
        b.btnPreview.setOnClickListener {
            save()
            speaker?.applySettings()
            speaker?.speak("Добрий день. Я Джарвіс. Усі системи працюють.")
        }
        b.btnTtsSettings.setOnClickListener { SystemSettings.openTtsSettings(this) }
        b.btnBattery.setOnClickListener { SystemSettings.requestIgnoreBattery(this) }
        b.btnAutostart.setOnClickListener {
            AlertDialog.Builder(this)
                .setTitle("Щоб телефон не «вбивав» Джарвіса")
                .setMessage(SystemSettings.vendorInstructions())
                .setPositiveButton("Відкрити налаштування") { _, _ -> SystemSettings.openAutostart(this) }
                .setNegativeButton("Закрити", null)
                .show()
        }
        b.btnDeleteModels.setOnClickListener {
            AlertDialog.Builder(this)
                .setMessage("Видалити завантажені моделі розпізнавання? Їх буде завантажено знову при наступному запуску Джарвіса.")
                .setPositiveButton("Видалити") { _, _ ->
                    JarvisService.stop(this)
                    (VoskModels.main + listOf(VoskModels.EN, VoskModels.RU)).forEach { models.delete(it) }
                    renderModels()
                }
                .setNegativeButton("Скасувати", null)
                .show()
        }
        b.btnSave.setOnClickListener {
            save()
            Toast.makeText(this, "Збережено", Toast.LENGTH_SHORT).show()
            finish()
        }
    }

    private fun testClaude(prefix: String = "") {
        save()
        b.claudeResult.visibility = View.VISIBLE
        b.claudeResult.text = prefix + "Перевіряю…"
        lifecycleScope.launch {
            val agent = ClaudeAgent(prefs)
            b.claudeResult.text = prefix + agent.testKey()
            agent.close()
        }
    }

    private fun testYouTube(prefix: String = "") {
        save()
        b.youtubeResult.visibility = View.VISIBLE
        b.youtubeResult.text = prefix + "Перевіряю…"
        lifecycleScope.launch {
            b.youtubeResult.text = prefix + try {
                val v = YouTubeApi().searchFirst("Щедрик", prefs.youtubeKey)
                "Ключ працює ✓ Знайдено: ${v.title}"
            } catch (e: Exception) {
                e.message ?: "Помилка"
            }
        }
    }

    /**
     * Вставляє ключ із буфера обміну. Шукаємо сам ключ усередині скопійованого тексту,
     * зберігаємо, очищаємо системний буфер обміну й одразу перевіряємо ключ.
     * Історію буфера клавіатури (Gboard тощо) програма очистити не може — про це кажемо користувачу.
     */
    private fun pasteKey(
        field: TextInputEditText,
        result: TextView,
        extract: (CharSequence?) -> String?,
        service: String,
        keyPrefix: String,
        test: (String) -> Unit,
    ) {
        val clipboard = getSystemService(ClipboardManager::class.java)
        val clip = clipboard?.primaryClip
        val text = if (clip != null && clip.itemCount > 0) clip.getItemAt(0).coerceToText(this) else null
        val key = extract(text)
        result.visibility = View.VISIBLE
        if (key == null) {
            result.text = when {
                // Буфер ми самі очистили після минулого вставлення — ключ уже в полі.
                extract(field.text) != null ->
                    "Ключ $service уже вставлено й збережено. Щоб перевірити ще раз, натисніть «Перевірити ключ $service»."
                text.isNullOrBlank() -> "Буфер обміну порожній. Спершу скопіюйте ключ на сайті («Отримати ключ»)."
                else -> "У буфері обміну немає ключа $service: він має починатися з «$keyPrefix». Скопіюйте ключ ще раз."
            }
            return
        }
        field.setText(key)
        runCatching { clipboard?.clearPrimaryClip() }
        test(
            "Ключ вставлено й збережено, буфер обміну очищено. Якщо клавіатура зберігає історію буфера " +
                "(значок буфера в Gboard), видаліть ключ і там.\n\n",
        )
    }

    /** Підказка з кроками й кнопками-посиланнями. Кнопки йдуть строго за кроками й не закривають вікно. */
    private fun showKeyGuide(title: String, steps: String, links: List<Pair<String, String>>) {
        val pad = dp(24)
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, dp(8), pad, 0)
        }
        column.addView(TextView(this).apply {
            text = steps
            setTextColor(ContextCompat.getColor(this@SettingsActivity, R.color.jarvis_text))
            textSize = 15f
            setLineSpacing(0f, 1.15f)
        })
        for ((label, url) in links) {
            column.addView(
                MaterialButton(this, null, com.google.android.material.R.attr.materialButtonOutlinedStyle).apply {
                    text = label
                    setOnClickListener { openUrl(url) }
                },
                LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
                    .apply { topMargin = dp(8) },
            )
        }
        AlertDialog.Builder(this)
            .setTitle(title)
            .setView(ScrollView(this).apply { addView(column) })
            .setNegativeButton("Закрити", null)
            .show()
    }

    private fun openUrl(url: String) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
        } catch (e: ActivityNotFoundException) {
            Toast.makeText(this, "Немає браузера, щоб відкрити $url", Toast.LENGTH_LONG).show()
        }
    }

    private fun fillVoices(sp: Speaker) {
        val voices = sp.ukrainianVoices()
        voiceNames = listOf("") + voices.map { it.name }
        val labels = listOf("За замовчуванням") + voices.map { v ->
            val net = if (v.isNetworkConnectionRequired) " (потрібен інтернет)" else ""
            "${v.name}$net"
        }
        b.ttsVoice.setAdapter(ArrayAdapter(this, android.R.layout.simple_list_item_1, labels))
        val idx = voiceNames.indexOf(prefs.ttsVoice).coerceAtLeast(0)
        b.ttsVoice.setText(labels[idx], false)
        b.ttsWarning.visibility = if (sp.ukrainianMissing || voices.isEmpty()) View.VISIBLE else View.GONE
    }

    private fun renderModels() {
        val lines = (VoskModels.main + listOf(VoskModels.EN, VoskModels.RU)).map { spec ->
            val state = if (models.isInstalled(spec)) "встановлено (${models.installedSizeMb(spec)} МБ)" else "не завантажено"
            "• ${spec.title}: $state"
        }
        b.modelsStatus.text = lines.joinToString("\n")
    }

    private fun save() {
        prefs.wakeWord = b.wakeWord.text.toString().ifBlank { Prefs.DEFAULT_WAKE }
        prefs.wakeVariants = b.wakeVariants.text.toString()
        prefs.execWord = b.execWord.text.toString().ifBlank { Prefs.DEFAULT_EXEC }
        prefs.cancelWord = b.cancelWord.text.toString().ifBlank { Prefs.DEFAULT_CANCEL }
        prefs.timeoutSec = b.timeout.value.toInt()

        prefs.smartMode = b.smartMode.isChecked
        prefs.claudeKey = b.claudeKey.text.toString()
        prefs.claudeModel = b.claudeModel.text.toString().trim().lowercase(Locale.ROOT).ifBlank { Prefs.DEFAULT_MODEL }
        prefs.claudeEffort = effortValues[effortLabels.indexOf(b.claudeEffort.text.toString()).coerceAtLeast(0)]
        prefs.fixSongNames = b.fixSongs.isChecked

        prefs.youtubeKey = b.youtubeKey.text.toString()

        val voiceIdx = (b.ttsVoice.adapter?.let { a -> (0 until a.count).firstOrNull { a.getItem(it) == b.ttsVoice.text.toString() } }) ?: 0
        prefs.ttsVoice = voiceNames.getOrElse(voiceIdx) { "" }
        prefs.ttsRate = b.ttsRate.value
        prefs.ttsPitch = b.ttsPitch.value
        prefs.beep = b.beep.isChecked
        prefs.vibrate = b.vibrate.isChecked
        prefs.sayAck = b.sayAck.isChecked

        prefs.modelId = if (b.modelNano.isChecked) VoskModels.UK_NANO.id else VoskModels.UK_SMALL.id
        prefs.extraLang = extraValues[extraLabels.indexOf(b.extraLang.text.toString()).coerceAtLeast(0)]

        JarvisService.reload(this)
    }

    override fun onPause() {
        save()
        super.onPause()
    }

    override fun onDestroy() {
        speaker?.shutdown()
        super.onDestroy()
    }

    private fun Float.roundTo(step: Float) = (Math.round(this / step) * step)

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
}
