package com.stasik.worktime

import java.time.DayOfWeek
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.util.Locale
import kotlin.math.abs

/** Підсумок за один день. */
data class DayResult(
    val date: LocalDate,
    val day: WorkDay?,
    /** Час від приходу до виходу, ще без вирахування обіду. */
    val rawWorkedMinutes: Int,
    /** Скільки хвилин обіду відняли від цієї зміни. */
    val lunchMinutes: Int,
    val normMinutes: Int,
    val unfinished: Boolean
) {
    /** Чистий відпрацьований час: зміна мінус обід. */
    val workedMinutes: Int get() = rawWorkedMinutes - lunchMinutes
    val diffMinutes: Int get() = workedMinutes - normMinutes
    val status: DayStatus get() = day?.status ?: DayStatus.WORK
    val hasRecord: Boolean get() = day != null
    val hasLunch: Boolean get() = lunchMinutes > 0
}

/** Підсумок за період. */
data class PeriodResult(
    val from: LocalDate,
    val to: LocalDate,
    val items: List<DayResult>
) {
    val workedMinutes: Int get() = items.sumOf { it.workedMinutes }
    val rawWorkedMinutes: Int get() = items.sumOf { it.rawWorkedMinutes }
    val lunchMinutes: Int get() = items.sumOf { it.lunchMinutes }
    val normMinutes: Int get() = items.sumOf { it.normMinutes }
    val diffMinutes: Int get() = workedMinutes - normMinutes
    val unfinishedCount: Int get() = items.count { it.unfinished }

    /**
     * Частина періоду, що вже настала (включно з [date]).
     * Потрібна, щоб посеред тижня показувати баланс не проти норми всього
     * тижня, а проти норми днів, які вже минули.
     */
    fun upTo(date: LocalDate): PeriodResult =
        if (!date.isBefore(to)) this
        else PeriodResult(from, date, items.filter { !it.date.isAfter(date) })

    /** true — якщо в періоді є дні, які ще не настали. */
    fun hasFutureDays(today: LocalDate): Boolean = to.isAfter(today)
}

/**
 * Уся арифметика обліку. Жодних залежностей від Android — тільки java.time,
 * тому логіку можна покрити звичайними JVM-тестами.
 */
object WorkCalc {

    const val MINUTES_IN_DAY: Int = 24 * 60

    /**
     * Тривалість зміни у хвилинах (ще без обіду).
     * Нічна зміна: якщо час виходу <= часу приходу — вихід вважається наступною добою
     * (22:00 -> 06:00 = 8 год, а не мінус 16).
     * Повертає null, якщо день не заповнений повністю.
     */
    fun workedMinutes(day: WorkDay?): Int? {
        val start = day?.startTime ?: return null
        val end = day.endTime ?: return null
        var diff = end.toSecondOfDay() / 60 - start.toSecondOfDay() / 60
        if (diff < 0) diff += MINUTES_IN_DAY
        return diff
    }

    /** День, у якому є лише прихід або лише вихід. Підрахунок він не ламає. */
    fun isUnfinished(day: WorkDay?): Boolean {
        if (day == null) return false
        if (!day.status.countsNorm) return false
        return (day.start == null) != (day.end == null)
    }

    /** Норма за конкретну дату з урахуванням статусу дня. */
    fun normMinutes(date: LocalDate, day: WorkDay?, settings: Settings): Int {
        if (day != null && !day.status.countsNorm) return 0
        return settings.normFor(date.dayOfWeek)
    }

    /**
     * Скільки хвилин обіду віднімається від зміни.
     * Обід не віднімається якщо: вимкнений у налаштуваннях, для цього дня стоїть
     * "без обіду", або зміна коротша за мінімальну. Ніколи не заганяє день у мінус.
     */
    fun lunchMinutes(day: WorkDay?, rawWorkedMinutes: Int, settings: Settings): Int {
        if (day == null || day.noLunch) return 0
        if (!settings.lunchEnabled || settings.lunchMinutes <= 0) return 0
        if (rawWorkedMinutes <= 0) return 0
        if (rawWorkedMinutes < settings.lunchMinShiftMinutes) return 0
        return minOf(settings.lunchMinutes, rawWorkedMinutes)
    }

    /** Результат за один день. */
    fun dayResult(date: LocalDate, day: WorkDay?, settings: Settings): DayResult {
        val raw = workedMinutes(day) ?: 0
        return DayResult(
            date = date,
            day = day,
            rawWorkedMinutes = raw,
            lunchMinutes = lunchMinutes(day, raw, settings),
            normMinutes = normMinutes(date, day, settings),
            unfinished = isUnfinished(day)
        )
    }

    /**
     * Підсумок за період [from..to] включно. Працює і через межу місяця чи року.
     * Якщо межі переставлені місцями — вони міняються автоматично.
     */
    fun period(from: LocalDate, to: LocalDate, data: AppData): PeriodResult {
        val start = if (from.isAfter(to)) to else from
        val end = if (from.isAfter(to)) from else to
        val items = ArrayList<DayResult>()
        var cursor = start
        while (!cursor.isAfter(end)) {
            items.add(dayResult(cursor, data.day(cursor), data.settings))
            cursor = cursor.plusDays(1)
        }
        return PeriodResult(start, end, items)
    }

    /** Понеділок поточного тижня. */
    fun weekStart(date: LocalDate): LocalDate = date.minusDays((date.dayOfWeek.value - 1).toLong())

    /** Перше число поточного місяця. */
    fun monthStart(date: LocalDate): LocalDate = date.withDayOfMonth(1)

    /**
     * Наступне спрацювання нагадування.
     * У неділю нагадування не надсилаються, тому неділя пропускається.
     */
    fun nextReminder(now: LocalDateTime, time: LocalTime): LocalDateTime {
        var candidate = LocalDateTime.of(now.toLocalDate(), time)
        if (!candidate.isAfter(now)) candidate = candidate.plusDays(1)
        while (candidate.dayOfWeek == DayOfWeek.SUNDAY) candidate = candidate.plusDays(1)
        return candidate
    }
}

/** Форматування тривалості. */
object TimeFormat {

    /** 510 -> "8 год 30 хв", -90 -> "-1 год 30 хв". */
    fun hoursMinutes(minutes: Int): String {
        val sign = if (minutes < 0) "-" else ""
        val total = abs(minutes)
        return "$sign${total / 60} год ${total % 60} хв"
    }

    /** Те саме зі знаком "+" для додатних значень. */
    fun signedHoursMinutes(minutes: Int): String =
        if (minutes > 0) "+${hoursMinutes(minutes)}" else hoursMinutes(minutes)

    /** 510 -> "8.5", 540 -> "9.0", 500 -> "8.33". */
    fun decimal(minutes: Int): String {
        var text = String.format(Locale.US, "%.2f", minutes / 60.0)
        if (text.endsWith("0")) text = text.dropLast(1)
        return text
    }

    /** Те саме зі знаком "+" для додатних значень. */
    fun signedDecimal(minutes: Int): String =
        if (minutes > 0) "+${decimal(minutes)}" else decimal(minutes)

    /** "8 год 30 хв (8.5)" */
    fun full(minutes: Int): String = "${hoursMinutes(minutes)} (${decimal(minutes)})"

    /** "+8 год 30 хв (+8.5)" */
    fun signedFull(minutes: Int): String =
        "${signedHoursMinutes(minutes)} (${signedDecimal(minutes)})"

    /** Підпис різниці: "Переробіток" / "Недоробіток" / "Рівно за нормою". */
    fun diffTitle(minutes: Int): String = when {
        minutes > 0 -> "Переробіток"
        minutes < 0 -> "Недоробіток"
        else -> "Рівно за нормою"
    }

    fun time(time: LocalTime?): String =
        time?.let { String.format(Locale.US, "%02d:%02d", it.hour, it.minute) } ?: "--:--"
}
