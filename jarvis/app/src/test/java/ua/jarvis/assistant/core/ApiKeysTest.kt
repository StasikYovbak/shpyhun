package ua.jarvis.assistant.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ApiKeysTest {

    // Вигадані ключі правильного формату (не справжні).
    private val claude = "sk-ant-api03-" + "Ab3_x-".repeat(15) + "AA"
    private val youtube = "AIza" + "SyD-abcdefghijklmnopqrstuvwxyz01234"

    @Test fun claudeKeyFromMessyClipboard() {
        assertEquals(claude, ApiKeys.extractClaude(claude))
        assertEquals(claude, ApiKeys.extractClaude("  $claude\n"))
        assertEquals(claude, ApiKeys.extractClaude("Jarvis key: $claude (created today)"))
        assertNull(ApiKeys.extractClaude("sk-ant-"))
        assertNull(ApiKeys.extractClaude(youtube))
        assertNull(ApiKeys.extractClaude(null))
    }

    @Test fun youtubeKeyFromMessyClipboard() {
        assertEquals(39, youtube.length)
        assertEquals(youtube, ApiKeys.extractYouTube(youtube))
        assertEquals(youtube, ApiKeys.extractYouTube("API key\n$youtube\n"))
        assertNull(ApiKeys.extractYouTube("AIzaTooShort"))
        assertNull(ApiKeys.extractYouTube(claude))
        assertNull(ApiKeys.extractYouTube(""))
    }
}
