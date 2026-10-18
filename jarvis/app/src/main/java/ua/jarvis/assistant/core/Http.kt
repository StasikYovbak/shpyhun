package ua.jarvis.assistant.core

import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

/** Один HTTP-клієнт на весь застосунок (YouTube API, завантаження моделей). */
object Http {
    val client: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .followRedirects(true)
            .build()
    }
}
