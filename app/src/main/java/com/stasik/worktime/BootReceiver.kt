package com.stasik.worktime

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Після перезавантаження телефона (чи оновлення додатка) будильники треба поставити наново. */
class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_MY_PACKAGE_REPLACED,
            Intent.ACTION_TIME_CHANGED,
            Intent.ACTION_TIMEZONE_CHANGED -> {
                val appContext = context.applicationContext
                Repo.init(appContext)
                Notifications.ensureChannel(appContext)
                ReminderScheduler.rescheduleAll(appContext)
            }
        }
    }
}
