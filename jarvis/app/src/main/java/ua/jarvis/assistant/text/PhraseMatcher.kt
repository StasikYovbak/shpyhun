package ua.jarvis.assistant.text

/**
 * Шукає слово або фразу («джарвіс», «привіт джарвіс») у потоці розпізнаних слів.
 *
 * Розпізнавання ніколи не буває ідеальним, тому:
 *  - допускаються дрібні помилки (1–2 літери, залежно від довжини слова);
 *  - слово може бути розбите на два («джар віс») або склеєне з фрази в одне;
 *  - користувач може додати власні варіанти того, як модель чує його слово.
 */
class PhraseMatcher(
    phrase: String,
    variants: Collection<String> = emptyList(),
    private val typos: (Int) -> Int = ::defaultTypos,
) {
    data class Match(val start: Int, val endExclusive: Int, val exact: Boolean) {
        val last get() = endExclusive - 1
    }

    private val forms: List<List<String>> =
        (listOf(phrase) + variants)
            .map { TextNorm.tokens(it) }
            .filter { it.isNotEmpty() }
            .distinct()

    val isEmpty get() = forms.isEmpty()

    /** Перше входження, що починається не раніше за [from]. */
    fun find(tokens: List<String>, from: Int = 0): Match? {
        if (forms.isEmpty()) return null
        for (i in from.coerceAtLeast(0) until tokens.size) {
            for (form in forms) {
                matchAt(tokens, i, form)?.let { return it }
            }
        }
        return null
    }

    fun containsIn(tokens: List<String>) = find(tokens) != null

    private fun matchAt(tokens: List<String>, i: Int, form: List<String>): Match? {
        val n = form.size
        // 1) Звичайний випадок: стільки ж слів, скільки у фразі.
        if (i + n <= tokens.size) {
            var exact = true
            var ok = true
            for (k in 0 until n) {
                val t = tokens[i + k]
                if (t == form[k]) continue
                exact = false
                if (!close(t, form[k])) { ok = false; break }
            }
            if (ok) return Match(i, i + n, exact)
        }
        val joined = form.joinToString("")
        // 2) Модель розбила слово на два: «джар віс».
        if (i + n + 1 <= tokens.size) {
            val merged = tokens.subList(i, i + n + 1).joinToString("")
            if (merged == joined || close(merged, joined)) return Match(i, i + n + 1, false)
        }
        // 3) Фраза з кількох слів почулась як одне слово.
        if (n > 1 && close(tokens[i], joined)) return Match(i, i + 1, false)
        return null
    }

    private fun close(a: String, b: String): Boolean {
        val allowed = typos(b.length)
        if (allowed == 0) return a == b
        if (kotlin.math.abs(a.length - b.length) > allowed) return false
        return TextNorm.levenshtein(a, b) <= allowed
    }

    companion object {
        /** Скільки помилок дозволено для слова заданої довжини. */
        fun defaultTypos(len: Int) = when {
            len <= 3 -> 0
            len <= 5 -> 1
            else -> 2
        }

        /** Суворіший режим для службових слів («виконуй», «скасуй»). */
        fun strictTypos(len: Int) = when {
            len <= 4 -> 0
            else -> 1
        }

        fun splitVariants(raw: String): List<String> =
            raw.split(',', ';', '\n').map { it.trim() }.filter { it.isNotEmpty() }
    }
}
