package ua.jarvis.assistant.text

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import ua.jarvis.assistant.text.WakeSession.Event

class WakeSessionTest {

    private fun session() = WakeSession("Джарвіс", emptyList(), "Виконуй", emptyList(), "Скасуй", listOf("відміна"))

    private fun List<Event>.executed() = filterIsInstance<Event.Execute>().map { it.command }

    @Test fun wholeCommandInOnePhrase() {
        val s = session()
        val ev = s.onFinal("джарвіс увімкни ліхтарик виконуй")
        assertTrue(ev.first() is Event.WakeDetected)
        assertEquals(listOf("увімкни ліхтарик"), ev.executed())
        assertFalse(s.recording)
    }

    @Test fun commandAcrossSeveralPhrases() {
        val s = session()
        assertTrue(s.onFinal("джарвіс").contains(Event.WakeDetected))
        assertTrue(s.recording)
        assertTrue(s.onFinal("увімкни пісню believer").executed().isEmpty())
        assertEquals(listOf("увімкни пісню believer через ютуб"), s.onFinal("через ютуб виконуй").executed())
    }

    @Test fun wakeFromPartialThenFinal() {
        val s = session()
        assertTrue(s.onPartial("джарвіс").contains(Event.WakeDetected))
        assertEquals(listOf("котра година"), s.onFinal("джарвіс котра година виконуй").executed())
    }

    @Test fun falseWakeFromPartial() {
        val s = session()
        s.onPartial("джарвіс")
        assertTrue(s.onFinal("дарма ми це").contains(Event.FalseWake))
        assertFalse(s.recording)
    }

    @Test fun ignoresSpeechWithoutWakeWord() {
        val s = session()
        assertTrue(s.onFinal("увімкни ліхтарик виконуй").isEmpty())
    }

    @Test fun cancelAtTheEnd() {
        val s = session()
        assertTrue(s.onFinal("джарвіс подзвони мамі скасуй").contains(Event.Cancelled))
        assertFalse(s.recording)
    }

    @Test fun cancelWordInsideCommandIsContent() {
        val s = session()
        assertEquals(listOf("скасуй будильник"), s.onFinal("джарвіс скасуй будильник виконуй").executed())
    }

    @Test fun fuzzyExecOnlyAtTheEnd() {
        val s = session()
        assertEquals(listOf("увімкни ліхтарик"), s.onFinal("джарвіс увімкни ліхтарик виконую").executed())
        val s2 = session()
        assertTrue(s2.onFinal("джарвіс я виконую обіцянку").executed().isEmpty())
        assertEquals(listOf("я виконую обіцянку"), s2.onFinal("виконуй").executed())
    }

    @Test fun splitWakeWordAndTypos() {
        assertTrue(session().onFinal("джар віс котра година виконуй").executed().isNotEmpty())
        assertTrue(session().onFinal("джарвис котра година виконуй").executed().isNotEmpty())
        assertTrue(session().onFinal("дарвіс котра година виконуй").executed().isNotEmpty())
    }

    @Test fun restartWithNewWakeWord() {
        val s = session()
        s.onFinal("джарвіс увімкни щось не те")
        assertEquals(listOf("котра година"), s.onFinal("джарвіс котра година виконуй").executed())
    }

    @Test fun wakeInsideSentenceIsContent() {
        val s = session()
        assertEquals(listOf("хто такий джарвіс"), s.onFinal("джарвіс хто такий джарвіс виконуй").executed())
    }

    @Test fun customWords() {
        val s = WakeSession("Привіт Джарвіс", emptyList(), "Поїхали", emptyList(), "Стоп", emptyList())
        assertEquals(listOf("котра година"), s.onFinal("привіт джарвіс котра година поїхали").executed())
    }
}
