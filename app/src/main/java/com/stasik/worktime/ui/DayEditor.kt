package com.stasik.worktime.ui

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.stasik.worktime.DayStatus
import com.stasik.worktime.Repo
import com.stasik.worktime.TimeFormat
import com.stasik.worktime.UaDate
import com.stasik.worktime.WorkCalc
import com.stasik.worktime.WorkDay
import java.time.LocalDate
import java.time.LocalTime

/** Редагування будь-якого дня: час приходу, час виходу, статус. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DayEditorDialog(date: LocalDate, onDismiss: () -> Unit) {
    val existing = Repo.day(date)

    var start by remember(date) { mutableStateOf(existing?.startTime) }
    var end by remember(date) { mutableStateOf(existing?.endTime) }
    var status by remember(date) { mutableStateOf(existing?.status ?: DayStatus.WORK) }
    var picker by remember(date) { mutableStateOf<String?>(null) }

    val draft = WorkDay(
        date = date.toString(),
        start = start?.let { TimeFormat.time(it) },
        end = end?.let { TimeFormat.time(it) },
        status = status
    )
    val result = WorkCalc.dayResult(date, draft, Repo.settings)

    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Column {
                Text(UaDate.weekdayDayMonth(date))
                Text(
                    text = UaDate.numeric(date),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        },
        text = {
            Column(Modifier.fillMaxWidth()) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    OutlinedButton(
                        onClick = { picker = "start" },
                        modifier = Modifier
                            .weight(1f)
                            .height(56.dp)
                    ) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Text("Прийшов", style = MaterialTheme.typography.labelSmall)
                            Text(TimeFormat.time(start), style = MaterialTheme.typography.titleMedium)
                        }
                    }
                    OutlinedButton(
                        onClick = { picker = "end" },
                        modifier = Modifier
                            .weight(1f)
                            .height(56.dp)
                    ) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Text("Пішов", style = MaterialTheme.typography.labelSmall)
                            Text(TimeFormat.time(end), style = MaterialTheme.typography.titleMedium)
                        }
                    }
                }

                Spacer(Modifier.height(12.dp))
                Text("Статус дня", style = MaterialTheme.typography.labelLarge)
                Spacer(Modifier.height(4.dp))
                Row(
                    modifier = Modifier.horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    for (option in DayStatus.entries) {
                        FilterChip(
                            selected = status == option,
                            onClick = { status = option },
                            label = { Text(option.title) }
                        )
                    }
                }

                Spacer(Modifier.height(12.dp))
                HorizontalDivider()
                Spacer(Modifier.height(8.dp))

                InfoRow("Відпрацьовано", TimeFormat.full(result.workedMinutes))
                InfoRow("Норма", TimeFormat.full(result.normMinutes))
                InfoRow(
                    label = TimeFormat.diffTitle(result.diffMinutes),
                    value = TimeFormat.signedFull(result.diffMinutes),
                    valueColor = diffColor(result.diffMinutes),
                    bold = true
                )
                if (result.unfinished) {
                    Spacer(Modifier.height(6.dp))
                    Text(
                        text = "День незавершений — заповни другий час",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error,
                        fontWeight = FontWeight.Medium
                    )
                }
                if (start != null && end != null && end!! <= start!!) {
                    Spacer(Modifier.height(6.dp))
                    Text(
                        text = "Нічна зміна: вихід наступного дня",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.primary
                    )
                }
            }
        },
        confirmButton = {
            TextButton(onClick = {
                Repo.saveDay(draft)
                onDismiss()
            }) { Text("Зберегти") }
        },
        dismissButton = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = {
                    Repo.deleteDay(date)
                    onDismiss()
                }) { Text("Видалити") }
                Spacer(Modifier.width(4.dp))
                TextButton(onClick = onDismiss) { Text("Скасувати") }
            }
        }
    )

    when (picker) {
        "start" -> TimePickerDialog(
            title = "Час приходу",
            initial = start ?: LocalTime.of(8, 0),
            onConfirm = { start = it; picker = null },
            onDismiss = { picker = null },
            onClear = { start = null; picker = null }
        )
        "end" -> TimePickerDialog(
            title = "Час виходу",
            initial = end ?: LocalTime.of(17, 0),
            onConfirm = { end = it; picker = null },
            onDismiss = { picker = null },
            onClear = { end = null; picker = null }
        )
    }
}
