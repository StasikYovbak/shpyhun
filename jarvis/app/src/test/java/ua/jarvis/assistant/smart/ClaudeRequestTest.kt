package ua.jarvis.assistant.smart

import com.fasterxml.jackson.databind.ObjectMapper
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Перевіряє, що SDK серіалізує запит саме в ту форму, яку очікує Messages API. */
class ClaudeRequestTest {

    private fun body(model: String, structured: Boolean = true, fallbacks: Boolean = true): JSONObject {
        val params = ClaudeRequest.build(
            model, "low", structured, fallbacks,
            AgentPrompt.system(listOf("YouTube", "Telegram")),
            AgentPrompt.decisionSchema(),
            listOf(ClaudeRequest.userMessage("Команда: «скільки буде два плюс два»")),
            16_000,
        )
        // Той самий JsonMapper, яким SDK серіалізує запит перед відправкою (у Kotlin він internal).
        val mapper = Class.forName("com.anthropic.core.ObjectMappers").getMethod("jsonMapper").invoke(null) as ObjectMapper
        val json = mapper.writeValueAsString(params._body())
        return JSONObject(json).also { it.put("__beta", params._headers().values("anthropic-beta").joinToString(",")) }
    }

    @Test fun opus55Request() {
        val b = body("claude-opus-5-5")
        assertEquals("claude-opus-5-5", b.getString("model"))
        assertEquals(16_000, b.getInt("max_tokens"))
        assertTrue(b.getString("system").contains("Джарвіс"))
        assertEquals("user", b.getJSONArray("messages").getJSONObject(0).getString("role"))
        assertEquals("ephemeral", b.getJSONObject("cache_control").getString("type"))
        val out = b.getJSONObject("output_config")
        assertEquals("low", out.getString("effort"))
        val format = out.getJSONObject("format")
        assertEquals("json_schema", format.getString("type"))
        val schema = format.getJSONObject("schema")
        assertEquals("object", schema.getString("type"))
        assertFalse(schema.getBoolean("additionalProperties"))
        assertTrue(schema.getJSONObject("properties").getJSONObject("action").getJSONArray("enum").toString().contains("youtube_play"))
        assertEquals("default", b.getString("fallbacks"))
        assertTrue(b.getString("__beta").contains("server-side-fallback-2026-07-01"))
        assertFalse("thinking must be omitted on Opus 5.5", b.has("thinking"))
    }

    @Test fun haikuHasNoFallbacks() {
        val b = body("claude-haiku-5-5")
        assertFalse(b.has("fallbacks"))
        assertEquals("low", b.getJSONObject("output_config").getString("effort"))
    }

    @Test fun oldModelWithoutEffortOrSchema() {
        val b = body("claude-haiku-4-5", structured = false)
        assertFalse(b.has("output_config"))
        assertFalse(b.has("fallbacks"))
    }

    @Test fun fallbacksCanBeTurnedOff() {
        val b = body("claude-opus-5-5", fallbacks = false)
        assertFalse(b.has("fallbacks"))
        assertFalse(b.getString("__beta").contains("server-side-fallback"))
    }

    @Test fun decisionParsing() {
        val d = Decision.parse("""```json
            {"action":"open_app","params":{"app":"Telegram"},"say":"","done":false,"dangerous":false}
            ```""")
        assertEquals("open_app", d.action)
        assertEquals("Telegram", d.str("app"))
        assertFalse(d.done)
        val d2 = Decision.parse("""{"action":"set_alarm","params":{"hour":7,"minute":30},"say":"Готово","done":true,"dangerous":false}""")
        assertEquals(7, d2.int("hour"))
        assertEquals(null, d2.int("seconds"))
    }
}
