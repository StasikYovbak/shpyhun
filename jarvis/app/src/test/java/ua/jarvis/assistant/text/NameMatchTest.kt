package ua.jarvis.assistant.text

import org.junit.Assert.assertTrue
import org.junit.Test

class NameMatchTest {

    private fun ok(spoken: String, name: String) =
        assertTrue("«$spoken» має збігтися з «$name»: ${NameMatch.score(spoken, name)}", NameMatch.score(spoken, name) >= NameMatch.CONTACT_THRESHOLD)

    private fun no(spoken: String, name: String) =
        assertTrue("«$spoken» НЕ має збігтися з «$name»: ${NameMatch.score(spoken, name)}", NameMatch.score(spoken, name) < NameMatch.CONTACT_THRESHOLD)

    @Test fun contactsInDativeCase() {
        ok("мамі", "Мама")
        ok("мамі", "Мама ❤️")
        ok("олегу петренку", "Олег Петренко")
        ok("олегу", "Олег Петренко")
        ok("ані", "Аня")
        ok("сашку", "Саша")
        ok("андрію", "Андрій")
        ok("олегу", "Oleg")
        ok("тато", "Тато")
    }

    @Test fun noFalseFriends() {
        no("мамі", "Максим")
        no("олегу", "Ольга")
        no("андрію", "Анна")
        no("тато", "Таня")
    }

    @Test fun appNames() {
        ok("телеграм", "Telegram")
        ok("калькулятор", "Калькулятор")
        ok("налаштування", "Налаштування")
        ok("спотіфай", "Spotify")
    }
}
