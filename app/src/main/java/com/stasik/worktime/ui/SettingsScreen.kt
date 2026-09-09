package com.stasik.worktime.ui

import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Card
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.stasik.worktime.Notifications
import com.stasik.worktime.ReminderScheduler
import com.stasik.worktime.Repo
import com.stasik.worktime.TimeFormat
import com.stasik.worktime.UaDate
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.LocalTime

@Composable
fun SettingsScreen() {
    val context = LocalContext.current
    val settings = Repo.settings

    var normPicker by remember { mutableStateOf<DayOfWeek?>(null) }
    var timePicker by remember { mutableStateOf<String?>(null) }

    val weekDays = listOf(
        DayOfWeek.MONDAY, DayOfWeek.TUESDAY, DayOfWeek.WEDNESDAY, DayOfWeek.THURSDAY,
        DayOfWeek.FRIDAY, DayOfWeek.SATURDAY, DayOfWeek.SUNDAY
    )
    // Будь-яка дата з потрібним днем тижня — лише щоб узяти українську назву
    val anyMonday = LocalDate.of(2024, 1, 1)

    LazyColumn(
        modifier = Modifier.fillMaxWidth(),
        contentPadding = PaddingValues(12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        // --- Норма годин ---
        item {
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    Text("Норма годин", style = MaterialTheme.typography.titleMedium)
                    Text(
                        text = "Скільки годин має бути відпрацьовано за кожен день тижня",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Spacer(Modifier.height(8.dp))

                    for (dow in weekDays) {
                        val minutes = settings.normFor(dow)
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable { normPicker = dow }
                                .padding(vertical = 10.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = UaDate.dayName(anyMonday.plusDays((dow.value - 1).toLong()))
                                    .replaceFirstChar { it.uppercase() },
                                style = MaterialTheme.typography.bodyLarge
                            )
                            Text(
                                text = "${TimeFormat.hoursMinutes(minutes)}  (${TimeFormat.decimal(minutes)})",
                                style = MaterialTheme.typography.bodyLarge,
                                fontWeight = FontWeight.Medium,
                                color = MaterialTheme.colorScheme.primary
                            )
                        }
                        HorizontalDivider()
                    }

                    Spacer(Modifier.height(8.dp))
                    TextButton(onClick = {
                        Repo.updateSettings { it.copy(normMinutes = com.stasik.worktime.Settings.DEFAULT_NORM) }
                    }) { Text("Повернути стандартну (8/8/8/8/8/6/0)") }
                }
            }
        }

        // --- Обід ---
        item {
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text("Обід", style = MaterialTheme.typography.titleMedium)
                            Text(
                                text = "Автоматично віднімати обід від зміни. " +
                                    "З 09:00 до 18:00 буде 8 год, а не 9.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                        Switch(
                            checked = settings.lunchEnabled,
                            onCheckedChange = { checked ->
                                Repo.updateSettings { it.copy(lunchEnabled = checked) }
                            }
                        )
                    }

                    if (settings.lunchEnabled) {
                        Spacer(Modifier.height(8.dp))
                        HorizontalDivider()
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable { normPicker = null; timePicker = "lunch" }
                                .padding(vertical = 12.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text("Тривалість обіду", style = MaterialTheme.typography.bodyLarge)
                            Text(
                                text = TimeFormat.hoursMinutes(settings.lunchMinutes),
                                style = MaterialTheme.typography.bodyLarge,
                                fontWeight = FontWeight.Medium,
                                color = MaterialTheme.colorScheme.primary
                            )
                        }
                        HorizontalDivider()
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable { normPicker = null; timePicker = "lunchMin" }
                                .padding(vertical = 12.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column(Modifier.weight(1f)) {
                                Text("Мінімальна зміна", style = MaterialTheme.typography.bodyLarge)
                                Text(
                                    text = "Від коротших змін обід не віднімається",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                            Text(
                                text = TimeFormat.hoursMinutes(settings.lunchMinShiftMinutes),
                                style = MaterialTheme.typography.bodyLarge,
                                fontWeight = FontWeight.Medium,
                                color = MaterialTheme.colorScheme.primary
                            )
                        }
                        Spacer(Modifier.height(4.dp))
                        Text(
                            text = "Якщо якогось дня обіду не було — вимкни перемикач " +
                                "\"Обід\" у картці цього дня.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }
        }

        // --- Нагадування ---
        item {
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    Text("Нагадування", style = MaterialTheme.typography.titleMedium)
                    Text(
                        text = "У неділю не надсилаються. Якщо час уже записано — нагадування не прийде.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Spacer(Modifier.height(12.dp))

                    ReminderRow(
                        title = "Ранкове — \"Не забудь відмітити прихід\"",
                        time = settings.morningTime,
                        enabled = settings.morningEnabled,
                        onToggle = { checked ->
                            Repo.updateSettings { it.copy(morningEnabled = checked) }
                            ReminderScheduler.rescheduleAll(context)
                        },
                        onTimeClick = { timePicker = "morning" }
                    )

                    Spacer(Modifier.height(8.dp))
                    HorizontalDivider()
                    Spacer(Modifier.height(8.dp))

                    ReminderRow(
                        title = "Вечірнє — \"Не забудь відмітити вихід\"",
                        time = settings.eveningTime,
                        enabled = settings.eveningEnabled,
                        onToggle = { checked ->
                            Repo.updateSettings { it.copy(eveningEnabled = checked) }
                            ReminderScheduler.rescheduleAll(context)
                        },
                        onTimeClick = { timePicker = "evening" }
                    )
                }
            }
        }

        // --- Дозволи ---
        item {
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    Text("Дозволи", style = MaterialTheme.typography.titleMedium)
                    Spacer(Modifier.height(8.dp))

                    InfoRow(
                        label = "Повідомлення",
                        value = if (Notifications.hasPermission(context)) "дозволено" else "заборонено"
                    )
                    InfoRow(
                        label = "Точні будильники",
                        value = if (ReminderScheduler.canScheduleExact(context)) "дозволено" else "заборонено"
                    )

                    Spacer(Modifier.height(10.dp))
                    OutlinedButton(
                        onClick = {
                            val intent = Intent(
                                android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS
                            ).apply {
                                putExtra(
                                    android.provider.Settings.EXTRA_APP_PACKAGE,
                                    context.packageName
                                )
                                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                            }
                            runCatching { context.startActivity(intent) }
                        },
                        modifier = Modifier.fillMaxWidth()
                    ) { Text("Налаштування повідомлень") }

                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
                        !ReminderScheduler.canScheduleExact(context)
                    ) {
                        Spacer(Modifier.height(8.dp))
                        OutlinedButton(
                            onClick = {
                                val intent = Intent(
                                    android.provider.Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
                                    Uri.parse("package:${context.packageName}")
                                ).apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
                                runCatching { context.startActivity(intent) }
                            },
                            modifier = Modifier.fillMaxWidth()
                        ) { Text("Дозволити точні будильники") }
                    }
                }
            }
        }

        // --- Про додаток ---
        item {
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    Text("Як рахується", style = MaterialTheme.typography.titleMedium)
                    Spacer(Modifier.height(6.dp))
                    Text(
                        text = "• Відпрацьовано = час виходу − час приходу − обід.\n" +
                            "• Якщо вихід раніший за прихід — це нічна зміна, години зараховуються дню, коли зміна почалась (22:00 → 06:00 = 8 год).\n" +
                            "• Відпустка, лікарняний і святковий мають норму 0 — це не недоробіток.\n" +
                            "• Робота в неділю за стандартної норми повністю йде в переробіток.\n" +
                            "• Дані лежать у файлі worktime.json у пам'яті додатка.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        }
    }

    normPicker?.let { dow ->
        val minutes = settings.normFor(dow)
        TimePickerDialog(
            title = "Норма: ${UaDate.dayName(anyMonday.plusDays((dow.value - 1).toLong()))}",
            initial = LocalTime.of(minutes / 60, minutes % 60),
            onConfirm = { time ->
                Repo.updateSettings { it.withNorm(dow, time.hour * 60 + time.minute) }
                normPicker = null
            },
            onDismiss = { normPicker = null },
            onClear = {
                Repo.updateSettings { it.withNorm(dow, 0) }
                normPicker = null
            }
        )
    }

    when (timePicker) {
        "morning" -> TimePickerDialog(
            title = "Час ранкового нагадування",
            initial = settings.morningLocalTime,
            onConfirm = { time ->
                Repo.updateSettings { it.copy(morningTime = TimeFormat.time(time)) }
                ReminderScheduler.rescheduleAll(context)
                timePicker = null
            },
            onDismiss = { timePicker = null }
        )
        "lunch" -> TimePickerDialog(
            title = "Тривалість обіду",
            initial = LocalTime.of(
                (settings.lunchMinutes / 60).coerceIn(0, 23),
                settings.lunchMinutes % 60
            ),
            onConfirm = { time ->
                Repo.updateSettings { it.copy(lunchMinutes = time.hour * 60 + time.minute) }
                timePicker = null
            },
            onDismiss = { timePicker = null },
            onClear = {
                Repo.updateSettings { it.copy(lunchMinutes = 0) }
                timePicker = null
            }
        )
        "lunchMin" -> TimePickerDialog(
            title = "Мінімальна зміна для обіду",
            initial = LocalTime.of(
                (settings.lunchMinShiftMinutes / 60).coerceIn(0, 23),
                settings.lunchMinShiftMinutes % 60
            ),
            onConfirm = { time ->
                Repo.updateSettings { it.copy(lunchMinShiftMinutes = time.hour * 60 + time.minute) }
                timePicker = null
            },
            onDismiss = { timePicker = null },
            onClear = {
                Repo.updateSettings { it.copy(lunchMinShiftMinutes = 0) }
                timePicker = null
            }
        )
        "evening" -> TimePickerDialog(
            title = "Час вечірнього нагадування",
            initial = settings.eveningLocalTime,
            onConfirm = { time ->
                Repo.updateSettings { it.copy(eveningTime = TimeFormat.time(time)) }
                ReminderScheduler.rescheduleAll(context)
                timePicker = null
            },
            onDismiss = { timePicker = null }
        )
    }
}

@Composable
private fun ReminderRow(
    title: String,
    time: String,
    enabled: Boolean,
    onToggle: (Boolean) -> Unit,
    onTimeClick: () -> Unit
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyMedium)
            Spacer(Modifier.height(4.dp))
            OutlinedButton(onClick = onTimeClick) {
                Text(time, style = MaterialTheme.typography.titleMedium)
            }
        }
        Switch(checked = enabled, onCheckedChange = onToggle)
    }
}
