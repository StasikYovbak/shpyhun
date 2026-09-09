package com.stasik.worktime

import kotlinx.serialization.json.Json
import java.io.File

/**
 * Збереження даних у JSON-файлі. Жодних баз даних — один файл у внутрішній
 * пам'яті додатка (filesDir/worktime.json).
 */
object Storage {

    const val FILE_NAME = "worktime.json"

    private val json = Json {
        prettyPrint = true
        ignoreUnknownKeys = true
        encodeDefaults = true
    }

    fun encode(data: AppData): String = json.encodeToString(AppData.serializer(), data)

    /** Пошкоджений або порожній файл не валить додаток — повертаються дані за замовчуванням. */
    fun decode(text: String): AppData = try {
        if (text.isBlank()) AppData() else json.decodeFromString(AppData.serializer(), text)
    } catch (e: Exception) {
        AppData()
    }

    fun load(file: File): AppData = try {
        if (file.exists()) decode(file.readText(Charsets.UTF_8)) else AppData()
    } catch (e: Exception) {
        AppData()
    }

    /** Запис через тимчасовий файл, щоб не втратити дані при збої посеред запису. */
    fun save(file: File, data: AppData) {
        try {
            val tmp = File(file.parentFile, "$FILE_NAME.tmp")
            tmp.writeText(encode(data), Charsets.UTF_8)
            if (file.exists()) file.delete()
            if (!tmp.renameTo(file)) {
                file.writeText(encode(data), Charsets.UTF_8)
                tmp.delete()
            }
        } catch (e: Exception) {
            // Дані лишаються в пам'яті — падати через помилку запису немає сенсу.
        }
    }
}
