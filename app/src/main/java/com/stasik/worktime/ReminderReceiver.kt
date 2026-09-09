package com.stasik.worktime

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.LocalDateTime

/**
 * Показує нагадування і одразу планує наступне.
 *
 * Нагадування НЕ показується якщо:
 *  - сьогодні неділя;
 *  - відповідна відмітка (прихід/вихід) за сьогодні вже стоїть;
 *  - день позначено як відпустка / лікарняний / святковий.
 */
class ReminderReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val appContext = context.applicationContext
        Repo.init(appContext)

        val type = intent.getStringExtra(ReminderScheduler.EXTRA_TYPE)
        val today = LocalDate.now()

        if (type != null && shouldNotify(type, today, Repo.day(today))) {
            when (type) {
                ReminderScheduler.TYPE_MORNING -> Notifications.show(
                    appContext,
                    Notifications.MORNING_ID,
                    "Облік годин",
                    "Не забудь відмітити прихід"
                )
                ReminderScheduler.TYPE_EVENING -> Notifications.show(
                    appContext,
                    Notifications.EVENING_ID,
                    "Облік годин",
                    "Не забудь відмітити вихід"
                )
            }
        }

        // Плануємо наступне спрацювання. +1 хвилина, щоб будильник, який спрацював
        // на секунду раніше, не перепланувався на сьогодні ще раз.
        ReminderScheduler.rescheduleAll(appContext, LocalDateTime.now().plusMinutes(1))
    }

    companion object {
        fun shouldNotify(type: String, date: LocalDate, day: WorkDay?): Boolean {
            if (date.dayOfWeek == DayOfWeek.SUNDAY) return false
            if (day != null && day.status != DayStatus.WORK) return false
            return when (type) {
                ReminderScheduler.TYPE_MORNING -> day?.start == null
                ReminderScheduler.TYPE_EVENING -> day?.end == null
                else -> false
            }
        }
    }
}
