package ua.jarvis.assistant.commands

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import ua.jarvis.assistant.actions.Contact
import ua.jarvis.assistant.actions.Launcher
import ua.jarvis.assistant.text.TextNorm

/**
 * Дзвінки й SMS — спільні для шаблонних команд і для розумного режиму.
 * Обидві дії небезпечні, тому ЗАВЖДИ питають «так/ні» перед виконанням.
 */
object PhoneActions {
    const val CANCELLED = "скасовано користувачем"

    private data class Target(val name: String, val number: String)

    private suspend fun resolve(c: CommandContext, spoken: String): Result<Target> {
        val text = spoken.trim()
        if (text.isEmpty()) return Result.failure(IllegalArgumentException("Кому саме?"))
        // Номер, продиктований словами або цифрами
        val digits = Parsers.phoneDigits(TextNorm.normalize(text))
            ?: text.filter { it.isDigit() || it == '+' }.takeIf { s -> s.count { it.isDigit() } >= 3 }
        if (digits != null) return Result.success(Target(digits.toList().joinToString(" "), digits))
        if (!c.contacts.hasPermission()) {
            return Result.failure(IllegalStateException("Немає дозволу на контакти. Надайте його в налаштуваннях Джарвіса"))
        }
        val found = withContext(Dispatchers.IO) { c.contacts.find(text) }
            ?: return Result.failure(IllegalStateException("Не знайшов у контактах «$text»"))
        return Result.success(Target(found.first.name, found.first.number))
    }

    suspend fun call(c: CommandContext, spoken: String, io: Interaction): CommandResult {
        val t = resolve(c, spoken).getOrElse { return CommandResult(false, it.message) }
        if (!io.confirm("Подзвонити: ${t.name}?")) return CommandResult(false, "Скасовано", CANCELLED)
        return when (val o = c.device.call(t.number)) {
            Launcher.Outcome.STARTED -> CommandResult(true, null, "Дзвінок: ${t.name}")
            else -> CommandResult(o == Launcher.Outcome.WAITING_UNLOCK, Launcher.describe(o, "подзвоню"), "Дзвінок: ${t.name}")
        }
    }

    suspend fun sms(c: CommandContext, spoken: String, text: String, io: Interaction): CommandResult {
        if (text.isBlank()) return CommandResult(false, "Що написати?")
        val t = resolve(c, spoken).getOrElse { return CommandResult(false, it.message) }
        return sendConfirmed(c, t, text, io)
    }

    /** Варіанти «кому / що» з [Parsers.smsCandidates] — обираємо той, де ім'я найкраще збіглося з контактом. */
    suspend fun smsFromCandidates(c: CommandContext, candidates: List<Parsers.SmsSplit>, io: Interaction): CommandResult {
        val usable = candidates.filter { it.name.isNotBlank() && it.text.isNotBlank() }
        if (usable.isEmpty()) return CommandResult(false, "Не зрозумів, кому і що написати")
        if (usable.size == 1) return sms(c, usable[0].name, usable[0].text, io)
        if (!c.contacts.hasPermission()) return CommandResult(false, "Немає дозволу на контакти")
        val contacts = withContext(Dispatchers.IO) { c.contacts.all() }
        var best: Triple<Parsers.SmsSplit, Contact, Double>? = null
        for (cand in usable) {
            val hit = c.contacts.find(cand.name, contacts) ?: continue
            if (best == null || hit.second > best.third) best = Triple(cand, hit.first, hit.second)
        }
        val b = best ?: return CommandResult(false, "Не знайшов у контактах «${usable[0].name}»")
        return sendConfirmed(c, Target(b.second.name, b.second.number), b.first.text, io)
    }

    private suspend fun sendConfirmed(c: CommandContext, t: Target, text: String, io: Interaction): CommandResult {
        if (!io.confirm("Надіслати ${t.name} повідомлення: «$text»?")) return CommandResult(false, "Скасовано", CANCELLED)
        return if (c.device.sendSms(t.number, text)) {
            CommandResult(true, "Повідомлення надіслано", "SMS ${t.name}: $text")
        } else {
            CommandResult(false, "Немає дозволу на SMS — відкриваю програму повідомлень", "SMS ${t.name}: $text")
        }
    }
}
