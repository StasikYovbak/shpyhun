package com.stasik.worktime.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
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
import com.stasik.worktime.PeriodResult
import com.stasik.worktime.Repo
import com.stasik.worktime.TimeFormat
import com.stasik.worktime.UaDate
import com.stasik.worktime.WorkCalc
import java.time.LocalDate
import java.time.LocalTime

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MainScreen() {
    val data = Repo.data
    val today = LocalDate.now()
    val todayDay = data.day(today)
    val todayResult = WorkCalc.dayResult(today, todayDay, data.settings)

    var picker by remember { mutableStateOf<String?>(null) }
    var editing by remember { mutableStateOf<LocalDate?>(null) }

    val weekStart = WorkCalc.weekStart(today)
    val week = WorkCalc.period(weekStart, weekStart.plusDays(6), data)
    val monthStart = WorkCalc.monthStart(today)
    val month = WorkCalc.period(monthStart, today.withDayOfMonth(today.lengthOfMonth()), data)

    val recentDays = (0..13).map { today.minusDays(it.toLong()) }

    LazyColumn(
        modifier = Modifier.fillMaxWidth(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        // --- Сьогодні ---
        item {
            ElevatedCard(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    Text(
                        text = "Сьогодні",
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.primary
                    )
                    Text(
                        text = UaDate.weekdayDayMonth(today),
                        style = MaterialTheme.typography.headlineSmall,
                        fontWeight = FontWeight.SemiBold
                    )

                    Spacer(Modifier.height(16.dp))

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        FilledTonalButton(
                            onClick = { Repo.setStart(today, LocalTime.now().withSecond(0).withNano(0)) },
                            modifier = Modifier
                                .weight(1f)
                                .height(72.dp)
                        ) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Text("Прийшов", style = MaterialTheme.typography.titleMedium)
                                Text(
                                    text = TimeFormat.time(todayDay?.startTime),
                                    style = MaterialTheme.typography.headlineSmall,
                                    fontWeight = FontWeight.Bold
                                )
                            }
                        }
                        FilledTonalButton(
                            onClick = { Repo.setEnd(today, LocalTime.now().withSecond(0).withNano(0)) },
                            modifier = Modifier
                                .weight(1f)
                                .height(72.dp)
                        ) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Text("Пішов", style = MaterialTheme.typography.titleMedium)
                                Text(
                                    text = TimeFormat.time(todayDay?.endTime),
                                    style = MaterialTheme.typography.headlineSmall,
                                    fontWeight = FontWeight.Bold
                                )
                            }
                        }
                    }

                    Spacer(Modifier.height(8.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        OutlinedButton(
                            onClick = { picker = "start" },
                            modifier = Modifier.weight(1f)
                        ) { Text("Змінити прихід") }
                        OutlinedButton(
                            onClick = { picker = "end" },
                            modifier = Modifier.weight(1f)
                        ) { Text("Змінити вихід") }
                    }

                    Spacer(Modifier.height(14.dp))
                    Text("Статус дня", style = MaterialTheme.typography.labelLarge)
                    Spacer(Modifier.height(6.dp))
                    Row(
                        modifier = Modifier.horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        for (option in DayStatus.entries) {
                            FilterChip(
                                selected = (todayDay?.status ?: DayStatus.WORK) == option,
                                onClick = { Repo.setStatus(today, option) },
                                label = { Text(option.title) }
                            )
                        }
                    }

                    Spacer(Modifier.height(14.dp))
                    HorizontalDivider()
                    Spacer(Modifier.height(10.dp))

                    InfoRow("Відпрацьовано", TimeFormat.full(todayResult.workedMinutes))
                    InfoRow("Норма", TimeFormat.full(todayResult.normMinutes))
                    InfoRow(
                        label = TimeFormat.diffTitle(todayResult.diffMinutes),
                        value = TimeFormat.signedFull(todayResult.diffMinutes),
                        valueColor = diffColor(todayResult.diffMinutes),
                        bold = true
                    )

                    if (todayResult.unfinished) {
                        Spacer(Modifier.height(8.dp))
                        Text(
                            text = "Незавершений день — записано лише один час",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.error
                        )
                    }
                }
            }
        }

        // --- Швидкі підсумки ---
        item {
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    Text("Коротко", style = MaterialTheme.typography.titleMedium)
                    Spacer(Modifier.height(8.dp))
                    SummaryLine("Цей тиждень (пн\u2013нд)", "норма тижня", week, today)
                    Spacer(Modifier.height(12.dp))
                    SummaryLine(
                        title = "Цей місяць (${UaDate.monthName(today).lowercase()})",
                        normLabel = "норма місяця",
                        full = month,
                        today = today
                    )
                }
            }
        }

        item {
            Text(
                text = "Останні 14 днів",
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(start = 4.dp, top = 4.dp)
            )
        }

        items(recentDays, key = { it.toString() }) { date ->
            DayRow(
                date = date,
                onClick = { editing = date }
            )
        }

        item {
            Text(
                text = "Натисни на день, щоб виправити час або статус.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(4.dp)
            )
        }
    }

    when (picker) {
        "start" -> TimePickerDialog(
            title = "Час приходу",
            initial = todayDay?.startTime ?: LocalTime.of(8, 0),
            onConfirm = { Repo.setStart(today, it); picker = null },
            onDismiss = { picker = null },
            onClear = { Repo.setStart(today, null); picker = null }
        )
        "end" -> TimePickerDialog(
            title = "Час виходу",
            initial = todayDay?.endTime ?: LocalTime.of(17, 0),
            onConfirm = { Repo.setEnd(today, it); picker = null },
            onDismiss = { picker = null },
            onClear = { Repo.setEnd(today, null); picker = null }
        )
    }

    editing?.let { date ->
        DayEditorDialog(date = date, onDismiss = { editing = null })
    }
}

/**
 * Підсумок за період. Показує норму всього періоду (щоб було видно ціль)
 * і окремо норму днів, які вже минули — саме проти неї рахується баланс,
 * інакше в понеділок вранці завжди висів би мінус на цілий тиждень.
 */
@Composable
fun SummaryLine(title: String, normLabel: String, full: PeriodResult, today: LocalDate) {
    val toDate = full.upTo(today)
    val hasFuture = full.hasFutureDays(today)
    Column {
        Text(title, style = MaterialTheme.typography.labelLarge)
        InfoRow(
            label = "Відпрацьовано / $normLabel",
            value = "${TimeFormat.decimal(full.workedMinutes)} / ${TimeFormat.decimal(full.normMinutes)}"
        )
        if (hasFuture) {
            InfoRow(
                label = "Норма по сьогодні включно",
                value = TimeFormat.decimal(toDate.normMinutes)
            )
        }
        InfoRow(
            label = TimeFormat.diffTitle(toDate.diffMinutes) + if (hasFuture) " на сьогодні" else "",
            value = TimeFormat.signedFull(toDate.diffMinutes),
            valueColor = diffColor(toDate.diffMinutes),
            bold = true
        )
    }
}

/** Рядок одного дня у списку. */
@Composable
fun DayRow(date: LocalDate, onClick: () -> Unit) {
    val data = Repo.data
    val result = WorkCalc.dayResult(date, data.day(date), data.settings)
    val day = result.day
    // День, який ще не настав, не показуємо як недоробіток
    val isFuture = date.isAfter(LocalDate.now()) && !result.hasRecord

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        colors = CardDefaults.cardColors(
            containerColor = if (result.hasRecord) MaterialTheme.colorScheme.surfaceVariant
            else MaterialTheme.colorScheme.surface
        )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 10.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(Modifier.weight(1f)) {
                Text(
                    text = UaDate.shortWithWeekday(date),
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold
                )
                val times = "${TimeFormat.time(day?.startTime)} – ${TimeFormat.time(day?.endTime)}"
                Text(
                    text = if (result.status == DayStatus.WORK) times else result.status.title,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                if (result.unfinished) {
                    Text(
                        text = "незавершений",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.error
                    )
                }
            }
            Column(horizontalAlignment = Alignment.End) {
                Text(
                    text = TimeFormat.hoursMinutes(result.workedMinutes),
                    style = MaterialTheme.typography.titleSmall
                )
                Text(
                    text = "${TimeFormat.decimal(result.workedMinutes)} / ${TimeFormat.decimal(result.normMinutes)}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Text(
                    text = if (isFuture) "—" else TimeFormat.signedDecimal(result.diffMinutes),
                    style = MaterialTheme.typography.labelLarge,
                    color = if (isFuture) MaterialTheme.colorScheme.onSurfaceVariant
                    else diffColor(result.diffMinutes)
                )
            }
        }
    }
}
