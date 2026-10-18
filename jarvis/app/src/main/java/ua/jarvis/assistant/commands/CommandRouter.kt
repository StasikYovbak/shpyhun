package ua.jarvis.assistant.commands

import ua.jarvis.assistant.smart.AgentExecutor

/**
 * Обирає, хто виконає команду: спершу шаблони (швидко й офлайн),
 * а якщо жоден не підійшов — розумний режим (Claude).
 */
class CommandRouter(private val ctx: CommandContext) {

    /**
     * Шаблонні команди. ПОРЯДОК ВАЖЛИВИЙ: виграє перша, що впізнала текст.
     * Нову команду додавайте сюди (див. README, розділ «Як додати команду»).
     */
    val commands: List<VoiceCommand> = listOf(
        YouTubeCommand,
        WifiCommand,
        FlashlightCommand,
        AlarmCommand,
        TimerCommand,
        VolumeCommand,
        TimeCommand,
        DateCommand,
        BatteryCommand,
        CallCommand,
        SmsCommand,
        NavigationCommand,
        WebSearchCommand,
        OpenAppCommand,
    )

    private val executor = AgentExecutor(ctx)

    fun route(input: CommandInput): CommandPlan? {
        for (cmd in commands) {
            val plan = runCatching { cmd.parse(input, ctx) }.getOrNull()
            if (plan != null) return plan
        }
        if (ctx.prefs.smartMode && ctx.prefs.hasClaude) {
            return CommandPlan("Розумний режим") { io ->
                ctx.claude.runTask(input.text, input.extraText, io, executor)
            }
        }
        return null
    }
}
