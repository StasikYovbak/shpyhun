package ua.jarvis.assistant.text

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class UkNumbersTest {

    private fun t(s: String) = TextNorm.tokens(s)
    private fun time(s: String) = UkNumbers.parseTime(t(s))?.let { "%d:%02d".format(it.hour, it.minute) }
    private fun dur(s: String) = UkNumbers.parseDurationSeconds(t(s))

    @Test fun numbers() {
        assertEquals(50, UkNumbers.findFirst(t("гучність на п'ятдесят відсотків"))!!.second.value)
        assertEquals(50, UkNumbers.findFirst(t("гучність на пятдесят"))!!.second.value)
        assertEquals(125, UkNumbers.parseAt(t("сто двадцять пять"), 0)!!.value)
        assertEquals(21, UkNumbers.parseAt(t("двадцять одна"), 0)!!.value)
        assertEquals(105, UkNumbers.parseAt(t("сто пять"), 0)!!.value)
        assertEquals(15, UkNumbers.parseAt(t("пятнадцять"), 0)!!.value)
        assertEquals(30, UkNumbers.parseAt(t("30"), 0)!!.value)
    }

    @Test fun times() {
        assertEquals("7:30", time("на сьому тридцять"))
        assertEquals("7:30", time("на сім тридцять"))
        assertEquals("7:30", time("на 7 30"))
        assertEquals("7:30", time("пів на восьму"))
        assertEquals("7:45", time("без чверті вісім"))
        assertEquals("7:05", time("на сім нуль п'ять"))
        assertEquals("7:00", time("на сьому"))
        assertEquals("21:00", time("на дев'яту вечора"))
        assertEquals("21:15", time("о дев'ятій п'ятнадцять вечора"))
        assertEquals("22:40", time("на двадцять другу сорок"))
        assertEquals("6:20", time("на шосту годину двадцять хвилин ранку"))
        assertEquals("23:00", time("на одинадцяту ночі"))
        assertEquals("0:00", time("на дванадцяту ночі"))
        assertNull(time("на завтра"))
    }

    @Test fun durations() {
        assertEquals(600, dur("на десять хвилин"))
        assertEquals(1800, dur("на півгодини"))
        assertEquals(1800, dur("на пів години"))
        assertEquals(5400, dur("на півтори години"))
        assertEquals(3600, dur("на годину"))
        assertEquals(90, dur("на одну хвилину тридцять секунд"))
        assertEquals(7200, dur("на дві години"))
        assertEquals(300, dur("на п'ять"))
        assertEquals(45, dur("сорок п'ять секунд"))
        assertNull(dur("на годинник"))
    }

    @Test fun plurals() {
        assertEquals("1 відсоток", UkNumbers.percent(1))
        assertEquals("3 відсотки", UkNumbers.percent(3))
        assertEquals("11 відсотків", UkNumbers.percent(11))
        assertEquals("50 відсотків", UkNumbers.percent(50))
        assertEquals("1 годину 30 хвилин", UkNumbers.durationText(5400))
        assertEquals("21 хвилину", UkNumbers.durationText(21 * 60))
    }
}
