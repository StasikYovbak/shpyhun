package ua.jarvis.assistant.commands

import android.content.Intent
import android.provider.Settings
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import ua.jarvis.assistant.actions.Launcher
import ua.jarvis.assistant.commands.Parsers.hasStem
import ua.jarvis.assistant.text.UkNumbers
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

/*
 * Готові шаблонні команди. Вони працюють без інтернету й без Claude.
 * Порядок у CommandRouter.commands важливий: перша команда, що впізнала текст, перемагає.
 */

private val UK = Locale.forLanguageTag("uk")

private fun outcomeResult(o: Launcher.Outcome, okLog: String, what: String) = CommandResult(
    ok = o == Launcher.Outcome.STARTED || o == Launcher.Outcome.WAITING_UNLOCK,
    say = Launcher.describe(o, what),
    log = Launcher.describe(o, what) ?: okLog,
)

/** «Котра година?» */
object TimeCommand : VoiceCommand {
    override fun parse(input: CommandInput, ctx: CommandContext): CommandPlan? {
        if (!Parsers.isTimeQuery(input.tokens)) return null
        return CommandPlan("Котра година", ack = false) {
            val now = SimpleDateFormat("H:mm", UK).format(Date())
            CommandResult(true, "Зараз $now")
        }
    }
}

/** «Яке сьогодні число?» */
object DateCommand : VoiceCommand {
    override fun parse(input: CommandInput, ctx: CommandContext): CommandPlan? {
        if (!Parsers.isDateQuery(input.tokens)) return null
        return CommandPlan("Дата", ack = false) {
            CommandResult(true, "Сьогодні " + SimpleDateFormat("EEEE, d MMMM", UK).format(Date()))
        }
    }
}

/** «Який заряд батареї?» */
object BatteryCommand : VoiceCommand {
    override fun parse(input: CommandInput, ctx: CommandContext): CommandPlan? {
        if (!Parsers.isBatteryQuery(input.tokens)) return null
        return CommandPlan("Заряд батареї", ack = false) {
            val b = ctx.device.battery()
            CommandResult(true, "Заряд батареї ${UkNumbers.percent(b.percent)}" + if (b.charging) ", заряджається" else "")
        }
    }
}

/** «Увімкни / вимкни ліхтарик» */
object FlashlightCommand : VoiceCommand {
    override fun parse(input: CommandInput, ctx: CommandContext): CommandPlan? {
        if (!Parsers.isFlashlight(input.tokens)) return null
        val wanted = when (Parsers.toggleOf(input.tokens)) {
            Parsers.Toggle.ON -> true
            Parsers.Toggle.OFF -> false
            Parsers.Toggle.TOGGLE -> !ctx.device.isTorchOn()
        }
        return CommandPlan(if (wanted) "Ліхтарик: увімкнути" else "Ліхтарик: вимкнути", ack = false) {
            if (ctx.device.setTorch(wanted)) CommandResult(true, if (wanted) "Ліхтарик увімкнено" else "Ліхтарик вимкнено")
            else CommandResult(false, "Не вдалося керувати ліхтариком")
        }
    }
}

/** «Гучність на 50 відсотків», «гучніше», «тихіше» */
object VolumeCommand : VoiceCommand {
    override fun parse(input: CommandInput, ctx: CommandContext): CommandPlan? {
        val v = Parsers.parseVolume(input.tokens) ?: return null
        return CommandPlan("Гучність", ack = false) {
            val target = when (v) {
                is Parsers.Volume.Set -> v.percent
                is Parsers.Volume.Delta -> ctx.device.volumePercent() + v.percent
            }
            val actual = ctx.device.setVolumePercent(target)
            CommandResult(true, "Гучність ${UkNumbers.percent(actual)}")
        }
    }
}

/** «Постав будильник на 7:30», «розбуди мене через двадцять хвилин» */
object AlarmCommand : VoiceCommand {
    override fun parse(input: CommandInput, ctx: CommandContext): CommandPlan? {
        if (!Parsers.isAlarm(input.tokens)) return null
        val tail = Parsers.alarmTail(input.tokens)
        val time: UkNumbers.Time? = if ("через" in tail) {
            UkNumbers.parseDurationSeconds(tail.drop(tail.indexOf("через") + 1))?.let { sec ->
                val cal = Calendar.getInstance().apply { add(Calendar.SECOND, sec) }
                UkNumbers.Time(cal.get(Calendar.HOUR_OF_DAY), cal.get(Calendar.MINUTE))
            }
        } else {
            UkNumbers.parseTime(tail)
        }
        if (time == null) {
            return CommandPlan("Будильник", ack = false) { CommandResult(false, "Не зрозумів, на котру годину ставити будильник") }
        }
        val label = "%d:%02d".format(time.hour, time.minute)
        return CommandPlan("Будильник на $label") {
            val o = ctx.device.setAlarm(time.hour, time.minute)
            if (o == Launcher.Outcome.STARTED) CommandResult(true, "Будильник на $label встановлено")
            else outcomeResult(o, "Будильник на $label", "поставлю будильник")
        }
    }
}

/** «Постав таймер на 10 хвилин» */
object TimerCommand : VoiceCommand {
    override fun parse(input: CommandInput, ctx: CommandContext): CommandPlan? {
        if (!Parsers.isTimer(input.tokens)) return null
        val sec = UkNumbers.parseDurationSeconds(Parsers.timerTail(input.tokens))
            ?: return CommandPlan("Таймер", ack = false) { CommandResult(false, "Не зрозумів, на скільки ставити таймер") }
        val label = UkNumbers.durationText(sec)
        return CommandPlan("Таймер на $label") {
            val o = ctx.device.setTimer(sec)
            if (o == Launcher.Outcome.STARTED) CommandResult(true, "Таймер на $label запущено")
            else outcomeResult(o, "Таймер на $label", "запущу таймер")
        }
    }
}

/** «Увімкни пісню … через ютуб» — пошук і миттєве відтворення першого відео. */
object YouTubeCommand : VoiceCommand {
    override fun parse(input: CommandInput, ctx: CommandContext): CommandPlan? {
        if (!Parsers.isYouTube(input.tokens)) return null
        val query = Parsers.youTubeQuery(input.tokens)
        return CommandPlan(if (query.isBlank()) "Відкрити YouTube" else "YouTube: $query") { io ->
            MediaActions.playOnYouTube(ctx, query, io, normalize = true, extraText = input.extraText)
        }
    }
}

/** «Подзвони мамі», «набери нуль шістдесят сім …» */
object CallCommand : VoiceCommand {
    override fun parse(input: CommandInput, ctx: CommandContext): CommandPlan? {
        if (!Parsers.isCall(input.tokens)) return null
        val target = Parsers.callTarget(input.tokens)
        return CommandPlan("Дзвінок: $target", ack = false) { io -> PhoneActions.call(ctx, target, io) }
    }
}

/** «Напиши мамі повідомлення привіт» */
object SmsCommand : VoiceCommand {
    override fun parse(input: CommandInput, ctx: CommandContext): CommandPlan? {
        if (!Parsers.isSms(input.tokens)) return null
        val candidates = Parsers.smsCandidates(input.tokens)
        return CommandPlan("SMS", ack = false) { io -> PhoneActions.smsFromCandidates(ctx, candidates, io) }
    }
}

/** «Прокладай маршрут до вокзалу» */
object NavigationCommand : VoiceCommand {
    override fun parse(input: CommandInput, ctx: CommandContext): CommandPlan? {
        if (!Parsers.isNavigation(input.tokens)) return null
        val dest = Parsers.navigationTarget(input.tokens)
        if (dest.isBlank()) return CommandPlan("Маршрут", ack = false) { CommandResult(false, "Куди прокласти маршрут?") }
        return CommandPlan("Маршрут до $dest") {
            outcomeResult(ctx.device.navigate(dest), "Маршрут до $dest", "прокладу маршрут")
        }
    }
}

/** «Знайди в гуглі …» */
object WebSearchCommand : VoiceCommand {
    override fun parse(input: CommandInput, ctx: CommandContext): CommandPlan? {
        val t = input.tokens
        // Голе «знайди …» без слова «гугл» віддаємо Claude (якщо він є) — він зрозуміє точніше.
        val bareFind = t.take(1).hasStem("знайди", "пошукай") && !ctx.prefs.hasClaude
        if (!Parsers.isWebSearch(t) && !bareFind) return null
        val q = Parsers.webQuery(t)
        if (q.isBlank()) return CommandPlan("Пошук", ack = false) { CommandResult(false, "Що саме знайти?") }
        return CommandPlan("Пошук: $q") { outcomeResult(ctx.device.webSearch(q), "Пошук: $q", "відкрию пошук") }
    }
}

/** «Відкрий телеграм» — нечіткий пошук серед встановлених програм. */
object OpenAppCommand : VoiceCommand {
    override fun parse(input: CommandInput, ctx: CommandContext): CommandPlan? {
        if (!Parsers.isOpenApp(input.tokens)) return null
        val name = Parsers.appName(input.tokens)
        if (name.isBlank()) return null
        val found = ctx.apps.find(name)
        if (found == null) {
            // Не знайшли — нехай спробує Claude (у нього є список програм), а без нього — чесно кажемо.
            if (ctx.prefs.hasClaude && ctx.prefs.smartMode) return null
            return CommandPlan("Відкрити $name", ack = false) { CommandResult(false, "Не знайшов програму «$name»") }
        }
        val app = found.first
        return CommandPlan("Відкрити ${app.label}") {
            val o = withContext(Dispatchers.Main) { ctx.device.openApp(app) }
            outcomeResult(o, "Відкрито ${app.label}", "відкрию ${app.label}")
        }
    }
}

/**
 * «Увімкни вайфай», «відкрий налаштування вай фай».
 * Це й приклад того, як додати власну команду — див. README, розділ 12.
 */
object WifiCommand : VoiceCommand {
    override fun parse(input: CommandInput, ctx: CommandContext): CommandPlan? {
        // input.tokens — слова команди малими літерами, без апострофів і розділових знаків
        if (!input.tokens.joinToString("").contains("вайфай") && "wifi" !in input.tokens) return null
        return CommandPlan("Wi-Fi") {
            // Android 10+ не дозволяє програмам самим вмикати Wi-Fi — відкриваємо системну панель.
            val o = ctx.launcher.start(Intent(Settings.Panel.ACTION_WIFI), "Wi-Fi")
            outcomeResult(o, "Відкрито панель Wi-Fi", "відкрию панель Wi-Fi")
        }
    }
}
