package ua.jarvis.assistant.commands

import android.content.Context
import ua.jarvis.assistant.actions.AppFinder
import ua.jarvis.assistant.actions.ContactFinder
import ua.jarvis.assistant.actions.DeviceControl
import ua.jarvis.assistant.actions.Launcher
import ua.jarvis.assistant.actions.YouTubeApi
import ua.jarvis.assistant.core.Prefs
import ua.jarvis.assistant.smart.ClaudeAgent
import ua.jarvis.assistant.text.TextNorm

/** Те, що користувач сказав між «Джарвіс» і «Виконуй». */
data class CommandInput(
    /** Текст команди (нормалізований). */
    val text: String,
    /** Та сама фраза, як її почула друга модель (англ./рос.), якщо вона ввімкнена. */
    val extraText: String = "",
) {
    val tokens: List<String> = TextNorm.tokens(text)
}

/** Результат виконання: що сказати вголос і що записати в журнал. */
data class CommandResult(
    val ok: Boolean,
    val say: String? = null,
    val log: String? = say,
)

/** Як команда спілкується з користувачем під час виконання. Реалізує сервіс. */
interface Interaction {
    /** Сказати й дочекатися, поки договорить. */
    suspend fun say(text: String)

    /** Сказати й не чекати. */
    fun sayAsync(text: String)

    /** Запитати «так/ні» голосом. false — якщо «ні» або тиша 15 секунд. */
    suspend fun confirm(question: String): Boolean

    /** Короткий статус для екрана й сповіщення. */
    fun status(text: String)
}

/** План: що робити. Розбір (parse) швидкий, а виконання (run) — асинхронне. */
class CommandPlan(
    /** Назва для журналу: «Ліхтарик: увімкнути». */
    val title: String,
    /** Чи казати «Виконую» перед запуском (для «котра година» не треба — одразу відповідаємо). */
    val ack: Boolean = true,
    val run: suspend (Interaction) -> CommandResult,
)

/** Усе, що може знадобитися команді. */
class CommandContext(
    val app: Context,
    val prefs: Prefs,
    val launcher: Launcher,
    val apps: AppFinder,
    val contacts: ContactFinder,
    val device: DeviceControl,
    val youtube: YouTubeApi,
    val claude: ClaudeAgent,
)

/**
 * Одна шаблонна команда. Щоб додати нову — реалізуйте цей інтерфейс
 * і додайте об'єкт у список [CommandRouter.commands].
 */
interface VoiceCommand {
    /** Поверніть план, якщо команда «ваша», або null — тоді спробують наступну. */
    fun parse(input: CommandInput, ctx: CommandContext): CommandPlan?
}
