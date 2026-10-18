package ua.jarvis.assistant.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.View
import android.widget.CompoundButton
import android.widget.Toast
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updatePadding
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.recyclerview.widget.LinearLayoutManager
import kotlinx.coroutines.launch
import ua.jarvis.assistant.R
import ua.jarvis.assistant.core.CommandLog
import ua.jarvis.assistant.core.JarvisState
import ua.jarvis.assistant.core.Prefs
import ua.jarvis.assistant.core.Status
import ua.jarvis.assistant.databinding.ActivityMainBinding
import ua.jarvis.assistant.service.JarvisService

class MainActivity : AppCompatActivity() {

    private lateinit var b: ActivityMainBinding
    private lateinit var prefs: Prefs
    private val log = LogAdapter()

    private val micPermission = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { res ->
        if (res[Manifest.permission.RECORD_AUDIO] == true) {
            startJarvis()
        } else {
            setSwitch(false)
            Toast.makeText(this, "Без мікрофона Джарвіс не почує вас", Toast.LENGTH_LONG).show()
        }
    }

    private val switchListener = CompoundButton.OnCheckedChangeListener { _, checked ->
        if (checked) requestMicAndStart() else stopJarvis()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        b = ActivityMainBinding.inflate(layoutInflater)
        setContentView(b.root)
        prefs = Prefs(this)

        ViewCompat.setOnApplyWindowInsetsListener(b.content) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            v.updatePadding(top = bars.top + dp(12), bottom = bars.bottom + dp(16))
            insets
        }

        b.logList.layoutManager = LinearLayoutManager(this)
        b.logList.adapter = log
        b.btnSettings.setOnClickListener { startActivity(Intent(this, SettingsActivity::class.java)) }
        b.btnPermissions.setOnClickListener { startActivity(Intent(this, PermissionsActivity::class.java)) }
        b.btnClearLog.setOnClickListener { CommandLog.clear(this) }
        b.mainSwitch.setOnCheckedChangeListener(switchListener)

        if (!prefs.onboardingDone) startActivity(Intent(this, PermissionsActivity::class.java))

        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                launch { JarvisState.status.collect(::renderStatus) }
                launch { JarvisState.detail.collect { b.statusDetail.text = it; b.statusDetail.visibility = if (it.isBlank()) View.GONE else View.VISIBLE } }
                launch { JarvisState.heard.collect { b.heardText.text = it.ifBlank { "…" } } }
                launch {
                    JarvisState.command.collect {
                        b.commandText.text = it.ifBlank { JarvisState.lastCommand.value.ifBlank { "Скажіть «${prefs.wakeWord}», потім команду і «${prefs.execWord}»" } }
                    }
                }
                launch { JarvisState.lastCommand.collect { if (JarvisState.command.value.isBlank() && it.isNotBlank()) b.commandText.text = it } }
                launch {
                    JarvisState.warning.collect {
                        b.warningText.text = it
                        b.warningText.visibility = if (it.isBlank()) View.GONE else View.VISIBLE
                    }
                }
                launch {
                    CommandLog.entries.collect {
                        log.submit(it)
                        b.emptyLog.visibility = if (it.isEmpty()) View.VISIBLE else View.GONE
                    }
                }
            }
        }
    }

    override fun onStart() {
        super.onStart()
        isVisible = true
    }

    override fun onStop() {
        isVisible = false
        super.onStop()
    }

    override fun onResume() {
        super.onResume()
        setSwitch(prefs.enabled && JarvisService.running)
        renderSetupBanner()
    }

    private fun renderStatus(s: Status) {
        b.reactor.state = s
        b.statusText.text = s.title.uppercase()
        val color = when (s) {
            Status.ERROR -> R.color.jarvis_red
            Status.CONFIRMING -> R.color.jarvis_amber
            Status.OFF -> R.color.jarvis_text_dim
            else -> R.color.jarvis_cyan
        }
        b.statusText.setTextColor(ContextCompat.getColor(this, color))
        val on = prefs.enabled && JarvisService.running
        if (on != b.mainSwitch.isChecked) setSwitch(on)
    }

    private fun renderSetupBanner() {
        val system = mutableListOf<String>()
        if (!granted(Manifest.permission.RECORD_AUDIO)) system += "мікрофон"
        if (!SystemSettings.isAccessibilityEnabled(this)) system += "спеціальні можливості"
        if (!SystemSettings.isIgnoringBattery(this)) system += "робота у фоні"
        val keys = mutableListOf<String>()
        if (!prefs.hasClaude) keys += "ключ Claude"
        if (!prefs.hasYouTube) keys += "ключ YouTube"
        val missing = system + keys
        b.setupBanner.visibility = if (missing.isEmpty()) View.GONE else View.VISIBLE
        b.setupBanner.text = "Не налаштовано: ${missing.joinToString(", ")}. Торкніться, щоб виправити"
        // Дозволи — на екрані дозволів, а ключі вводяться в налаштуваннях.
        val target = if (system.isNotEmpty()) PermissionsActivity::class.java else SettingsActivity::class.java
        b.setupBanner.setOnClickListener { startActivity(Intent(this, target)) }
    }

    private fun setSwitch(on: Boolean) {
        b.mainSwitch.setOnCheckedChangeListener(null)
        b.mainSwitch.isChecked = on
        b.mainSwitch.text = if (on) "Джарвіс увімкнено" else "Джарвіс вимкнено"
        b.mainSwitch.setOnCheckedChangeListener(switchListener)
    }

    private fun requestMicAndStart() {
        val need = mutableListOf<String>()
        if (!granted(Manifest.permission.RECORD_AUDIO)) need += Manifest.permission.RECORD_AUDIO
        if (Build.VERSION.SDK_INT >= 33 && !granted(Manifest.permission.POST_NOTIFICATIONS)) need += Manifest.permission.POST_NOTIFICATIONS
        if (need.isEmpty()) startJarvis() else micPermission.launch(need.toTypedArray())
    }

    private fun startJarvis() {
        prefs.enabled = true
        JarvisService.start(this)
        setSwitch(true)
    }

    private fun stopJarvis() {
        JarvisService.stop(this)
        setSwitch(false)
    }

    private fun granted(p: String) = ContextCompat.checkSelfPermission(this, p) == PackageManager.PERMISSION_GRANTED

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    companion object {
        /** Чи видно зараз наш екран (тоді Android дозволяє відкривати інші програми). */
        @Volatile var isVisible = false
            private set
    }
}
