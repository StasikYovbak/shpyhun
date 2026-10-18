package ua.jarvis.assistant.text

import kotlin.math.max
import kotlin.math.min

/**
 * Нечітке порівняння сказаного імені з іменем контакту чи назвою програми.
 * «мамі» ≈ «Мама», «олегу петренку» ≈ «Олег Петренко», «телеграм» ≈ «Telegram».
 */
object NameMatch {

    /** Нижче цієї схожості вважаємо, що контакт не знайдено (перед дзвінком однаково перепитуємо). */
    const val CONTACT_THRESHOLD = 0.78

    private fun prepare(token: String): String =
        if (TextNorm.hasLatin(token)) TextNorm.latinToCyrillic(token) else token

    private fun tokenScore(a: String, b: String): Double {
        val sa = TextNorm.stem(a)
        val sb = TextNorm.stem(b)
        var s = max(TextNorm.similarity(a, b), TextNorm.similarity(sa, sb))
        if (min(sa.length, sb.length) >= 3 && (sa.startsWith(sb) || sb.startsWith(sa))) s = max(s, 0.9)
        return s
    }

    fun score(spoken: String, name: String): Double {
        val s = TextNorm.tokens(spoken).map(::prepare)
        val n = TextNorm.tokens(name).map(::prepare)
        if (s.isEmpty() || n.isEmpty()) return 0.0
        var best = TextNorm.nameSimilarity(spoken, name)
        val perToken = s.map { st -> n.maxOf { nt -> tokenScore(st, nt) } }.average()
        // Ім'я контакту довше за сказане («Мама Оля» на «мамі») — трохи менше впевненості.
        val penalty = if (n.size > s.size) 0.04 * (n.size - s.size) else 0.0
        best = max(best, perToken - penalty)
        return best.coerceIn(0.0, 1.0)
    }
}
