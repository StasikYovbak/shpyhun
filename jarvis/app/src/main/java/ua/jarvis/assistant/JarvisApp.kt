package ua.jarvis.assistant

import android.app.Application
import ua.jarvis.assistant.core.CommandLog
import ua.jarvis.assistant.core.Notifications

class JarvisApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Notifications.createChannels(this)
        CommandLog.load(this)
    }
}
