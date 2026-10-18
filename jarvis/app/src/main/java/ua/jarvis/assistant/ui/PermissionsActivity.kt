package ua.jarvis.assistant.ui

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.View
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updatePadding
import ua.jarvis.assistant.R
import ua.jarvis.assistant.core.Prefs
import ua.jarvis.assistant.databinding.ActivityPermissionsBinding
import ua.jarvis.assistant.databinding.ItemPermissionBinding

/**
 * Перший запуск: пояснюємо, навіщо кожен дозвіл, і даємо його надати одним дотиком.
 * Сюди ж можна повернутися з головного екрана (іконка щита).
 */
class PermissionsActivity : AppCompatActivity() {

    private lateinit var b: ActivityPermissionsBinding
    private lateinit var prefs: Prefs

    private class Item(
        val title: String,
        val why: String,
        val required: Boolean,
        val isGranted: () -> Boolean,
        val grant: () -> Unit,
    )

    private val askRuntime = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { res ->
        // Якщо користувач двічі відмовив, Android більше не показує діалог — ведемо в налаштування програми.
        val permanentlyDenied = res.filterValues { !it }.keys.any { !ActivityCompat.shouldShowRequestPermissionRationale(this, it) }
        if (permanentlyDenied) {
            AlertDialog.Builder(this)
                .setTitle("Дозвіл заблоковано")
                .setMessage("Android більше не показує запит. Відкрийте «Дозволи» в налаштуваннях програми й увімкніть його вручну.")
                .setPositiveButton("Відкрити") { _, _ -> SystemSettings.openAppDetails(this) }
                .setNegativeButton("Пізніше", null)
                .show()
        }
        render()
    }

    private fun granted(p: String) = ContextCompat.checkSelfPermission(this, p) == PackageManager.PERMISSION_GRANTED

    private val items: List<Item> by lazy {
        buildList {
            add(Item(
                "🎙 Мікрофон", "Головне: Джарвіс постійно слухає, чи не прозвучало слово активації. " +
                    "Звук розпізнається прямо на телефоні (Vosk) і нікуди не надсилається.", true,
                { granted(Manifest.permission.RECORD_AUDIO) }, { askRuntime.launch(arrayOf(Manifest.permission.RECORD_AUDIO)) },
            ))
            if (Build.VERSION.SDK_INT >= 33) add(Item(
                "🔔 Сповіщення", "Android вимагає постійне сповіщення, поки програма слухає мікрофон у фоні. " +
                    "Без дозволу воно буде невидимим, а підказки після перезавантаження не з'являться.", true,
                { granted(Manifest.permission.POST_NOTIFICATIONS) }, { askRuntime.launch(arrayOf(Manifest.permission.POST_NOTIFICATIONS)) },
            ))
            add(Item(
                "👥 Контакти", "Щоб за командою «подзвони мамі» знайти потрібний номер. Контакти не покидають телефон.", false,
                { granted(Manifest.permission.READ_CONTACTS) }, { askRuntime.launch(arrayOf(Manifest.permission.READ_CONTACTS)) },
            ))
            add(Item(
                "📞 Дзвінки", "Щоб дзвонити одразу, без натискання зеленої кнопки. Перед кожним дзвінком Джарвіс перепитає «так чи ні».", false,
                { granted(Manifest.permission.CALL_PHONE) }, { askRuntime.launch(arrayOf(Manifest.permission.CALL_PHONE)) },
            ))
            add(Item(
                "✉️ SMS", "Щоб надсилати повідомлення голосом. Перед надсиланням Джарвіс зачитає текст і попросить підтвердження.", false,
                { granted(Manifest.permission.SEND_SMS) }, { askRuntime.launch(arrayOf(Manifest.permission.SEND_SMS)) },
            ))
            add(Item(
                "♿ Спеціальні можливості", "Дозволяє Джарвісу відкривати програми, поки екран вимкнений чи відкрита інша програма, " +
                    "а в розумному режимі — натискати кнопки й вводити текст в інших програмах. " +
                    "Знайдіть у списку «Джарвіс» і увімкніть.\n\nЯкщо перемикач сірий (Android 13+): Налаштування → Програми → Джарвіс → " +
                    "⋮ (угорі праворуч) → «Дозволити обмежені налаштування», потім спробуйте знову.", false,
                { SystemSettings.isAccessibilityEnabled(this@PermissionsActivity) }, { SystemSettings.openAccessibility(this@PermissionsActivity) },
            ))
            add(Item(
                "🔋 Робота без обмежень батареї", "Інакше Android приспить Джарвіса за кілька хвилин після вимкнення екрана.", true,
                { SystemSettings.isIgnoringBattery(this@PermissionsActivity) }, { SystemSettings.requestIgnoreBattery(this@PermissionsActivity) },
            ))
            add(Item(
                "🪟 Поверх інших вікон (необов'язково)", "Запасний спосіб відкривати програми з фону, якщо спеціальні можливості вимкнені.", false,
                { SystemSettings.canDrawOverlays(this@PermissionsActivity) }, { SystemSettings.openOverlay(this@PermissionsActivity) },
            ))
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        b = ActivityPermissionsBinding.inflate(layoutInflater)
        setContentView(b.root)
        prefs = Prefs(this)
        ViewCompat.setOnApplyWindowInsetsListener(b.content) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            v.updatePadding(top = bars.top + dp(12), bottom = bars.bottom + dp(16))
            insets
        }
        b.btnVendor.setOnClickListener {
            AlertDialog.Builder(this)
                .setTitle("Щоб телефон не «вбивав» Джарвіса")
                .setMessage(SystemSettings.vendorInstructions())
                .setPositiveButton("Відкрити налаштування") { _, _ -> SystemSettings.openAutostart(this) }
                .setNegativeButton("Закрити", null)
                .show()
        }
        b.btnDone.setOnClickListener {
            prefs.onboardingDone = true
            finish()
        }
        b.torchNote.text = "💡 Ліхтарик: окремий дозвіл камери НЕ потрібен — Android вмикає спалах без нього."
    }

    override fun onResume() {
        super.onResume()
        render()
    }

    private fun render() {
        b.list.removeAllViews()
        for (item in items) {
            val row = ItemPermissionBinding.inflate(layoutInflater, b.list, false)
            row.permTitle.text = item.title
            row.permWhy.text = item.why
            val ok = item.isGranted()
            row.permStatus.text = if (ok) "✓ Надано" else if (item.required) "Потрібно" else "Бажано"
            row.permStatus.setTextColor(
                ContextCompat.getColor(this, if (ok) R.color.jarvis_green else if (item.required) R.color.jarvis_amber else R.color.jarvis_text_dim)
            )
            row.permButton.visibility = if (ok) View.GONE else View.VISIBLE
            row.permButton.setOnClickListener { item.grant() }
            b.list.addView(row.root)
        }
        val allRequired = items.filter { it.required }.all { it.isGranted() }
        b.btnDone.text = if (allRequired) "Готово" else "Продовжити (налаштую пізніше)"
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
}
