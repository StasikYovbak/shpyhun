package ua.jarvis.assistant.commands

import ua.jarvis.assistant.text.UkNumbers

/**
 * Чистий (без Android) розбір шаблонних команд. Кожна функція отримує вже
 * нормалізовані слова — див. [ua.jarvis.assistant.text.TextNorm.tokens].
 */
object Parsers {

    fun List<String>.hasStem(vararg stems: String) = any { t -> stems.any { t.startsWith(it) } }

    fun List<String>.indexOfStem(vararg stems: String, from: Int = 0): Int {
        for (i in from until size) if (stems.any { this[i].startsWith(it) }) return i
        return -1
    }

    /** Слова ввічливості й «вата», яку викидаємо з параметрів. */
    val filler = setOf("будь", "ласка", "будьласка", "мені", "нам", "прошу", "ну", "а", "давай", "швиденько", "джарвіс")

    private fun clean(tokens: List<String>) = tokens.filter { it !in filler }

    // ------------------------------------------------------------------ YouTube

    private val ytStems = arrayOf("ютуб", "ютюб", "youtube", "ютубчик")
    private val playVerbs = arrayOf("увімкн", "включ", "вруб", "постав", "запуст", "відтвор", "грай", "заграй", "програй", "знайди", "покажи", "відкрий")
    private val songWords = arrayOf("пісн", "трек", "кліп", "композиц", "відео", "ролик")
    private val preps = setOf("через", "на", "в", "у", "з", "із", "по")

    fun isYouTube(tokens: List<String>): Boolean =
        tokens.hasStem(*ytStems) ||
            (tokens.hasStem(*songWords) && tokens.hasStem(*playVerbs) && !tokens.hasStem("будильник", "таймер"))

    /** «увімкни пісню believer через ютуб» → «believer». Порожньо = просто відкрити YouTube. */
    fun youTubeQuery(tokens: List<String>): String {
        val drop = BooleanArray(tokens.size)
        var verbDropped = false
        tokens.forEachIndexed { i, t ->
            when {
                ytStems.any { t.startsWith(it) } -> {
                    drop[i] = true
                    if (i > 0 && tokens[i - 1] in preps) drop[i - 1] = true
                }
                !verbDropped && i <= 1 && playVerbs.any { t.startsWith(it) } -> { drop[i] = true; verbDropped = true }
                songWords.any { t.startsWith(it) } -> drop[i] = true
                t in filler -> drop[i] = true
            }
        }
        return tokens.filterIndexed { i, _ -> !drop[i] }.joinToString(" ").trim()
    }

    // ------------------------------------------------------------------ ліхтарик

    enum class Toggle { ON, OFF, TOGGLE }

    fun isFlashlight(tokens: List<String>) = tokens.hasStem("ліхтар", "фонар", "спалах")

    fun toggleOf(tokens: List<String>): Toggle = when {
        tokens.hasStem("вимкн", "викл", "погас", "загас", "прибер") -> Toggle.OFF
        tokens.hasStem("увімкн", "включ", "вруб", "запал", "засвіт") -> Toggle.ON
        else -> Toggle.TOGGLE
    }

    // ------------------------------------------------------------------ гучність

    sealed interface Volume {
        data class Set(val percent: Int) : Volume
        data class Delta(val percent: Int) : Volume
    }

    fun parseVolume(tokens: List<String>): Volume? {
        val about = tokens.hasStem("гучн", "голосн", "тихіш", "тихо") ||
            (tokens.hasStem("звук") && !tokens.hasStem("будильник"))
        if (!about) return null
        UkNumbers.findFirst(tokens)?.let { (_, n) -> return Volume.Set(n.value.coerceIn(0, 100)) }
        return when {
            tokens.hasStem("максим", "повну", "всю") -> Volume.Set(100)
            tokens.hasStem("половин") -> Volume.Set(50)
            tokens.hasStem("мінім") -> Volume.Set(10)
            tokens.hasStem("гучніш", "голосніш", "голосно", "додай", "збільш", "підвищ") -> Volume.Delta(+15)
            tokens.hasStem("тихіш", "тихо", "зменш", "знизь", "убав", "менше") -> Volume.Delta(-15)
            tokens.hasStem("вимкн", "без", "беззвуч", "тиша") -> Volume.Set(0)
            tokens.hasStem("увімкн") -> Volume.Set(50)
            else -> null
        }
    }

    // ------------------------------------------------------------------ час / дата / батарея

    fun isTimeQuery(tokens: List<String>): Boolean {
        val set = tokens.toSet()
        return ("котра" in set && ("година" in set || "зараз" in set)) ||
            ("скільки" in set && ("часу" in set || "зараз" in set && "година" in set)) ||
            ("котрий" in set && "час" in set) ||
            (("який" in set || "яка" in set) && ("час" in set || "година" in set))
    }

    fun isDateQuery(tokens: List<String>): Boolean {
        val set = tokens.toSet()
        return "число" in set || "дата" in set || "дату" in set ||
            ("день" in set && ("сьогодні" in set || "тижня" in set)) ||
            ("місяць" in set && ("який" in set || "зараз" in set))
    }

    fun isBatteryQuery(tokens: List<String>) = tokens.hasStem("заряд", "батаре", "акумулятор") &&
        !tokens.hasStem("постав", "таймер", "будильник")

    // ------------------------------------------------------------------ будильник і таймер

    fun isAlarm(tokens: List<String>) = tokens.hasStem("будильник", "розбуди", "розбуд")

    /** Слова після «будильник» / «розбуди». */
    fun alarmTail(tokens: List<String>): List<String> {
        val i = tokens.indexOfStem("будильник", "розбуд")
        return if (i >= 0) tokens.drop(i + 1) else tokens
    }

    fun isTimer(tokens: List<String>) = tokens.hasStem("таймер", "засіч", "засік")

    fun timerTail(tokens: List<String>): List<String> {
        val i = tokens.indexOfStem("таймер", "засіч", "засік")
        return if (i >= 0) tokens.drop(i + 1) else tokens
    }

    // ------------------------------------------------------------------ дзвінки й SMS

    private val callStems = arrayOf("подзвон", "зателефон", "набери", "набрати", "передзвон", "дзвони", "телефонуй", "задзвон")

    fun isCall(tokens: List<String>) = tokens.take(3).hasStem(*callStems)

    /** Хто: «подзвони мамі» → «мамі» (відмінок прибере пошук контактів). */
    fun callTarget(tokens: List<String>): String {
        val i = tokens.indexOfStem(*callStems)
        return clean(tokens.drop(i + 1)).filter { it !in setOf("на", "номер", "до", "контакту", "контакт", "по") }
            .joinToString(" ")
    }

    /** Якщо замість імені продиктовано номер: «нуль шістдесят сім …» → «067…». */
    fun phoneDigits(target: String): String? {
        val tokens = target.split(' ').filter { it.isNotEmpty() }
        if (tokens.isEmpty()) return null
        val sb = StringBuilder()
        var i = 0
        while (i < tokens.size) {
            val t = tokens[i]
            if (t == "плюс") { sb.append('+'); i++; continue }
            val n = UkNumbers.parseAt(tokens, i) ?: return null
            sb.append(n.value)
            i += n.consumed
        }
        val digits = sb.count { it.isDigit() }
        return if (digits >= 3) sb.toString() else null
    }

    private val smsVerbs = arrayOf("напиши", "написати", "надішли", "надіслати", "відправ", "скинь", "кинь", "повідом")
    private val messengers = arrayOf("телеграм", "вайбер", "вотсап", "ватсап", "вацап", "сигнал", "інстаграм", "месенджер", "фейсбук", "дискорд", "слак")
    private val smsWords = arrayOf("повідомлен", "смс", "есемес", "смску", "смска", "sms", "месседж", "мессадж")

    fun isSms(tokens: List<String>): Boolean =
        tokens.take(3).hasStem(*smsVerbs) && !tokens.hasStem(*messengers) &&
            (tokens.hasStem(*smsWords) || "що" in tokens)

    data class SmsSplit(val name: String, val text: String)

    /** Можливі варіанти «кому / що». Правильний обирає пошук контактів за найкращим збігом. */
    fun smsCandidates(tokens: List<String>): List<SmsSplit> {
        val v = tokens.indexOfStem(*smsVerbs)
        val rest = clean(tokens.drop(v + 1))
        val kw = rest.indexOfStem(*smsWords)
        fun text(list: List<String>): String {
            var t = list
            while (t.isNotEmpty() && t.first() in setOf("що", "з", "текстом", "текст", "таке", ":")) t = t.drop(1)
            return t.joinToString(" ")
        }
        fun name(list: List<String>) = list.filter { it !in setOf("для", "до") }.joinToString(" ")

        if (kw > 0) {
            return listOf(SmsSplit(name(rest.take(kw)), text(rest.drop(kw + 1))))
        }
        val body = if (kw == 0) rest.drop(1) else rest
        val shto = body.indexOf("що")
        if (kw < 0 && shto > 0) {
            return listOf(SmsSplit(name(body.take(shto)), text(body.drop(shto + 1))))
        }
        return (1..minOf(3, body.size - 1)).map { k -> SmsSplit(name(body.take(k)), text(body.drop(k))) }
    }

    // ------------------------------------------------------------------ навігація, пошук, програми

    private val navStems = arrayOf("маршрут", "проклад", "навігац", "доїхат", "дійти", "дістатис", "веди", "поїхали", "прокласти", "дорогу")

    fun isNavigation(tokens: List<String>) = tokens.hasStem(*navStems)

    fun navigationTarget(tokens: List<String>): String {
        val trig = tokens.indexOfStem(*navStems)
        val after = tokens.drop(trig + 1)
        val prep = after.indexOfFirst { it in setOf("до", "на", "в", "у") }
        val dest = if (prep >= 0) after.drop(prep + 1) else after.filter { !it.startsWith("маршрут") }
        return clean(dest).filter { !it.startsWith("маршрут") }.joinToString(" ")
    }

    private val webStems = arrayOf("загугл", "погугл", "гугл", "google", "інтернет", "пошукай", "пошукати")

    fun isWebSearch(tokens: List<String>) = tokens.hasStem(*webStems)

    fun webQuery(tokens: List<String>): String {
        val drop = setOf("знайди", "знайти", "пошукай", "пошукати", "загугли", "погугли", "в", "у", "гуглі", "гугл", "google", "інтернеті", "інтернет", "мережі", "через")
        return clean(tokens).filter { it !in drop }.joinToString(" ")
    }

    private val openStems = arrayOf("відкрий", "відкрити", "запусти", "запустити", "відкрию", "відкривай")

    fun isOpenApp(tokens: List<String>) = tokens.take(2).hasStem(*openStems)

    fun appName(tokens: List<String>): String {
        val i = tokens.indexOfStem(*openStems)
        return clean(tokens.drop(i + 1))
            .filter { it !in setOf("програму", "додаток", "застосунок", "апку", "аплікацію") }
            .joinToString(" ")
    }
}
