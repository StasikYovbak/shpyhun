package ua.jarvis.assistant.ui

import android.os.Bundle
import android.view.View
import android.widget.ArrayAdapter
import android.widget.Toast
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updatePadding
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import ua.jarvis.assistant.actions.YouTubeApi
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

        b.btnTestClaude.setOnClickListener {
            save()
            b.claudeResult.visibility = View.VISIBLE
            b.claudeResult.text = "Перевіряю…"
            lifecycleScope.launch {
                val agent = ClaudeAgent(prefs)
                b.claudeResult.text = agent.testKey()
                agent.close()
            }
        }
        b.btnTestYoutube.setOnClickListener {
            save()
            b.youtubeResult.visibility = View.VISIBLE
            b.youtubeResult.text = "Перевіряю…"
            lifecycleScope.launch {
                b.youtubeResult.text = try {
                    val v = YouTubeApi().searchFirst("Щедрик", prefs.youtubeKey)
                    "Ключ працює ✓ Знайдено: ${v.title}"
                } catch (e: Exception) {
                    e.message ?: "Помилка"
                }
            }
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
