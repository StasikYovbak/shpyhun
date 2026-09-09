package com.stasik.worktime

import kotlinx.serialization.Serializable
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.LocalTime

/** Статус дня. Для не-робочих статусів норма за день = 0. */
@Serializable
enum class DayStatus {
    WORK,      // Робочий
    VACATION,  // Відпустка
    SICK,      // Лікарняний
    HOLIDAY;   // Святковий

    /** true — якщо за цей день діє звичайна норма з графіка. */
    val countsNorm: Boolean get() = this == WORK

    val title: String
        get() = when (this) {
            WORK -> "Робочий"
            VACATION -> "Відпустка"
            SICK -> "Лікарняний"
            HOLIDAY -> "Святковий"
        }
}

/**
 * Один день обліку.
 * Дати й час зберігаються як ISO-рядки (yyyy-MM-dd, HH:mm) — без будь-яких UTC-зсувів.
 */
@Serializable
data class WorkDay(
    val date: String,
    val start: String? = null,
    val end: String? = null,
    val status: DayStatus = DayStatus.WORK,
    /** Цього дня обіду не було — не віднімати його від зміни. */
    val noLunch: Boolean = false
) {
    val localDate: LocalDate get() = LocalDate.parse(date)
    val startTime: LocalTime? get() = start?.let { LocalTime.parse(it) }
    val endTime: LocalTime? get() = end?.let { LocalTime.parse(it) }

    /** День порожній — його можна не зберігати. */
    val isEmpty: Boolean
        get() = start == null && end == null && status == DayStatus.WORK && !noLunch
}

/** Налаштування додатка. Норма зберігається у хвилинах для кожного дня тижня. */
@Serializable
data class Settings(
    // Індекси: 0 = понеділок ... 6 = неділя
    val normMinutes: List<Int> = DEFAULT_NORM,
    /** Автоматично віднімати обід від відпрацьованого часу. */
    val lunchEnabled: Boolean = true,
    val lunchMinutes: Int = 60,
    /** Обід віднімається лише від змін, не коротших за це. */
    val lunchMinShiftMinutes: Int = 360,
    val morningEnabled: Boolean = true,
    val morningTime: String = "08:00",
    val eveningEnabled: Boolean = true,
    val eveningTime: String = "17:00",
    val permissionAsked: Boolean = false
) {
    fun normFor(dayOfWeek: DayOfWeek): Int =
        normMinutes.getOrElse(dayOfWeek.value - 1) { DEFAULT_NORM[dayOfWeek.value - 1] }

    fun withNorm(dayOfWeek: DayOfWeek, minutes: Int): Settings {
        val list = normMinutes.toMutableList()
        while (list.size < 7) list.add(0)
        list[dayOfWeek.value - 1] = minutes.coerceIn(0, 24 * 60)
        return copy(normMinutes = list)
    }

    val morningLocalTime: LocalTime get() = parseTimeOr(morningTime, LocalTime.of(8, 0))
    val eveningLocalTime: LocalTime get() = parseTimeOr(eveningTime, LocalTime.of(17, 0))

    companion object {
        // Пн–Пт по 8 год, Сб 6 год, Нд 0
        val DEFAULT_NORM = listOf(480, 480, 480, 480, 480, 360, 0)

        private fun parseTimeOr(value: String, fallback: LocalTime): LocalTime =
            try { LocalTime.parse(value) } catch (e: Exception) { fallback }
    }
}

/** Усі дані додатка — саме цей об'єкт лежить у JSON-файлі. */
@Serializable
data class AppData(
    val days: Map<String, WorkDay> = emptyMap(),
    val settings: Settings = Settings()
) {
    fun day(date: LocalDate): WorkDay? = days[date.toString()]

    fun withDay(day: WorkDay): AppData {
        val map = days.toMutableMap()
        if (day.isEmpty) map.remove(day.date) else map[day.date] = day
        return copy(days = map)
    }

    fun withoutDay(date: LocalDate): AppData = copy(days = days - date.toString())
}
