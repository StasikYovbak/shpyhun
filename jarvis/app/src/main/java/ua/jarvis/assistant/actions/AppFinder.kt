package ua.jarvis.assistant.actions

import android.content.Context
import android.content.Intent
import ua.jarvis.assistant.text.NameMatch
import ua.jarvis.assistant.text.TextNorm

data class InstalledApp(val label: String, val pkg: String)

/** Пошук встановленої програми за сказаною назвою («ютуб», «телеграм», «калькулятор»). */
class AppFinder(context: Context) {

    private val ctx = context.applicationContext
    private var cache: List<InstalledApp> = emptyList()
    private var cacheTime = 0L

    /** Усі програми з іконкою в меню (кеш на хвилину). */
    @Synchronized
    fun list(): List<InstalledApp> {
        if (System.currentTimeMillis() - cacheTime < 60_000 && cache.isNotEmpty()) return cache
        val pm = ctx.packageManager
        val main = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        cache = pm.queryIntentActivities(main, 0)
            .map { InstalledApp(it.loadLabel(pm).toString(), it.activityInfo.packageName) }
            .filter { it.pkg != ctx.packageName }
            .distinctBy { it.pkg }
            .sortedBy { it.label.lowercase() }
        cacheTime = System.currentTimeMillis()
        return cache
    }

    fun find(spoken: String): Pair<InstalledApp, Double>? {
        val s = TextNorm.normalize(spoken)
        if (s.isBlank()) return null
        val apps = list()

        // 1) Відомі назви, які люди кажуть інакше, ніж пишуть.
        for ((keys, targets) in ALIASES) {
            if (keys.any { k -> TextNorm.similarity(s.replace(" ", ""), k.replace(" ", "")) >= 0.85 }) {
                apps.firstOrNull { a -> targets.any { t -> a.pkg == t || a.pkg.startsWith("$t.") } }?.let { return it to 1.0 }
                apps.firstOrNull { a -> targets.any { t -> !t.contains('.') && a.label.lowercase().contains(t) } }?.let { return it to 0.95 }
            }
        }
        // 2) Нечіткий збіг з назвою програми (з транслітерацією).
        return apps.map { it to NameMatch.score(s, it.label) }
            .maxByOrNull { it.second }
            ?.takeIf { it.second >= 0.72 }
    }

    companion object {
        /** Сказане → пакет або англійське слово в назві. */
        private val ALIASES: List<Pair<List<String>, List<String>>> = listOf(
            listOf("ютуб", "ютюб", "ютубчик") to listOf("com.google.android.youtube"),
            listOf("ютуб музика", "ютуб мюзік") to listOf("com.google.android.apps.youtube.music"),
            listOf("телеграм", "телеграмм", "телега") to listOf("org.telegram.messenger", "org.telegram", "telegram"),
            listOf("вайбер") to listOf("com.viber.voip"),
            listOf("вотсап", "ватсап", "вацап", "вотсапп") to listOf("com.whatsapp"),
            listOf("інстаграм", "інста", "інстаграмм") to listOf("com.instagram.android"),
            listOf("фейсбук") to listOf("com.facebook.katana"),
            listOf("месенджер") to listOf("com.facebook.orca"),
            listOf("тікток", "тік ток") to listOf("com.zhiliaoapp.musically", "com.ss.android.ugc.trill"),
            listOf("хром", "гугл хром", "браузер") to listOf("com.android.chrome", "browser"),
            listOf("карти", "гугл карти", "мапи", "гугл мапи") to listOf("com.google.android.apps.maps"),
            listOf("гугл", "гугл пошук") to listOf("com.google.android.googlequicksearchbox"),
            listOf("пошта", "гмейл", "джимейл") to listOf("com.google.android.gm"),
            listOf("плей маркет", "плеймаркет", "гугл плей", "маркет") to listOf("com.android.vending"),
            listOf("спотіфай", "спотифай") to listOf("com.spotify.music"),
            listOf("нетфлікс") to listOf("com.netflix.mediaclient"),
            listOf("монобанк", "моно") to listOf("com.ftband.mono"),
            listOf("приват", "приватбанк", "приват24", "приват двадцять чотири") to listOf("ua.privatbank.ap24"),
            listOf("дія") to listOf("ua.gov.diia.app"),
            listOf("укрзалізниця") to listOf("ua.gov.uz.app", "укрзалізниця"),
            listOf("нова пошта") to listOf("com.novaposhta.app", "ua.novaposhtaa"),
            listOf("сигнал") to listOf("org.thoughtcrime.securesms"),
            listOf("дискорд") to listOf("com.discord"),
            listOf("налаштування") to listOf("com.android.settings", "settings"),
            listOf("калькулятор") to listOf("calculator"),
            listOf("годинник") to listOf("com.google.android.deskclock", "com.sec.android.app.clockpackage", "clock"),
            listOf("календар") to listOf("calendar"),
            listOf("камера") to listOf("camera"),
            listOf("галерея", "фото", "фотографії") to listOf("com.google.android.apps.photos", "gallery", "photos"),
            listOf("контакти") to listOf("contacts"),
            listOf("телефон", "дзвінки") to listOf("com.google.android.dialer", "com.samsung.android.dialer", "phone"),
            listOf("повідомлення", "смс") to listOf("com.google.android.apps.messaging", "messages"),
            listOf("нотатки") to listOf("com.google.android.keep", "notes", "keep"),
            listOf("файли", "провідник") to listOf("files"),
            listOf("погода") to listOf("weather"),
            listOf("музика") to listOf("music"),
            listOf("диктофон") to listOf("recorder"),
        )
    }
}
