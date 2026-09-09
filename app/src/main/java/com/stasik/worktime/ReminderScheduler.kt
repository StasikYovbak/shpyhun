package com.stasik.worktime

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId

/**
 * Планування щоденних нагадувань через AlarmManager.setExactAndAllowWhileIdle.
 * Будильник одноразовий, тому ReminderReceiver після кожного спрацювання
 * планує наступне.
 */
object ReminderScheduler {

    const val EXTRA_TYPE = "type"
    const val TYPE_MORNING = "morning"
    const val TYPE_EVENING = "evening"

    private const val REQUEST_MORNING = 2001
    private const val REQUEST_EVENING = 2002

    const val ACTION_REMINDER = "com.stasik.worktime.action.REMINDER"

    fun rescheduleAll(context: Context, now: LocalDateTime = LocalDateTime.now()) {
        Repo.init(context)
        val settings = Repo.settings
        schedule(context, TYPE_MORNING, settings.morningEnabled, settings.morningLocalTime, now)
        schedule(context, TYPE_EVENING, settings.eveningEnabled, settings.eveningLocalTime, now)
    }

    fun schedule(
        context: Context,
        type: String,
        enabled: Boolean,
        time: LocalTime,
        now: LocalDateTime = LocalDateTime.now()
    ) {
        val manager = context.getSystemService(AlarmManager::class.java) ?: return
        val pendingIntent = pendingIntent(context, type)

        manager.cancel(pendingIntent)
        if (!enabled) return

        val next = WorkCalc.nextReminder(now, time)
        val triggerAt = next.atZone(ZoneId.systemDefault()).toInstant().toEpochMilli()

        try {
            if (canScheduleExact(context)) {
                manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pendingIntent)
            } else {
                // Точні будильники заборонені користувачем — м'який запасний варіант.
                manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pendingIntent)
            }
        } catch (e: SecurityException) {
            manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pendingIntent)
        }
    }

    fun canScheduleExact(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
        val manager = context.getSystemService(AlarmManager::class.java) ?: return false
        return manager.canScheduleExactAlarms()
    }

    private fun pendingIntent(context: Context, type: String): PendingIntent {
        val intent = Intent(context, ReminderReceiver::class.java).apply {
            action = ACTION_REMINDER
            putExtra(EXTRA_TYPE, type)
        }
        val requestCode = if (type == TYPE_MORNING) REQUEST_MORNING else REQUEST_EVENING
        return PendingIntent.getBroadcast(
            context,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }
}
