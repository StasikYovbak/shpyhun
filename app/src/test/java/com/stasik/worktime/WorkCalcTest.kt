package com.stasik.worktime

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime

/**
 * Перевірка обліку годин. Тиждень 07.09.2026 (Пн) – 13.09.2026 (Нд).
 * Норма за замовчуванням: Пн–Пт 8 год, Сб 6 год, Нд 0.
 */
class WorkCalcTest {

    private val settings = Settings()

    private val monday = LocalDate.of(2026, 9, 7)
    private val friday = LocalDate.of(2026, 9, 11)
    private val saturday = LocalDate.of(2026, 9, 12)
    private val sunday = LocalDate.of(2026, 9, 13)

    private fun day(date: LocalDate, start: String?, end: String?, status: DayStatus = DayStatus.WORK) =
        WorkDay(date.toString(), start, end, status)

    private fun dataOf(vararg days: WorkDay) =
        AppData(days = days.associateBy { it.date }, settings = settings)

    // --- Дні тижня в тестових датах справді такі, як очікується ---

    @Test
    fun testDatesHaveExpectedWeekdays() {
        assertEquals(DayOfWeek.MONDAY, monday.dayOfWeek)
        assertEquals(DayOfWeek.FRIDAY, friday.dayOfWeek)
        assertEquals(DayOfWeek.SATURDAY, saturday.dayOfWeek)
        assertEquals(DayOfWeek.SUNDAY, sunday.dayOfWeek)
    }

    // --- ТЕСТ 1: Пн 08:00–17:00 -> 9.0 год, переробіток +1.0 ---

    @Test
    fun test1_mondayNineHours() {
        val d = day(monday, "08:00", "17:00")
        val r = WorkCalc.dayResult(monday, d, settings)

        assertEquals(540, r.workedMinutes)
        assertEquals("9.0", TimeFormat.decimal(r.workedMinutes))
        assertEquals("9 год 0 хв", TimeFormat.hoursMinutes(r.workedMinutes))
        assertEquals(480, r.normMinutes)
        assertEquals(60, r.diffMinutes)
        assertEquals("+1.0", TimeFormat.signedDecimal(r.diffMinutes))
        assertEquals("Переробіток", TimeFormat.diffTitle(r.diffMinutes))
    }

    // --- ТЕСТ 2: Сб 08:00–14:00 -> 6.0 год, переробіток 0 ---

    @Test
    fun test2_saturdaySixHours() {
        val d = day(saturday, "08:00", "14:00")
        val r = WorkCalc.dayResult(saturday, d, settings)

        assertEquals(360, r.workedMinutes)
        assertEquals("6.0", TimeFormat.decimal(r.workedMinutes))
        assertEquals(360, r.normMinutes)
        assertEquals(0, r.diffMinutes)
        assertEquals("0.0", TimeFormat.signedDecimal(r.diffMinutes))
        assertEquals("Рівно за нормою", TimeFormat.diffTitle(r.diffMinutes))
    }

    // --- ТЕСТ 3: Нд 09:00–13:00 -> 4.0 год, норма 0, переробіток +4.0 ---

    @Test
    fun test3_sundayAllOvertime() {
        val d = day(sunday, "09:00", "13:00")
        val r = WorkCalc.dayResult(sunday, d, settings)

        assertEquals(240, r.workedMinutes)
        assertEquals("4.0", TimeFormat.decimal(r.workedMinutes))
        assertEquals(0, r.normMinutes)
        assertEquals(240, r.diffMinutes)
        assertEquals("+4.0", TimeFormat.signedDecimal(r.diffMinutes))
    }

    // --- ТЕСТ 4: Пт 23:00 -> Сб 07:00 = 8.0 год, зараховані п'ятниці ---

    @Test
    fun test4_nightShiftCountedOnStartDay() {
        val d = day(friday, "23:00", "07:00")
        val period = WorkCalc.period(friday, saturday, dataOf(d))

        assertEquals(480, WorkCalc.workedMinutes(d))
        assertEquals("8.0", TimeFormat.decimal(WorkCalc.workedMinutes(d)!!))

        val fridayResult = period.items.first { it.date == friday }
        val saturdayResult = period.items.first { it.date == saturday }

        assertEquals(480, fridayResult.workedMinutes)   // 8 год записані на п'ятницю
        assertEquals(0, saturdayResult.workedMinutes)   // субота лишається порожньою
        assertEquals(0, fridayResult.diffMinutes)       // норма п'ятниці 8 год
    }

    // --- ТЕСТ 5: Тиждень Пн–Пт по 9 год + Сб 6 -> норма 46, факт 51, переробіток +5 ---

    @Test
    fun test5_fullWeek() {
        val days = ArrayList<WorkDay>()
        var d = monday
        while (d <= friday) {
            days.add(day(d, "08:00", "17:00"))   // 9 год
            d = d.plusDays(1)
        }
        days.add(day(saturday, "08:00", "14:00")) // 6 год

        val period = WorkCalc.period(monday, sunday, dataOf(*days.toTypedArray()))

        assertEquals(51 * 60, period.workedMinutes)
        assertEquals(46 * 60, period.normMinutes)
        assertEquals(5 * 60, period.diffMinutes)
        assertEquals("51.0", TimeFormat.decimal(period.workedMinutes))
        assertEquals("46.0", TimeFormat.decimal(period.normMinutes))
        assertEquals("+5.0", TimeFormat.signedDecimal(period.diffMinutes))
        assertEquals("+5 год 0 хв", TimeFormat.signedHoursMinutes(period.diffMinutes))
    }

    // --- Нічна зміна 22:00 -> 06:00 = 8 год, а не мінус 16 ---

    @Test
    fun testNightShift22to06() {
        assertEquals(480, WorkCalc.workedMinutes(day(monday, "22:00", "06:00")))
        assertEquals(480, WorkCalc.workedMinutes(day(monday, "23:30", "07:30")))
        assertEquals(30, WorkCalc.workedMinutes(day(monday, "23:45", "00:15")))
    }

    // --- День лише з приходом не ламає підрахунок ---

    @Test
    fun testUnfinishedDay() {
        val d = day(monday, "08:00", null)
        val r = WorkCalc.dayResult(monday, d, settings)

        assertTrue(r.unfinished)
        assertEquals(0, r.workedMinutes)      // нічого не додаємо
        assertEquals(480, r.normMinutes)      // норма лишається
        assertEquals(-480, r.diffMinutes)

        val period = WorkCalc.period(monday, monday.plusDays(1), dataOf(d))
        assertEquals(1, period.unfinishedCount)
        assertEquals(0, period.workedMinutes)
    }

    // --- Відпустка / лікарняний / святковий: норма 0, це не недоробіток ---

    @Test
    fun testNonWorkingStatusesHaveZeroNorm() {
        for (status in listOf(DayStatus.VACATION, DayStatus.SICK, DayStatus.HOLIDAY)) {
            val r = WorkCalc.dayResult(monday, day(monday, null, null, status), settings)
            assertEquals("Норма для $status", 0, r.normMinutes)
            assertEquals(0, r.diffMinutes)
            assertFalse(r.unfinished)
        }
        // робота у відпустці все одно йде в переробіток
        val worked = WorkCalc.dayResult(monday, day(monday, "10:00", "14:00", DayStatus.VACATION), settings)
        assertEquals(240, worked.workedMinutes)
        assertEquals(0, worked.normMinutes)
        assertEquals(240, worked.diffMinutes)
    }

    // --- Тиждень з відпусткою: норма зменшується, недоробітку немає ---

    @Test
    fun testWeekWithVacation() {
        val days = listOf(
            day(monday, "08:00", "17:00"),                              // 9 год
            day(monday.plusDays(1), null, null, DayStatus.VACATION),    // норма 0
            day(monday.plusDays(2), "08:00", "16:00")                   // 8 год
        )
        val period = WorkCalc.period(monday, monday.plusDays(2), dataOf(*days.toTypedArray()))

        assertEquals(17 * 60, period.workedMinutes)
        assertEquals(16 * 60, period.normMinutes)   // 8 + 0 + 8
        assertEquals(60, period.diffMinutes)
    }

    // --- Норма всього тижня проти норми днів, що вже минули ---

    @Test
    fun testWeekNormFullVsToDate() {
        val week = WorkCalc.period(monday, sunday, dataOf())

        // норма всього тижня: Пн–Пт по 8 + Сб 6 + Нд 0
        assertEquals(46 * 60, week.normMinutes)
        assertEquals("46.0", TimeFormat.decimal(week.normMinutes))

        // станом на середу минуло лише Пн, Вт, Ср -> 24 год
        val wednesday = monday.plusDays(2)
        val toWednesday = week.upTo(wednesday)
        assertEquals(3, toWednesday.items.size)
        assertEquals(24 * 60, toWednesday.normMinutes)
        assertTrue(week.hasFutureDays(wednesday))

        // у неділю тиждень закінчився — обидва числа збігаються
        val toSunday = week.upTo(sunday)
        assertEquals(46 * 60, toSunday.normMinutes)
        assertFalse(week.hasFutureDays(sunday))
        assertEquals(7, toSunday.items.size)

        // дата після кінця періоду нічого не змінює
        assertEquals(46 * 60, week.upTo(sunday.plusDays(5)).normMinutes)
        // дата до початку періоду -> нічого ще не минуло
        assertEquals(0, week.upTo(monday.minusDays(1)).normMinutes)
    }

    @Test
    fun testBalanceIsCountedAgainstElapsedDays() {
        // Пн і Вт по 9 год, середа ще попереду
        val days = listOf(
            day(monday, "08:00", "17:00"),
            day(monday.plusDays(1), "08:00", "17:00")
        )
        val week = WorkCalc.period(monday, sunday, dataOf(*days.toTypedArray()))
        val toTuesday = week.upTo(monday.plusDays(1))

        assertEquals(18 * 60, toTuesday.workedMinutes)
        assertEquals(16 * 60, toTuesday.normMinutes)
        assertEquals(2 * 60, toTuesday.diffMinutes)          // +2 год, а не -28
        assertEquals("Переробіток", TimeFormat.diffTitle(toTuesday.diffMinutes))

        // проти норми всього тижня це виглядало б як великий мінус
        assertEquals(-28 * 60, week.diffMinutes)
        assertEquals(46 * 60, week.normMinutes)
    }

    // --- Довільний період через межу місяця ---

    @Test
    fun testPeriodAcrossMonthBoundary() {
        val from = LocalDate.of(2026, 8, 28)   // п'ятниця
        val to = LocalDate.of(2026, 9, 3)      // четвер
        val days = listOf(
            day(LocalDate.of(2026, 8, 28), "08:00", "17:00"),  // Пт 9 год
            day(LocalDate.of(2026, 8, 29), "09:00", "15:00"),  // Сб 6 год
            day(LocalDate.of(2026, 9, 1), "08:00", "17:00"),   // Вт 9 год
            day(LocalDate.of(2026, 9, 2), "08:00", "17:00")    // Ср 9 год
        )
        val period = WorkCalc.period(from, to, dataOf(*days.toTypedArray()))

        assertEquals(7, period.items.size)                       // 28,29,30,31,1,2,3
        assertEquals(DayOfWeek.SUNDAY, LocalDate.of(2026, 8, 30).dayOfWeek)
        assertEquals(33 * 60, period.workedMinutes)              // 9+6+9+9
        // норма: Пт 8 + Сб 6 + Нд 0 + Пн 8 + Вт 8 + Ср 8 + Чт 8 = 46
        assertEquals(46 * 60, period.normMinutes)
        assertEquals(-13 * 60, period.diffMinutes)
        assertEquals("Недоробіток", TimeFormat.diffTitle(period.diffMinutes))
        assertEquals("-13.0", TimeFormat.signedDecimal(period.diffMinutes))
    }

    // --- Перевернутий період не ламається ---

    @Test
    fun testReversedPeriodIsNormalized() {
        val period = WorkCalc.period(sunday, monday, dataOf())
        assertEquals(monday, period.from)
        assertEquals(sunday, period.to)
        assertEquals(7, period.items.size)
    }

    // --- Початок тижня / місяця ---

    @Test
    fun testWeekAndMonthStart() {
        assertEquals(monday, WorkCalc.weekStart(sunday))
        assertEquals(monday, WorkCalc.weekStart(monday))
        assertEquals(monday, WorkCalc.weekStart(friday))
        assertEquals(LocalDate.of(2026, 9, 1), WorkCalc.monthStart(sunday))
    }

    // --- Форматування ---

    @Test
    fun testFormatting() {
        assertEquals("8 год 30 хв", TimeFormat.hoursMinutes(510))
        assertEquals("8.5", TimeFormat.decimal(510))
        assertEquals("0 год 0 хв", TimeFormat.hoursMinutes(0))
        assertEquals("0.0", TimeFormat.decimal(0))
        assertEquals("-1 год 30 хв", TimeFormat.hoursMinutes(-90))
        assertEquals("-1.5", TimeFormat.decimal(-90))
        assertEquals("8.33", TimeFormat.decimal(500))
        assertEquals("8 год 20 хв", TimeFormat.hoursMinutes(500))
        assertEquals("8 год 30 хв (8.5)", TimeFormat.full(510))
        assertEquals("+2 год 0 хв (+2.0)", TimeFormat.signedFull(120))
        assertEquals("08:00", TimeFormat.time(LocalTime.of(8, 0)))
        assertEquals("23:05", TimeFormat.time(LocalTime.of(23, 5)))
        assertEquals("--:--", TimeFormat.time(null))
    }

    // --- Налаштування норми ---

    @Test
    fun testCustomNorm() {
        val custom = Settings().withNorm(DayOfWeek.SATURDAY, 0).withNorm(DayOfWeek.MONDAY, 420)
        assertEquals(0, custom.normFor(DayOfWeek.SATURDAY))
        assertEquals(420, custom.normFor(DayOfWeek.MONDAY))
        assertEquals(480, custom.normFor(DayOfWeek.TUESDAY))

        val data = AppData(
            days = mapOf(saturday.toString() to day(saturday, "08:00", "14:00")),
            settings = custom
        )
        val r = WorkCalc.period(saturday, saturday, data)
        assertEquals(360, r.workedMinutes)
        assertEquals(0, r.normMinutes)
        assertEquals(360, r.diffMinutes)
    }

    // --- Планування нагадувань: неділя пропускається ---

    @Test
    fun testNextReminderSkipsSunday() {
        val time = LocalTime.of(8, 0)

        // субота 10:00 -> наступне спрацювання понеділок (неділю пропускаємо)
        val fromSaturday = WorkCalc.nextReminder(LocalDateTime.of(saturday, LocalTime.of(10, 0)), time)
        assertEquals(LocalDateTime.of(monday.plusDays(7), time), fromSaturday)
        assertEquals(DayOfWeek.MONDAY, fromSaturday.dayOfWeek)

        // понеділок 07:00 -> сьогодні о 08:00
        assertEquals(
            LocalDateTime.of(monday, time),
            WorkCalc.nextReminder(LocalDateTime.of(monday, LocalTime.of(7, 0)), time)
        )

        // понеділок 09:00 -> завтра о 08:00
        assertEquals(
            LocalDateTime.of(monday.plusDays(1), time),
            WorkCalc.nextReminder(LocalDateTime.of(monday, LocalTime.of(9, 0)), time)
        )

        // рівно о 08:00 -> вже не сьогодні, наступний день
        assertEquals(
            LocalDateTime.of(monday.plusDays(1), time),
            WorkCalc.nextReminder(LocalDateTime.of(monday, time), time)
        )

        // неділя -> понеділок
        assertEquals(
            LocalDateTime.of(monday.plusDays(7), time),
            WorkCalc.nextReminder(LocalDateTime.of(sunday, LocalTime.of(6, 0)), time)
        )
    }

    // --- Серіалізація в JSON і назад ---

    @Test
    fun testJsonRoundTrip() {
        val data = dataOf(day(monday, "08:00", "17:00"), day(sunday, "09:00", "13:00"))
        val text = Storage.encode(data)
        val restored = Storage.decode(text)

        assertEquals(data.days, restored.days)
        assertEquals(data.settings, restored.settings)
        assertTrue(text.contains("2026-09-07"))

        // пошкоджений файл не валить додаток
        assertEquals(AppData(), Storage.decode("{ це не json"))
        assertEquals(AppData(), Storage.decode(""))
    }
}
