package ua.jarvis.assistant.text

import kotlin.math.max
import kotlin.math.min

/**
 * Нормалізація тексту, який повертає Vosk, і нечітке порівняння слів.
 *
 * Vosk видає текст малими літерами без розділових знаків, але апостроф
 * трапляється в обох варіантах («п'ять» і «пять»), тому апострофи ми прибираємо
 * всюди — і в розпізнаному тексті, і в словах, з якими порівнюємо.
 */
object TextNorm {

    private val apostrophes = Regex("['’ʼ`´‘]")
    private val nonWord = Regex("[^\\p{L}\\p{Nd}]+")

    fun normalize(text: String): String =
        text.lowercase()
            .replace(apostrophes, "")
            .replace('ё', 'е')
            .replace(nonWord, " ")
            .trim()

    fun tokens(text: String): List<String> =
        normalize(text).split(' ').filter { it.isNotEmpty() }

    /** Відстань Левенштейна (кількість вставок, видалень і замін літер). */
    fun levenshtein(a: String, b: String): Int {
        if (a == b) return 0
        if (a.isEmpty()) return b.length
        if (b.isEmpty()) return a.length
        var prev = IntArray(b.length + 1) { it }
        var cur = IntArray(b.length + 1)
        for (i in 1..a.length) {
            cur[0] = i
            for (j in 1..b.length) {
                val cost = if (a[i - 1] == b[j - 1]) 0 else 1
                cur[j] = min(min(cur[j - 1] + 1, prev[j] + 1), prev[j - 1] + cost)
            }
            val t = prev; prev = cur; cur = t
        }
        return prev[b.length]
    }

    /** Схожість від 0.0 до 1.0. */
    fun similarity(a: String, b: String): Double {
        if (a.isEmpty() && b.isEmpty()) return 1.0
        val len = max(a.length, b.length)
        return 1.0 - levenshtein(a, b).toDouble() / len
    }

    private val latToCyrPairs = listOf(
        "shch" to "щ", "sch" to "щ", "zh" to "ж", "kh" to "х", "ts" to "ц", "ch" to "ч", "sh" to "ш",
        "yu" to "ю", "iu" to "ю", "ya" to "я", "ia" to "я", "ye" to "є", "ie" to "є", "yi" to "ї",
        "oo" to "у", "ee" to "і", "ph" to "ф", "th" to "т", "ck" to "к", "qu" to "кв",
        "a" to "а", "b" to "б", "c" to "к", "d" to "д", "e" to "е", "f" to "ф", "g" to "г", "h" to "х",
        "i" to "і", "j" to "дж", "k" to "к", "l" to "л", "m" to "м", "n" to "н", "o" to "о", "p" to "п",
        "q" to "к", "r" to "р", "s" to "с", "t" to "т", "u" to "у", "v" to "в", "w" to "в", "x" to "кс",
        "y" to "і", "z" to "з",
    )

    /** Груба транслітерація латиниці в кирилицю — лише для порівняння назв («telegram» → «телеграм»). */
    fun latinToCyrillic(text: String): String {
        val s = text.lowercase()
        val sb = StringBuilder()
        var i = 0
        outer@ while (i < s.length) {
            for ((lat, cyr) in latToCyrPairs) {
                if (s.startsWith(lat, i)) {
                    sb.append(cyr); i += lat.length; continue@outer
                }
            }
            sb.append(s[i]); i++
        }
        return sb.toString()
    }

    private val cyrToLat = mapOf(
        'а' to "a", 'б' to "b", 'в' to "v", 'г' to "h", 'ґ' to "g", 'д' to "d", 'е' to "e", 'є' to "ye",
        'ж' to "zh", 'з' to "z", 'и' to "y", 'і' to "i", 'ї' to "yi", 'й' to "y", 'к' to "k", 'л' to "l",
        'м' to "m", 'н' to "n", 'о' to "o", 'п' to "p", 'р' to "r", 'с' to "s", 'т' to "t", 'у' to "u",
        'ф' to "f", 'х' to "kh", 'ц' to "ts", 'ч' to "ch", 'ш' to "sh", 'щ' to "shch", 'ь' to "",
        'ю' to "yu", 'я' to "ya", 'ы' to "y", 'э' to "e", 'ъ' to "",
    )

    fun cyrillicToLatin(text: String): String =
        text.lowercase().map { c -> cyrToLat[c] ?: c.toString() }.joinToString("")

    fun hasLatin(text: String) = text.any { it in 'a'..'z' || it in 'A'..'Z' }

    /** Найкраща схожість двох назв з урахуванням транслітерації в обидва боки. */
    fun nameSimilarity(spoken: String, name: String): Double {
        val a = normalize(spoken).replace(" ", "")
        val b = normalize(name).replace(" ", "")
        if (a.isEmpty() || b.isEmpty()) return 0.0
        var best = similarity(a, b)
        if (hasLatin(b)) best = max(best, similarity(a, latinToCyrillic(b)))
        if (hasLatin(a)) best = max(best, similarity(latinToCyrillic(a), b))
        best = max(best, similarity(cyrillicToLatin(a), cyrillicToLatin(b)) - 0.05)
        return best
    }

    private val caseEndings = listOf(
        "ові", "еві", "єві", "ою", "ею", "єю", "ій", "ої", "ом", "ем", "ам", "ям", "ах", "ях",
        "у", "ю", "і", "ї", "а", "я", "е", "о", "и", "ь", "й",
    )

    /** Відрізає відмінкове закінчення: «мамі» → «мам», «олегу» → «олег», «ані» → «ан». */
    fun stem(word: String): String {
        for (end in caseEndings) {
            if (word.length - end.length >= 2 && word.endsWith(end)) return word.dropLast(end.length)
        }
        return word
    }
}
