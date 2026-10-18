package ua.jarvis.assistant.smart

import android.util.Log
import com.anthropic.client.AnthropicClient
import com.anthropic.client.okhttp.AnthropicOkHttpClient
import com.anthropic.errors.AnthropicIoException
import com.anthropic.errors.AnthropicServiceException
import com.anthropic.errors.BadRequestException
import com.anthropic.errors.InternalServerException
import com.anthropic.errors.NotFoundException
import com.anthropic.errors.PermissionDeniedException
import com.anthropic.errors.RateLimitException
import com.anthropic.errors.UnauthorizedException
import com.anthropic.models.beta.messages.BetaMessage
import com.anthropic.models.beta.messages.BetaMessageParam
import com.anthropic.models.beta.messages.BetaStopReason
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import ua.jarvis.assistant.commands.CommandResult
import ua.jarvis.assistant.commands.Interaction
import ua.jarvis.assistant.core.Prefs
import java.text.SimpleDateFormat
import java.time.Duration
import java.util.Date
import java.util.Locale

/**
 * Розумний режим: команди, яких немає серед шаблонів, іде до Claude через офіційний
 * Java SDK (com.anthropic:anthropic-java). Claude відповідає JSON-рішенням,
 * застосунок виконує дію, повертає результат — і так до 10 кроків.
 */
class ClaudeAgent(private val prefs: Prefs) {

    class ClaudeException(message: String) : Exception(message)

    private var client: AnthropicClient? = null
    private var clientKey = ""
    private var structuredUnsupported = false

    @Synchronized
    private fun client(): AnthropicClient {
        val key = prefs.claudeKey
        if (key.isBlank()) throw ClaudeException("Не вказано ключ Claude API. Додайте його в налаштуваннях")
        val existing = client
        if (existing != null && key == clientKey) return existing
        existing?.close()
        return AnthropicOkHttpClient.builder()
            .apiKey(key)
            .timeout(Duration.ofSeconds(90))
            .maxRetries(2)
            .build()
            .also { client = it; clientKey = key }
    }

    fun close() {
        synchronized(this) { client?.close(); client = null }
    }

    private var fallbacksUnsupported = false

    private fun request(system: String, schema: Map<String, Any>, messages: List<BetaMessageParam>, maxTokens: Long) =
        ClaudeRequest.build(
            prefs.claudeModel, prefs.claudeEffort, !structuredUnsupported, !fallbacksUnsupported,
            system, schema, messages, maxTokens,
        )

    private suspend fun call(system: String, schema: Map<String, Any>, messages: List<BetaMessageParam>, maxTokens: Long = 16_000): BetaMessage =
        withContext(Dispatchers.IO) {
            var attempts = 0
            var result: BetaMessage? = null
            while (result == null) {
                try {
                    result = client().beta().messages().create(request(system, schema, messages, maxTokens))
                } catch (e: BadRequestException) {
                    // Якщо обрана в налаштуваннях модель чогось не вміє — вимикаємо це й повторюємо.
                    val msg = e.message.orEmpty()
                    when {
                        !fallbacksUnsupported && msg.contains("fallback", true) -> fallbacksUnsupported = true
                        !structuredUnsupported && (msg.contains("output_config", true) || msg.contains("json_schema", true) ||
                            msg.contains("output format", true)) -> structuredUnsupported = true
                        else -> throw e
                    }
                    if (++attempts > 2) throw e
                }
            }
            result
        }

    private fun textOf(msg: BetaMessage): String =
        msg.content().mapNotNull { it.text().orElse(null)?.text() }.joinToString("\n")

    private fun userMessage(text: String) = ClaudeRequest.userMessage(text)

    // ------------------------------------------------------------ агент

    suspend fun runTask(
        command: String,
        extraText: String,
        io: Interaction,
        executor: AgentExecutor,
    ): CommandResult {
        val system = AgentPrompt.system(executor.installedAppNames())
        val history = mutableListOf<BetaMessageParam>()
        val now = SimpleDateFormat("EEEE, d MMMM yyyy, HH:mm", Locale.forLanguageTag("uk")).format(Date())
        val first = buildString {
            append("Команда користувача: «").append(command).append("»\n")
            if (extraText.isNotBlank()) append("Друга модель розпізнавання (іншою мовою) почула: «").append(extraText).append("»\n")
            append("Зараз: ").append(now).append('\n')
            append(executor.environment())
        }
        history += userMessage(first)

        repeat(MAX_STEPS) { step ->
            io.status(if (step == 0) "Думаю…" else "Крок ${step + 1}…")
            val resp = try {
                call(system + jsonHint(), AgentPrompt.decisionSchema(), history)
            } catch (e: Exception) {
                return CommandResult(false, explain(e))
            }
            if (resp.stopReason().orElse(null) == BetaStopReason.REFUSAL) {
                return CommandResult(false, "Вибачте, з цим я допомогти не можу")
            }
            val decision = try {
                Decision.parse(textOf(resp))
            } catch (e: Exception) {
                Log.w(TAG, "bad decision: ${textOf(resp)}", e)
                return CommandResult(false, "Claude відповів незрозуміло. Спробуйте ще раз")
            }
            // Історію лише доповнюємо (append-only) — так працює кеш і «збережені» роздуми моделі.
            history += resp.toParam()
            Log.i(TAG, "step $step: ${decision.action} ${decision.params} say=${decision.say}")

            if (decision.action == "say" || decision.action == "done") {
                return CommandResult(true, decision.say.ifBlank { null }, decision.say.ifBlank { "Готово" })
            }
            if (!decision.done && decision.say.isNotBlank()) io.sayAsync(decision.say)

            val outcome = executor.execute(decision, io)
            if (outcome.cancelled) return CommandResult(false, "Скасовано")
            if (decision.done) {
                val say = if (outcome.ok) decision.say.ifBlank { outcome.text } else outcome.text
                return CommandResult(outcome.ok, say.ifBlank { null }, outcome.text)
            }
            history += userMessage("Результат дії ${decision.action}: ${outcome.text}" + (outcome.screen?.let { "\n\nЕкран зараз:\n$it" } ?: ""))
        }
        return CommandResult(false, "Не вдалося завершити завдання за $MAX_STEPS кроків")
    }

    private fun jsonHint() =
        if (structuredUnsupported) "\n\nВідповідай ЛИШЕ одним JSON-об'єктом без пояснень і без ```." else ""

    /** «імеджин драгонс білівер» → «Imagine Dragons Believer». null — якщо не вийшло. */
    suspend fun normalizeSongQuery(heard: String, extraText: String): String? {
        if (!prefs.hasClaude) return null
        val text = buildString {
            append("Почуте українською моделлю: «").append(heard).append("»")
            if (extraText.isNotBlank()) append("\nДруга модель (іншою мовою) почула всю фразу так: «").append(extraText).append("»")
        }
        return try {
            val resp = call(AgentPrompt.SONG_SYSTEM + jsonHint(), AgentPrompt.songSchema(), listOf(userMessage(text)), 4_000)
            if (resp.stopReason().orElse(null) == BetaStopReason.REFUSAL) return null
            val raw = textOf(resp)
            val json = raw.substring(raw.indexOf('{'), raw.lastIndexOf('}') + 1)
            JSONObject(json).optString("query").trim().takeIf { it.isNotBlank() }
        } catch (e: Exception) {
            Log.w(TAG, "song normalize failed", e)
            null
        }
    }

    /** Перевірка ключа з екрана налаштувань. */
    suspend fun testKey(): String = try {
        val resp = call(
            "Відповідай JSON.", AgentPrompt.songSchema(),
            listOf(userMessage("Поверни query = «Ключ працює»")), 2_000,
        )
        "Ключ працює ✓ (модель ${resp.model().asString()})"
    } catch (e: Exception) {
        explain(e)
    }

    companion object {
        private const val TAG = "ClaudeAgent"
        const val MAX_STEPS = 10

        fun explain(e: Throwable): String = when (e) {
            is ClaudeException -> e.message ?: "Помилка Claude"
            is UnauthorizedException -> "Ключ Claude API недійсний"
            is PermissionDeniedException -> "Ключ Claude API не має доступу до цієї моделі"
            is NotFoundException -> "Модель не знайдено. Перевірте назву моделі в налаштуваннях"
            is RateLimitException -> "Забагато запитів до Claude. Спробуйте за хвилину"
            is BadRequestException ->
                if ((e.message ?: "").contains("credit", true)) "На рахунку Claude API закінчилися кошти"
                else "Claude не прийняв запит: ${e.message?.take(120)}"
            is InternalServerException -> "Сервери Claude тимчасово недоступні"
            is AnthropicServiceException -> "Помилка Claude API: ${e.statusCode()}"
            is AnthropicIoException -> "Немає з'єднання з інтернетом"
            else -> "Помилка розумного режиму: ${e.message?.take(100) ?: e.javaClass.simpleName}"
        }
    }
}
