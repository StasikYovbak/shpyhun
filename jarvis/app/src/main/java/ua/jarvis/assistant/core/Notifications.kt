package ua.jarvis.assistant.core

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import ua.jarvis.assistant.R
import ua.jarvis.assistant.service.JarvisService
import ua.jarvis.assistant.ui.MainActivity

object Notifications {
    const val CHANNEL_LISTEN = "jarvis_listen"
    const val CHANNEL_ALERTS = "jarvis_alerts"
    const val ID_SERVICE = 1
    const val ID_TAP_TO_START = 2
    const val ID_TAP_TO_OPEN = 3

    fun createChannels(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_LISTEN, "Постійне прослуховування", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Обов'язкове сповіщення, поки Джарвіс слухає мікрофон"
                setShowBadge(false)
            }
        )
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_ALERTS, "Дії Джарвіса", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Запуск після перезавантаження, відкриття програм із заблокованого екрана"
            }
        )
    }

    private fun mainIntent(ctx: Context): PendingIntent =
        PendingIntent.getActivity(
            ctx, 0, Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

    fun service(ctx: Context, status: String, detail: String): Notification {
        val stop = PendingIntent.getService(
            ctx, 1, Intent(ctx, JarvisService::class.java).setAction(JarvisService.ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        return NotificationCompat.Builder(ctx, CHANNEL_LISTEN)
            .setSmallIcon(R.drawable.ic_stat_jarvis)
            .setContentTitle("Джарвіс: $status")
            .setContentText(detail.ifBlank { "Скажіть «${Prefs(ctx).wakeWord}», щоб дати команду" })
            .setContentIntent(mainIntent(ctx))
            .addAction(0, "Вимкнути", stop)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()
    }

    /**
     * Android 11+ не дає фоновим програмам вмикати мікрофон після перезавантаження.
     * Тому показуємо сповіщення: один дотик — і Джарвіс слухає.
     */
    @SuppressLint("MissingPermission")
    fun showTapToStart(ctx: Context, reason: String) {
        val start = PendingIntent.getForegroundService(
            ctx, 2, Intent(ctx, JarvisService::class.java).setAction(JarvisService.ACTION_START),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val n = NotificationCompat.Builder(ctx, CHANNEL_ALERTS)
            .setSmallIcon(R.drawable.ic_stat_jarvis)
            .setContentTitle("Торкніться, щоб Джарвіс почав слухати")
            .setContentText(reason)
            .setStyle(NotificationCompat.BigTextStyle().bigText(reason))
            .setContentIntent(start)
            .addAction(0, "Увімкнути", start)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build()
        if (NotificationManagerCompat.from(ctx).areNotificationsEnabled()) {
            NotificationManagerCompat.from(ctx).notify(ID_TAP_TO_START, n)
        }
    }

    /** Запасний шлях, коли Android не дозволяє відкрити програму з фону. */
    @SuppressLint("MissingPermission")
    fun showTapToOpen(ctx: Context, title: String, intent: Intent) {
        val pi = PendingIntent.getActivity(
            ctx, 3, intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val n = NotificationCompat.Builder(ctx, CHANNEL_ALERTS)
            .setSmallIcon(R.drawable.ic_stat_jarvis)
            .setContentTitle(title)
            .setContentText("Торкніться, щоб відкрити")
            .setContentIntent(pi)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setTimeoutAfter(60_000)
            .build()
        if (NotificationManagerCompat.from(ctx).areNotificationsEnabled()) {
            NotificationManagerCompat.from(ctx).notify(ID_TAP_TO_OPEN, n)
        }
    }

    fun cancel(ctx: Context, id: Int) = NotificationManagerCompat.from(ctx).cancel(id)
}
