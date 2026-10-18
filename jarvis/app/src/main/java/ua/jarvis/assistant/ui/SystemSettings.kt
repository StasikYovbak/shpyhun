package ua.jarvis.assistant.ui

import android.annotation.SuppressLint
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.text.TextUtils
import ua.jarvis.assistant.service.JarvisAccessibilityService

/** Перевірки й відкриття системних налаштувань (батарея, спеціальні можливості, автозапуск). */
object SystemSettings {

    fun isIgnoringBattery(ctx: Context): Boolean =
        ctx.getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(ctx.packageName)

    @SuppressLint("BatteryLife") // для асистента, що слухає постійно, це виправдано
    fun requestIgnoreBattery(ctx: Context) {
        val direct = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${ctx.packageName}"))
        if (!tryStart(ctx, direct)) tryStart(ctx, Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
    }

    fun isAccessibilityEnabled(ctx: Context): Boolean {
        val enabled = Settings.Secure.getString(ctx.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: return false
        val me = ComponentName(ctx, JarvisAccessibilityService::class.java)
        val splitter = TextUtils.SimpleStringSplitter(':').apply { setString(enabled) }
        return splitter.any { ComponentName.unflattenFromString(it) == me }
    }

    fun openAccessibility(ctx: Context) = tryStart(ctx, Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))

    fun canDrawOverlays(ctx: Context) = Settings.canDrawOverlays(ctx)

    fun openOverlay(ctx: Context) = tryStart(
        ctx, Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${ctx.packageName}")),
    )

    fun openAppDetails(ctx: Context) = tryStart(
        ctx, Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${ctx.packageName}")),
    )

    fun openTtsSettings(ctx: Context) {
        if (!tryStart(ctx, Intent("com.android.settings.TTS_SETTINGS"))) tryStart(ctx, Intent(Settings.ACTION_SETTINGS))
    }

    /** Сторінки «Автозапуск» / «Фонова активність» різних виробників (перша, що відкриється). */
    fun openAutostart(ctx: Context) {
        val candidates = listOf(
            // Xiaomi / Redmi / POCO (MIUI, HyperOS)
            ComponentName("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"),
            ComponentName("com.miui.powerkeeper", "com.miui.powerkeeper.ui.HiddenAppsConfigActivity"),
            // Samsung (One UI) — «Обмеження фонового використання»
            ComponentName("com.samsung.android.lool", "com.samsung.android.sm.battery.ui.BatteryActivity"),
            ComponentName("com.samsung.android.sm_cn", "com.samsung.android.sm.ui.battery.BatteryActivity"),
            // Huawei / Honor
            ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"),
            ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.optimize.process.ProtectActivity"),
            // OPPO / Realme / OnePlus (ColorOS)
            ComponentName("com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity"),
            ComponentName("com.coloros.safecenter", "com.coloros.safecenter.startupapp.StartupAppListActivity"),
            ComponentName("com.oplus.safecenter", "com.oplus.safecenter.permission.startup.StartupAppListActivity"),
            ComponentName("com.oneplus.security", "com.oneplus.security.chainlaunch.view.ChainLaunchAppListActivity"),
            // Vivo / iQOO
            ComponentName("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"),
            ComponentName("com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.BgStartUpManager"),
            // ASUS
            ComponentName("com.asus.mobilemanager", "com.asus.mobilemanager.powersaver.PowerSaverSettings"),
        )
        for (c in candidates) if (tryStart(ctx, Intent().setComponent(c))) return
        openAppDetails(ctx)
    }

    /** Покрокова інструкція саме для цього телефона. */
    fun vendorInstructions(): String {
        val m = Build.MANUFACTURER.lowercase()
        return when {
            m.contains("xiaomi") || m.contains("redmi") || m.contains("poco") -> """
                Xiaomi / Redmi / POCO (MIUI, HyperOS):
                1. Налаштування → Програми → Керування програмами → Джарвіс.
                2. «Автозапуск» — увімкнути.
                3. «Економія заряду» (Battery saver) → «Без обмежень» (No restrictions).
                4. «Інші дозволи» → дозволити «Відображати спливні вікна, коли працює у фоні» та «Показувати на заблокованому екрані».
                5. Відкрийте список нещодавніх програм, потягніть картку Джарвіса вниз і натисніть замок 🔒 — тоді MIUI не закриватиме його.
            """.trimIndent()
            m.contains("samsung") -> """
                Samsung (One UI):
                1. Налаштування → Програми → Джарвіс → Акумулятор → «Без обмежень».
                2. Налаштування → Обслуговування пристрою (Догляд за батареєю) → Акумулятор → Обмеження фонового використання:
                   вимкніть «Переводити невикористовувані програми в режим сну» або додайте Джарвіса в «Програми, які ніколи не переходять у режим сну».
                3. Вимкніть «Адаптивне енергоспоживання», якщо Джарвіс засинає.
            """.trimIndent()
            m.contains("huawei") || m.contains("honor") -> """
                Huawei / Honor:
                1. Налаштування → Акумулятор → Запуск програм → Джарвіс → вимкніть «Керувати автоматично».
                2. Увімкніть «Автозапуск», «Вторинний запуск» і «Робота у фоновому режимі».
            """.trimIndent()
            m.contains("oppo") || m.contains("realme") || m.contains("oneplus") -> """
                OPPO / Realme / OnePlus:
                1. Налаштування → Програми → Джарвіс → Використання акумулятора → дозволити фонову активність і автозапуск.
                2. Налаштування → Акумулятор → вимкніть оптимізацію для Джарвіса.
                3. Закріпіть Джарвіса в списку нещодавніх програм (замок).
            """.trimIndent()
            m.contains("vivo") -> """
                Vivo / iQOO:
                1. i Manager → Диспетчер програм → Автозапуск → увімкнути Джарвіса.
                2. Налаштування → Акумулятор → Високе енергоспоживання у фоні → дозволити Джарвісу.
            """.trimIndent()
            else -> """
                Загальні кроки:
                1. Налаштування → Програми → Джарвіс → Акумулятор → «Без обмежень».
                2. Якщо є пункт «Автозапуск» — увімкніть його.
                3. Закріпіть Джарвіса в списку нещодавніх програм, якщо оболонка це вміє.
                Більше порад для вашої моделі: dontkillmyapp.com
            """.trimIndent()
        }
    }

    private fun tryStart(ctx: Context, intent: Intent): Boolean = try {
        if (ctx !is android.app.Activity) intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        ctx.startActivity(intent)
        true
    } catch (e: Exception) {
        false
    }
}
