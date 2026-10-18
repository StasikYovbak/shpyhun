package ua.jarvis.assistant.smart

import kotlinx.coroutines.delay
import ua.jarvis.assistant.actions.Launcher
import ua.jarvis.assistant.commands.CommandContext
import ua.jarvis.assistant.commands.Interaction
import ua.jarvis.assistant.commands.MediaActions
import ua.jarvis.assistant.commands.PhoneActions
import ua.jarvis.assistant.service.JarvisAccessibilityService
import ua.jarvis.assistant.text.UkNumbers

/** Виконує дії, які обрав Claude, і повідомляє результат назад. */
class AgentExecutor(private val c: CommandContext) {

    data class Outcome(val ok: Boolean, val text: String, val screen: String? = null, val cancelled: Boolean = false)

    private val acc get() = JarvisAccessibilityService.instance

    fun installedAppNames(): List<String> = c.apps.list().map { it.label }.distinct()

    fun environment(): String = buildString {
        val a = acc
        append("Служба спеціальних можливостей: ").append(if (a != null) "увімкнена" else "вимкнена (ui_* недоступні)").append('\n')
        if (a != null && a.foregroundPackage.isNotBlank()) append("Програма на екрані: ").append(a.foregroundPackage).append('\n')
        val b = c.device.battery()
        append("Заряд батареї: ").append(b.percent).append("%").append(if (b.charging) ", заряджається" else "").append('\n')
    }

    private fun launched(o: Launcher.Outcome, what: String): Outcome = when (o) {
        Launcher.Outcome.STARTED -> Outcome(true, "$what — виконано")
        Launcher.Outcome.WAITING_UNLOCK -> Outcome(true, "телефон заблоковано; $what виконається після розблокування")
        Launcher.Outcome.NEEDS_TAP -> Outcome(false, "Android не дозволив відкрити з фону; показано сповіщення")
        Launcher.Outcome.NOT_FOUND -> Outcome(false, "немає програми для цієї дії")
    }

    /** Знімок екрана після дії (з паузою, щоб інтерфейс устиг оновитися). */
    private suspend fun screenAfter(ms: Long): String? {
        val a = acc ?: return null
        delay(ms)
        return a.snapshot().toText()
    }

    private val dangerWords = Regex(
        "надісл|відправ|send|видал|delete|remove|оплат|сплат|pay|купи|buy|замов|order|переказ|transfer|підтверд|confirm|скинути|reset|стерти|erase",
        RegexOption.IGNORE_CASE,
    )

    suspend fun execute(d: Decision, io: Interaction): Outcome {
        return when (d.action) {
            "open_app" -> {
                val name = d.str("app")
                val found = c.apps.find(name) ?: return Outcome(false, "програму «$name» не знайдено серед встановлених")
                val o = c.device.openApp(found.first)
                launched(o, "відкрито ${found.first.label}").copy(screen = if (o == Launcher.Outcome.STARTED) screenAfter(2200) else null)
            }
            "open_url" -> launched(c.device.openUrl(d.str("url")), "відкрито сайт")
            "web_search" -> launched(c.device.webSearch(d.str("query")), "відкрито пошук")
            "youtube_play" -> {
                val r = MediaActions.playOnYouTube(c, d.str("query"), io, normalize = false)
                Outcome(r.ok, r.log ?: r.say ?: "")
            }
            "call" -> {
                val r = PhoneActions.call(c, d.str("contact").ifBlank { d.str("phone") }, io)
                Outcome(r.ok, r.log ?: "", cancelled = r.log == PhoneActions.CANCELLED)
            }
            "send_sms" -> {
                val r = PhoneActions.sms(c, d.str("contact").ifBlank { d.str("phone") }, d.str("text"), io)
                Outcome(r.ok, r.log ?: "", cancelled = r.log == PhoneActions.CANCELLED)
            }
            "navigate" -> launched(c.device.navigate(d.str("destination")), "маршрут прокладено")
            "set_alarm" -> {
                val h = d.int("hour") ?: return Outcome(false, "не вказано годину")
                val m = d.int("minute") ?: 0
                launched(c.device.setAlarm(h, m), "будильник на %d:%02d".format(h, m))
            }
            "set_timer" -> {
                val s = d.int("seconds")?.takeIf { it > 0 } ?: return Outcome(false, "не вказано тривалість")
                launched(c.device.setTimer(s), "таймер на ${UkNumbers.durationText(s)}")
            }
            "flashlight" -> {
                val on = d.str("state") != "off"
                if (c.device.setTorch(on)) Outcome(true, if (on) "ліхтарик увімкнено" else "ліхтарик вимкнено")
                else Outcome(false, "на телефоні немає спалаху")
            }
            "volume" -> {
                val v = c.device.setVolumePercent(d.int("level") ?: 50)
                Outcome(true, "гучність ${UkNumbers.percent(v)}")
            }
            "wait" -> {
                delay(((d.int("seconds") ?: 2).coerceIn(1, 5)) * 1000L)
                Outcome(true, "зачекав", screen = acc?.snapshot()?.toText())
            }
            "screen_read" -> {
                val a = acc ?: return Outcome(false, "служба спеціальних можливостей вимкнена")
                Outcome(true, "ось що на екрані", screen = a.snapshot().toText())
            }
            "ui_click" -> {
                val a = acc ?: return Outcome(false, "служба спеціальних можливостей вимкнена")
                val idx = d.int("element")
                val label = idx?.let { a.describe(it) } ?: d.str("text")
                if (d.dangerous || dangerWords.containsMatchIn(label)) {
                    val q = d.say.ifBlank { "Натиснути «${label.substringAfter('«').substringBefore('»')}»" }
                    if (!io.confirm("$q?")) return Outcome(false, "користувач скасував", cancelled = true)
                }
                val ok = if (idx != null) a.click(idx) else a.clickText(d.str("text"))
                Outcome(ok, if (ok) "натиснуто $label" else "не вдалося натиснути", screen = screenAfter(1300))
            }
            "ui_type" -> {
                val a = acc ?: return Outcome(false, "служба спеціальних можливостей вимкнена")
                val ok = a.type(d.int("element"), d.str("text"))
                Outcome(ok, if (ok) "текст введено" else "не знайшов поля для тексту", screen = screenAfter(700))
            }
            "ui_scroll" -> {
                val a = acc ?: return Outcome(false, "служба спеціальних можливостей вимкнена")
                val ok = a.scroll(d.str("direction") != "up")
                Outcome(ok, if (ok) "прокручено" else "нема чого прокручувати", screen = screenAfter(900))
            }
            "ui_global" -> {
                val a = acc ?: return Outcome(false, "служба спеціальних можливостей вимкнена")
                val name = d.str("name")
                if (name == "lock" && d.dangerous && !io.confirm("Заблокувати телефон?")) {
                    return Outcome(false, "користувач скасував", cancelled = true)
                }
                val ok = a.global(name)
                Outcome(ok, if (ok) "виконано $name" else "не вдалося", screen = if (name == "lock") null else screenAfter(1000))
            }
            else -> Outcome(false, "невідома дія ${d.action}")
        }.let { o ->
            // Довгий вміст екрана обрізаємо, щоб не роздувати запит.
            if (o.screen != null && o.screen.length > 6000) o.copy(screen = o.screen.take(6000) + "\n…") else o
        }
    }
}
