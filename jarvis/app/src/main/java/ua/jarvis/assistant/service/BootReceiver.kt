package ua.jarvis.assistant.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import ua.jarvis.assistant.core.Notifications
import ua.jarvis.assistant.core.Prefs

/**
 * Автозапуск після перезавантаження телефона (і після оновлення застосунку).
 *
 * Чесно про обмеження Android:
 *  - Android 10: сервіс стартує сам і одразу слухає.
 *  - Android 11+: система не дає фоновій програмі вмикати мікрофон після перезавантаження
 *    (на Android 14+ запуск такого сервісу з BOOT_COMPLETED просто заборонено).
 *    Тому показуємо сповіщення «Торкніться, щоб Джарвіс почав слухати» — один дотик, і все працює.
 */
class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        if (action !in ACTIONS) return
        val prefs = Prefs(context)
        if (!prefs.enabled) return

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            runCatching { JarvisService.start(context) }
                .onFailure { Log.w("BootReceiver", "direct start failed", it); tapToStart(context) }
        } else {
            tapToStart(context)
        }
    }

    private fun tapToStart(context: Context) {
        Notifications.showTapToStart(
            context,
            "Телефон перезавантажився. Android дозволяє вмикати мікрофон лише після вашого дотику.",
        )
    }

    companion object {
        private val ACTIONS = setOf(
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_MY_PACKAGE_REPLACED,
            "android.intent.action.QUICKBOOT_POWERON", // деякі Xiaomi/HTC
            "com.htc.intent.action.QUICKBOOT_POWERON",
        )
    }
}
