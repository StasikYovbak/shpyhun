package com.stasik.worktime

import java.time.LocalDate
import java.util.Locale

/** Українські назви днів і місяців — щоб інтерфейс був українською незалежно від мови системи. */
object UaDate {

    private val dayNames = listOf(
        "понеділок", "вівторок", "середа", "четвер", "п'ятниця", "субота", "неділя"
    )

    private val dayShortNames = listOf("Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд")

    private val monthsGenitive = listOf(
        "січня", "лютого", "березня", "квітня", "травня", "червня",
        "липня", "серпня", "вересня", "жовтня", "листопада", "грудня"
    )

    private val monthsNominative = listOf(
        "Січень", "Лютий", "Березень", "Квітень", "Травень", "Червень",
        "Липень", "Серпень", "Вересень", "Жовтень", "Листопад", "Грудень"
    )

    fun dayName(date: LocalDate): String = dayNames[date.dayOfWeek.value - 1]

    fun dayShort(date: LocalDate): String = dayShortNames[date.dayOfWeek.value - 1]

    fun monthName(date: LocalDate): String = monthsNominative[date.monthValue - 1]

    /** "9 вересня" */
    fun dayMonth(date: LocalDate): String = "${date.dayOfMonth} ${monthsGenitive[date.monthValue - 1]}"

    /** "9 вересня 2026" */
    fun dayMonthYear(date: LocalDate): String = "${dayMonth(date)} ${date.year}"

    /** "вівторок, 9 вересня" */
    fun weekdayDayMonth(date: LocalDate): String = "${dayName(date)}, ${dayMonth(date)}"

    /** "09.09.2026" */
    fun numeric(date: LocalDate): String =
        String.format(Locale.US, "%02d.%02d.%04d", date.dayOfMonth, date.monthValue, date.year)

    /** "Пн, 07.09" */
    fun shortWithWeekday(date: LocalDate): String =
        String.format(Locale.US, "%s, %02d.%02d", dayShort(date), date.dayOfMonth, date.monthValue)
}
