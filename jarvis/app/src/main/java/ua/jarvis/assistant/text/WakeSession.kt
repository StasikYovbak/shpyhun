package ua.jarvis.assistant.text

/**
 * Логіка «Джарвіс … Виконуй» без жодної прив'язки до Android — щоб її можна було
 * перевірити unit-тестами.
 *
 *  - почули слово активації → [Event.WakeDetected], далі слова накопичуються;
 *  - почули слово виконання → [Event.Execute] з текстом команди;
 *  - слово скасування в кінці фрази → [Event.Cancelled];
 *  - «Джарвіс» на початку нової фрази під час запису → запис починається заново.
 *
 * Тайм-аут (30 с) рахує сервіс: він викликає [reset], якщо «Виконуй» так і не прозвучало.
 */
class WakeSession(
    wakeWord: String,
    wakeVariants: List<String>,
    execWord: String,
    execVariants: List<String>,
    cancelWord: String,
    cancelVariants: List<String>,
) {
    sealed interface Event {
        /** Почали записувати команду (пора пискнути). */
        data object WakeDetected : Event

        /** Проміжний текст команди — для екрана. */
        data class CommandUpdated(val text: String) : Event

        /** Пора виконувати. */
        data class Execute(val command: String) : Event

        /** Користувач сказав «Скасуй». */
        data object Cancelled : Event

        /** Проміжний результат здався словом активації, але остаточний — ні. */
        data object FalseWake : Event
    }

    private val wake = PhraseMatcher(wakeWord, wakeVariants)
    private val exec = PhraseMatcher(execWord, execVariants, PhraseMatcher::strictTypos)
    private val cancel = PhraseMatcher(cancelWord, cancelVariants, PhraseMatcher::strictTypos)

    var recording = false
        private set

    private val buffer = mutableListOf<String>()
    private var wakeFromPartial = false

    fun reset() {
        recording = false
        wakeFromPartial = false
        buffer.clear()
    }

    /** Текст, накопичений на цей момент. */
    fun currentCommand(): String = buffer.joinToString(" ")

    /** Проміжний (ще не остаточний) результат розпізнавання. */
    fun onPartial(text: String): List<Event> {
        val tokens = TextNorm.tokens(text)
        if (tokens.isEmpty()) return emptyList()
        if (!recording) {
            val w = wake.find(tokens) ?: return emptyList()
            recording = true
            wakeFromPartial = true
            buffer.clear()
            return listOf(Event.WakeDetected, Event.CommandUpdated(tokens.drop(w.endExclusive).joinToString(" ")))
        }
        val tail = if (wakeFromPartial) {
            wake.find(tokens)?.let { tokens.drop(it.endExclusive) } ?: tokens
        } else {
            buffer + tokens
        }
        return listOf(Event.CommandUpdated(tail.joinToString(" ")))
    }

    /** Остаточний результат однієї фрази (Vosk видає його після короткої паузи). */
    fun onFinal(text: String): List<Event> {
        val tokens = TextNorm.tokens(text)
        val events = mutableListOf<Event>()
        if (tokens.isEmpty()) return events
        var i = 0

        if (recording && wakeFromPartial) {
            wakeFromPartial = false
            val w = wake.find(tokens)
            if (w == null) {
                reset()
                events += Event.FalseWake
                return events
            }
            i = w.endExclusive
        }

        while (i < tokens.size) {
            if (!recording) {
                val w = wake.find(tokens, i) ?: break
                recording = true
                buffer.clear()
                events += Event.WakeDetected
                i = w.endExclusive
                continue
            }
            val ex = acceptedExec(tokens, i)
            val ca = cancel.find(tokens, i)?.takeIf { it.last == tokens.lastIndex }
            // «Джарвіс» посеред речення — це частина команди, а на початку фрази — новий старт.
            val wk = wake.find(tokens, i)?.takeIf { it.start == 0 }

            val next = listOfNotNull(ex?.to(0), ca?.to(1), wk?.to(2)).minByOrNull { it.first.start }
            if (next == null) {
                buffer.addAll(tokens.subList(i, tokens.size))
                break
            }
            buffer.addAll(tokens.subList(i, next.first.start))
            i = next.first.endExclusive
            when (next.second) {
                0 -> {
                    val command = buffer.joinToString(" ")
                    reset()
                    events += Event.Execute(command)
                    return events
                }
                1 -> {
                    reset()
                    events += Event.Cancelled
                }
                else -> {
                    buffer.clear()
                    events += Event.WakeDetected
                }
            }
        }
        if (recording) events += Event.CommandUpdated(buffer.joinToString(" "))
        return events
    }

    /** Точне «виконуй» — будь-де; схоже слово («виконую») — лише в самому кінці фрази. */
    private fun acceptedExec(tokens: List<String>, from: Int): PhraseMatcher.Match? {
        var m = exec.find(tokens, from)
        while (m != null && !(m.exact || m.last == tokens.lastIndex)) {
            m = exec.find(tokens, m.start + 1)
        }
        return m
    }
}
