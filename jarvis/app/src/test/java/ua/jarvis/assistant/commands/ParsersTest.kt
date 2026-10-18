package ua.jarvis.assistant.commands

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import ua.jarvis.assistant.text.TextNorm

class ParsersTest {

    private fun t(s: String) = TextNorm.tokens(s)

    @Test fun youtube() {
        assertTrue(Parsers.isYouTube(t("увімкни пісню believer через ютуб")))
        assertEquals("believer", Parsers.youTubeQuery(t("увімкни пісню believer через ютуб")))
        assertEquals("океан ельзи без бою", Parsers.youTubeQuery(t("увімкни на ютубі океан ельзи без бою")))
        assertTrue(Parsers.isYouTube(t("постав пісню щедрик")))
        assertEquals("щедрик", Parsers.youTubeQuery(t("постав пісню щедрик")))
        assertEquals("", Parsers.youTubeQuery(t("відкрий ютуб")))
        assertFalse(Parsers.isYouTube(t("постав будильник на сьому")))
    }

    @Test fun flashlight() {
        assertTrue(Parsers.isFlashlight(t("увімкни ліхтарик")))
        assertEquals(Parsers.Toggle.ON, Parsers.toggleOf(t("увімкни ліхтарик")))
        assertEquals(Parsers.Toggle.OFF, Parsers.toggleOf(t("вимкни ліхтарик")))
        assertEquals(Parsers.Toggle.TOGGLE, Parsers.toggleOf(t("ліхтарик")))
    }

    @Test fun volume() {
        assertEquals(Parsers.Volume.Set(50), Parsers.parseVolume(t("гучність на 50 відсотків")))
        assertEquals(Parsers.Volume.Set(50), Parsers.parseVolume(t("гучність на п'ятдесят відсотків")))
        assertEquals(Parsers.Volume.Set(100), Parsers.parseVolume(t("гучність на максимум")))
        assertEquals(Parsers.Volume.Delta(15), Parsers.parseVolume(t("зроби гучніше")))
        assertEquals(Parsers.Volume.Delta(-15), Parsers.parseVolume(t("зроби тихіше")))
        assertEquals(Parsers.Volume.Set(0), Parsers.parseVolume(t("вимкни звук")))
        assertNull(Parsers.parseVolume(t("увімкни ліхтарик")))
    }

    @Test fun infoQueries() {
        assertTrue(Parsers.isTimeQuery(t("котра година")))
        assertTrue(Parsers.isTimeQuery(t("скільки зараз часу")))
        assertTrue(Parsers.isBatteryQuery(t("який заряд батареї")))
        assertTrue(Parsers.isDateQuery(t("яке сьогодні число")))
        assertFalse(Parsers.isTimeQuery(t("увімкни ліхтарик")))
    }

    @Test fun alarmAndTimer() {
        assertTrue(Parsers.isAlarm(t("постав будильник на сьому тридцять")))
        assertEquals(listOf("на", "сьому", "тридцять"), Parsers.alarmTail(t("постав будильник на сьому тридцять")))
        assertTrue(Parsers.isTimer(t("постав таймер на десять хвилин")))
        assertEquals(t("на десять хвилин"), Parsers.timerTail(t("постав таймер на десять хвилин")))
    }

    @Test fun calls() {
        assertTrue(Parsers.isCall(t("подзвони мамі")))
        assertEquals("мамі", Parsers.callTarget(t("подзвони мамі")))
        assertEquals("олегу петренку", Parsers.callTarget(t("зателефонуй будь ласка олегу петренку")))
        assertEquals("0671234567", Parsers.phoneDigits("нуль шістдесят сім сто двадцять три сорок п'ять шістдесят сім".let { TextNorm.normalize(it) }))
        assertNull(Parsers.phoneDigits("мамі"))
    }

    @Test fun sms() {
        val a = t("напиши мамі повідомлення привіт як справи")
        assertTrue(Parsers.isSms(a))
        assertEquals(listOf(Parsers.SmsSplit("мамі", "привіт як справи")), Parsers.smsCandidates(a))

        val b = t("напиши повідомлення олегу я запізнюсь")
        assertEquals(Parsers.SmsSplit("олегу", "я запізнюсь"), Parsers.smsCandidates(b).first())

        val c = t("напиши мамі що я буду пізно")
        assertEquals(listOf(Parsers.SmsSplit("мамі", "я буду пізно")), Parsers.smsCandidates(c))

        assertFalse(Parsers.isSms(t("напиши мамі в телеграм привіт")))
    }

    @Test fun navigationSearchApps() {
        assertTrue(Parsers.isNavigation(t("прокладай маршрут до залізничного вокзалу")))
        assertEquals("залізничного вокзалу", Parsers.navigationTarget(t("прокладай маршрут до залізничного вокзалу")))
        assertTrue(Parsers.isWebSearch(t("знайди в гуглі рецепт борщу")))
        assertEquals("рецепт борщу", Parsers.webQuery(t("знайди в гуглі рецепт борщу")))
        assertTrue(Parsers.isOpenApp(t("відкрий телеграм")))
        assertEquals("телеграм", Parsers.appName(t("відкрий телеграм")))
        assertEquals("гугл карти", Parsers.appName(t("запусти програму гугл карти")))
    }

    @Test fun textNorm() {
        assertEquals(listOf("пять", "хвилин"), t("П'ять хвилин!"))
        assertEquals("мам", TextNorm.stem("мамі"))
        assertEquals("олег", TextNorm.stem("олегу"))
        assertTrue(TextNorm.nameSimilarity("телеграм", "Telegram") > 0.8)
        assertTrue(TextNorm.nameSimilarity("вайбер", "Viber") > 0.6)
    }
}
