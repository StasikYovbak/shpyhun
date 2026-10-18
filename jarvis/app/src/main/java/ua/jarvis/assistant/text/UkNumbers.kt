package ua.jarvis.assistant.text

/**
 * Числа, час і тривалість, сказані українською словами.
 *
 * Vosk повертає «сім тридцять», а не «7:30», тому будильник, таймер і гучність
 * потребують власного розбору: «на сьому тридцять», «пів на восьму»,
 * «на півтори години», «п'ятдесят відсотків».
 * Усі слова тут уже нормалізовані (без апострофів), як після [TextNorm.tokens].
 */
object UkNumbers {

    data class Num(val value: Int, val consumed: Int)

    private val units = HashMap<String, Int>()
    private val tens = HashMap<String, Int>()
    private val hundreds = HashMap<String, Int>()

    private fun put(map: HashMap<String, Int>, value: Int, vararg forms: String) {
        for (f in forms) map[f] = value
    }

    /** Порядкові числівники жіночого/чоловічого роду в усіх ходових відмінках. */
    private fun ordinal(map: HashMap<String, Int>, value: Int, stem: String, soft: Boolean = false) {
        val endings = if (soft) listOf("я", "ю", "ій", "ьої", "ього", "ьому", "ім", "є")
        else listOf("а", "у", "ій", "ої", "ий", "ого", "ому", "им", "ім", "е", "ою")
        for (e in endings) map.putIfAbsent(stem + e, value)
    }

    init {
        put(units, 0, "нуль", "ноль", "нулю", "нуля")
        put(units, 1, "один", "одна", "одну", "одне", "одного", "одній", "однієї", "одним", "одної")
        put(units, 2, "два", "дві", "двох", "двом")
        put(units, 3, "три", "трьох", "трьом")
        put(units, 4, "чотири", "чотирьох", "чотирьом")
        put(units, 5, "пять", "пяти", "пятьох", "пятьом")
        put(units, 6, "шість", "шести", "шістьох")
        put(units, 7, "сім", "семи", "сімох")
        put(units, 8, "вісім", "восьми", "вісьмох")
        put(units, 9, "девять", "девяти", "девятьох")
        put(units, 10, "десять", "десяти", "десятьох")
        val teens = listOf(
            "одинадцят", "дванадцят", "тринадцят", "чотирнадцят", "пятнадцят",
            "шістнадцят", "сімнадцят", "вісімнадцят", "девятнадцят",
        )
        teens.forEachIndexed { idx, stem ->
            put(units, 11 + idx, stem + "ь", stem + "и", stem + "ьох")
            ordinal(units, 11 + idx, stem)
        }
        ordinal(units, 0, "нульов")
        ordinal(units, 1, "перш")
        ordinal(units, 2, "друг")
        ordinal(units, 3, "трет", soft = true)
        ordinal(units, 4, "четверт")
        ordinal(units, 5, "пят")
        ordinal(units, 6, "шост")
        ordinal(units, 7, "сьом")
        ordinal(units, 8, "восьм")
        ordinal(units, 9, "девят")
        ordinal(units, 10, "десят")

        put(tens, 20, "двадцять", "двадцяти", "двадцятьох")
        ordinal(tens, 20, "двадцят")
        put(tens, 30, "тридцять", "тридцяти")
        ordinal(tens, 30, "тридцят")
        put(tens, 40, "сорок", "сорока")
        ordinal(tens, 40, "сороков")
        put(tens, 50, "пятдесят", "пятдесяти")
        ordinal(tens, 50, "пятдесят")
        put(tens, 60, "шістдесят", "шістдесяти")
        put(tens, 70, "сімдесят", "сімдесяти")
        put(tens, 80, "вісімдесят", "вісімдесяти")
        put(tens, 90, "девяносто", "девяноста")

        put(hundreds, 100, "сто", "ста", "сотня", "сотню")
        put(hundreds, 200, "двісті", "двохсот")
        put(hundreds, 300, "триста", "трьохсот")
        put(hundreds, 400, "чотириста", "чотирьохсот")
        put(hundreds, 500, "пятсот")
        put(hundreds, 600, "шістсот")
        put(hundreds, 700, "сімсот")
        put(hundreds, 800, "вісімсот")
        put(hundreds, 900, "девятсот")
    }

    fun isNumberWord(token: String) =
        token in units || token in tens || token in hundreds || token.all { it.isDigit() }

    /** Розбирає число, що починається з позиції [start]: «сто двадцять пять» → 125. */
    fun parseAt(tokens: List<String>, start: Int): Num? {
        if (start !in tokens.indices) return null
        val first = tokens[start]
        if (first.isNotEmpty() && first.all { it.isDigit() }) {
            return first.toIntOrNull()?.let { Num(it, 1) }
        }
        var i = start
        var total = 0
        var any = false
        hundreds[tokens.getOrNull(i)]?.let { total += it; i++; any = true }
        tens[tokens.getOrNull(i)]?.let { total += it; i++; any = true }
        val u = units[tokens.getOrNull(i)]
        if (u != null && (!any || u in 1..9 || (total % 100 == 0 && u in 1..19))) {
            total += u; i++; any = true
        }
        return if (any) Num(total, i - start) else null
    }

    /** Перше число в списку слів, починаючи з [from]. Повертає значення та індекс початку. */
    fun findFirst(tokens: List<String>, from: Int = 0): Pair<Int, Num>? {
        for (i in from until tokens.size) {
            parseAt(tokens, i)?.let { return i to it }
        }
        return null
    }

    // ---------------------------------------------------------------- час

    data class Time(val hour: Int, val minute: Int)

    private val hourWords = setOf("година", "годину", "годині", "годин", "години", "годиною", "год")
    private val minuteWords = setOf("хвилин", "хвилина", "хвилину", "хвилини", "хв")
    private val skipBeforeTime = setOf("на", "о", "об", "в", "у", "рівно", "годину", "годині")

    /**
     * «на сьому тридцять», «на сім нуль пять», «о дев'ятій вечора», «пів на восьму»,
     * «без чверті вісім», «на двадцять другу сорок».
     */
    fun parseTime(tokens: List<String>): Time? {
        if (tokens.isEmpty()) return null
        var hour: Int? = null
        var minute = 0

        // «пів на восьму» = 7:30
        val piv = tokens.indexOf("пів")
        if (piv >= 0 && tokens.getOrNull(piv + 1) == "на") {
            parseAt(tokens, piv + 2)?.let { n -> hour = (n.value - 1 + 24) % 24; minute = 30 }
        }
        // «без чверті вісім», «за чверть восьма» = 7:45
        if (hour == null) {
            val q = tokens.indexOfFirst { it == "чверті" || it == "чверть" }
            if (q > 0 && (tokens[q - 1] == "без" || tokens[q - 1] == "за")) {
                parseAt(tokens, q + 1)?.let { n -> hour = (n.value - 1 + 24) % 24; minute = 45 }
            }
        }
        if (hour == null) {
            val (idx, h) = findFirst(tokens) ?: return null
            var value = h.value
            var next = idx + h.consumed
            // «7 30» або «730», якщо модель раптом видала цифри
            if (h.consumed == 1 && tokens[idx].all { it.isDigit() } && tokens[idx].length in 3..4 && value >= 100) {
                minute = value % 100; value /= 100
            } else {
                while (next < tokens.size && tokens[next] in hourWords) next++
                if (tokens.getOrNull(next) == "нуль" || tokens.getOrNull(next) == "ноль") {
                    // «сім нуль пять» = 7:05, «сім нуль нуль» = 7:00
                    val m = parseAt(tokens, next + 1)
                    minute = m?.value ?: 0
                    next += 1 + (m?.consumed ?: 0)
                } else {
                    parseAt(tokens, next)?.let { m ->
                        if (m.value in 0..59) { minute = m.value; next += m.consumed }
                    }
                }
                while (next < tokens.size && tokens[next] in minuteWords) next++
            }
            hour = value
        }
        var h = hour ?: return null
        val rest = tokens.toSet()
        when {
            "вечора" in rest || "дня" in rest || "пополудні" in rest || "вечері" in rest ->
                if (h in 1..11) h += 12
            "ночі" in rest -> if (h == 12) h = 0 else if (h in 9..11) h += 12
            "ранку" in rest || "зранку" in rest -> if (h == 12) h = 0
        }
        if (h == 24) h = 0
        if (h !in 0..23 || minute !in 0..59) return null
        return Time(h, minute)
    }

    // ---------------------------------------------------------- тривалість

    private fun unitSeconds(token: String): Int? = when {
        token.startsWith("годинник") -> null
        token.startsWith("годин") || token == "год" -> 3600
        token.startsWith("хвилин") || token == "хв" -> 60
        token.startsWith("секунд") || token == "сек" -> 1
        else -> null
    }

    /** «десять хвилин» → 600, «півгодини» → 1800, «годину двадцять хвилин» → 4800. */
    fun parseDurationSeconds(tokens: List<String>): Int? {
        var total = 0
        var found = false
        var pending: Double? = null
        var i = 0
        while (i < tokens.size) {
            val t = tokens[i]
            when {
                t == "півгодини" -> { total += 1800; found = true; pending = null }
                t == "півхвилини" -> { total += 30; found = true; pending = null }
                t == "пів" -> pending = 0.5
                t == "півтори" || t == "півтора" -> pending = 1.5
                unitSeconds(t) != null -> {
                    total += ((pending ?: 1.0) * unitSeconds(t)!!).toInt()
                    found = true
                    pending = null
                }
                else -> {
                    val n = parseAt(tokens, i)
                    if (n != null) {
                        pending = n.value.toDouble()
                        i += n.consumed
                        continue
                    }
                }
            }
            i++
        }
        // «таймер на десять» без одиниць — вважаємо хвилинами
        if (pending != null) { total += (pending * 60).toInt(); found = true }
        return if (found && total > 0) total else null
    }

    // ------------------------------------------------------------ відмінки

    /** Форма іменника після числа: 1 хвилину, 2 хвилини, 5 хвилин. */
    fun plural(n: Int, one: String, few: String, many: String): String {
        val n100 = n % 100
        val n10 = n % 10
        return when {
            n100 in 11..14 -> many
            n10 == 1 -> one
            n10 in 2..4 -> few
            else -> many
        }
    }

    fun percent(n: Int) = "$n ${plural(n, "відсоток", "відсотки", "відсотків")}"

    fun durationText(seconds: Int): String {
        val h = seconds / 3600
        val m = (seconds % 3600) / 60
        val s = seconds % 60
        val parts = mutableListOf<String>()
        if (h > 0) parts += "$h ${plural(h, "годину", "години", "годин")}"
        if (m > 0) parts += "$m ${plural(m, "хвилину", "хвилини", "хвилин")}"
        if (s > 0) parts += "$s ${plural(s, "секунду", "секунди", "секунд")}"
        return parts.joinToString(" ")
    }
}
