package ua.jarvis.assistant.core

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

enum class Status(val title: String) {
    OFF("Вимкнено"),
    LOADING("Завантаження"),
    LISTENING("Слухаю"),
    RECORDING("Записую команду"),
    CONFIRMING("Чекаю: так чи ні?"),
    EXECUTING("Виконую"),
    ERROR("Помилка"),
}

/**
 * Спільний стан між фоновим сервісом і екраном. Сервіс пише, екран підписується.
 * Обидва живуть в одному процесі, тож звичайного синглтона достатньо.
 */
object JarvisState {
    private val _status = MutableStateFlow(Status.OFF)
    val status: StateFlow<Status> = _status.asStateFlow()

    /** Уточнення до статусу: «Модель: 45%», «Немає дозволу на мікрофон». */
    val detail = MutableStateFlow("")

    /** Що мікрофон чує прямо зараз. */
    val heard = MutableStateFlow("")

    /** Команда, що накопичується після слова активації. */
    val command = MutableStateFlow("")

    /** Остання виконана команда. */
    val lastCommand = MutableStateFlow("")

    /** Попередження для екрана (наприклад, слова активації немає у словнику моделі). */
    val warning = MutableStateFlow("")

    fun set(status: Status, detail: String = "") {
        _status.value = status
        this.detail.value = detail
    }
}
