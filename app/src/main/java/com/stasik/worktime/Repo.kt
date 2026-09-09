package com.stasik.worktime

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import java.io.File
import java.time.LocalDate
import java.time.LocalTime

/**
 * Єдине сховище стану додатка. Читає/пише JSON-файл і тримає дані у Compose-стані,
 * тому будь-яка зміна одразу перемальовує екран.
 */
object Repo {

    private var file: File? = null

    var data: AppData by mutableStateOf(AppData())
        private set

    val settings: Settings get() = data.settings

    /** Безпечно викликати скільки завгодно разів — ініціалізація відбудеться один раз. */
    fun init(context: Context) {
        if (file != null) return
        val f = File(context.applicationContext.filesDir, Storage.FILE_NAME)
        file = f
        data = Storage.load(f)
    }

    private fun update(block: (AppData) -> AppData) {
        val updated = block(data)
        data = updated
        file?.let { Storage.save(it, updated) }
    }

    fun day(date: LocalDate): WorkDay? = data.day(date)

    fun saveDay(day: WorkDay) = update { it.withDay(day) }

    fun deleteDay(date: LocalDate) = update { it.withoutDay(date) }

    /** Записує прихід. Якщо запису на цю дату ще немає — створює. */
    fun setStart(date: LocalDate, time: LocalTime?) = update {
        val current = it.day(date) ?: WorkDay(date.toString())
        it.withDay(current.copy(start = time?.let { t -> TimeFormat.time(t) }))
    }

    /** Записує вихід. */
    fun setEnd(date: LocalDate, time: LocalTime?) = update {
        val current = it.day(date) ?: WorkDay(date.toString())
        it.withDay(current.copy(end = time?.let { t -> TimeFormat.time(t) }))
    }

    fun setStatus(date: LocalDate, status: DayStatus) = update {
        val current = it.day(date) ?: WorkDay(date.toString())
        it.withDay(current.copy(status = status))
    }

    fun updateSettings(block: (Settings) -> Settings) = update {
        it.copy(settings = block(it.settings))
    }
}
