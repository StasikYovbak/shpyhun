package com.stasik.worktime

import android.app.Application

class WorkTimeApp : Application() {

    override fun onCreate() {
        super.onCreate()
        Repo.init(this)
        Notifications.ensureChannel(this)
        ReminderScheduler.rescheduleAll(this)
    }
}
