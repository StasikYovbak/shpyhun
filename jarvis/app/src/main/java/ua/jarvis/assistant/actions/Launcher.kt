package ua.jarvis.assistant.actions

import android.annotation.SuppressLint
import android.app.KeyguardManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.graphics.PixelFormat
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import android.view.View
import android.view.WindowManager
import ua.jarvis.assistant.core.Notifications
import ua.jarvis.assistant.service.JarvisAccessibilityService
import ua.jarvis.assistant.ui.MainActivity

/**
 * Відкриває інші програми з фонового сервісу.
 *
 * З Android 10 фонова програма не може просто так відкрити екран іншої програми.
 * Дозволено, якщо:
 *  1) увімкнена служба спеціальних можливостей Джарвіса (найнадійніше);
 *  2) або є дозвіл «Поверх інших вікон» (тоді на мить показуємо невидиме вікно);
 *  3) або відкритий наш власний екран.
 * Інакше показуємо сповіщення «Торкніться, щоб відкрити».
 * Якщо телефон заблоковано — чекаємо розблокування (до 90 с) і тоді відкриваємо.
 */
class Launcher(context: Context) {

    enum class Outcome { STARTED, WAITING_UNLOCK, NEEDS_TAP, NOT_FOUND }

    private val ctx = context.applicationContext
    private val main = Handler(Looper.getMainLooper())
    private var pending: Triple<Intent, String, Long>? = null

    fun start(intent: Intent, title: String): Outcome {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (intent.resolveActivity(ctx.packageManager) == null) return Outcome.NOT_FOUND
        val km = ctx.getSystemService(KeyguardManager::class.java)
        if (km.isKeyguardLocked) {
            pending = Triple(intent, title, System.currentTimeMillis())
            wakeScreen()
            return Outcome.WAITING_UNLOCK
        }
        return launchNow(intent, title)
    }

    private fun launchNow(intent: Intent, title: String): Outcome = try {
        val acc = JarvisAccessibilityService.instance
        when {
            acc != null -> { acc.startActivity(intent); Outcome.STARTED }
            Settings.canDrawOverlays(ctx) -> { flashOverlay(); ctx.startActivity(intent); Outcome.STARTED }
            MainActivity.isVisible -> { ctx.startActivity(intent); Outcome.STARTED }
            else -> { Notifications.showTapToOpen(ctx, title, intent); Outcome.NEEDS_TAP }
        }
    } catch (e: ActivityNotFoundException) {
        Outcome.NOT_FOUND
    } catch (e: SecurityException) {
        Log.w(TAG, "start failed", e)
        Notifications.showTapToOpen(ctx, title, intent)
        Outcome.NEEDS_TAP
    }

    /** Викликає сервіс, коли користувач розблокував телефон. */
    fun onUserPresent() {
        val p = pending ?: return
        pending = null
        if (System.currentTimeMillis() - p.third < 90_000) launchNow(p.first, p.second)
    }

    fun hasPending() = pending != null

    @Suppress("DEPRECATION")
    @SuppressLint("WakelockTimeout")
    private fun wakeScreen() {
        runCatching {
            val pm = ctx.getSystemService(PowerManager::class.java)
            if (!pm.isInteractive) {
                pm.newWakeLock(
                    PowerManager.SCREEN_BRIGHT_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP,
                    "jarvis:wake",
                ).acquire(5_000)
            }
        }
    }

    /** Невидиме вікно 1×1 на 2 секунди: новіші версії Android дозволяють запуск із фону лише програмі з видимим вікном. */
    private fun flashOverlay() {
        runCatching {
            val wm = ctx.getSystemService(WindowManager::class.java)
            val v = View(ctx)
            val lp = WindowManager.LayoutParams(
                1, 1,
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE,
                PixelFormat.TRANSLUCENT,
            )
            wm.addView(v, lp)
            main.postDelayed({ runCatching { wm.removeView(v) } }, 2000)
        }
    }

    companion object {
        private const val TAG = "Launcher"

        fun describe(outcome: Outcome, what: String): String? = when (outcome) {
            Outcome.STARTED -> null
            Outcome.WAITING_UNLOCK -> "Розблокуйте телефон, і я $what"
            Outcome.NEEDS_TAP -> "Торкніться сповіщення, щоб відкрити. Щоб я відкривав сам, увімкніть Джарвіса в спеціальних можливостях"
            Outcome.NOT_FOUND -> "Не знайшов програму, яка це вміє"
        }
    }
}
