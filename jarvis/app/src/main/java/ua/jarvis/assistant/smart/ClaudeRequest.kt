package ua.jarvis.assistant.smart

import com.anthropic.core.JsonValue
import com.anthropic.models.beta.messages.BetaCacheControlEphemeral
import com.anthropic.models.beta.messages.BetaFallbacksParam
import com.anthropic.models.beta.messages.BetaJsonOutputFormat
import com.anthropic.models.beta.messages.BetaMessageParam
import com.anthropic.models.beta.messages.BetaOutputConfig
import com.anthropic.models.beta.messages.MessageCreateParams

/** Побудова запиту до Claude Messages API (окремо від мережі — щоб перевіряти тестами). */
object ClaudeRequest {

    /** Нові моделі підтримують effort; старим (Haiku 4.5 тощо) його не можна надсилати. */
    fun supportsEffort(model: String) =
        listOf("claude-opus-", "claude-fable-", "claude-mythos-", "claude-sonnet-5", "claude-sonnet-4-6", "claude-haiku-5")
            .any { model.startsWith(it) }

    /**
     * Server-side fallback: якщо запобіжники безпеки моделі відхилять запит, API сам
     * повторить його на іншій моделі. Доступно для Opus 5 / 5.5, Fable 5.1 і Sonnet 5.5.
     */
    fun supportsFallbacks(model: String) =
        listOf("claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5").any { model.startsWith(it) }

    fun effortOf(name: String): BetaOutputConfig.Effort = when (name) {
        "medium" -> BetaOutputConfig.Effort.MEDIUM
        "high" -> BetaOutputConfig.Effort.HIGH
        else -> BetaOutputConfig.Effort.LOW
    }

    private fun schemaOf(map: Map<String, Any>): BetaJsonOutputFormat.Schema {
        val b = BetaJsonOutputFormat.Schema.builder()
        map.forEach { (k, v) -> b.putAdditionalProperty(k, JsonValue.from(v)) }
        return b.build()
    }

    fun userMessage(text: String): BetaMessageParam =
        BetaMessageParam.builder().role(BetaMessageParam.Role.USER).content(text).build()

    fun build(
        model: String,
        effort: String,
        structured: Boolean,
        fallbacks: Boolean,
        system: String,
        schema: Map<String, Any>,
        messages: List<BetaMessageParam>,
        maxTokens: Long,
    ): MessageCreateParams {
        val b = MessageCreateParams.builder()
            .model(model)
            .maxTokens(maxTokens)
            .system(system)
            .messages(messages)
            // Кешування префікса (системний промпт + історія): наступні кроки дешевші й швидші.
            .cacheControl(BetaCacheControlEphemeral.builder().build())
        val out = BetaOutputConfig.builder()
        var hasOut = false
        if (supportsEffort(model)) { out.effort(effortOf(effort)); hasOut = true }
        if (structured) { out.format(BetaJsonOutputFormat.builder().schema(schemaOf(schema)).build()); hasOut = true }
        if (hasOut) b.outputConfig(out.build())
        if (fallbacks && supportsFallbacks(model)) {
            b.addBeta("server-side-fallback-2026-07-01")
            b.fallbacks(BetaFallbacksParam.ofDefault())
        }
        return b.build()
    }
}
