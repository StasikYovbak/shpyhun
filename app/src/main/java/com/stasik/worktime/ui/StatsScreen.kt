package com.stasik.worktime.ui

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.Card
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.ExperimentalMaterial3Api
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.stasik.worktime.Repo
import com.stasik.worktime.TimeFormat
import com.stasik.worktime.UaDate
import com.stasik.worktime.WorkCalc
import java.time.LocalDate

private enum class Filter(val title: String) {
    WEEK("Тиждень"),
    MONTH("Місяць"),
    CUSTOM("Період"),
    FROM_DATE("З дати по сьогодні")
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StatsScreen() {
    val data = Repo.data
    val today = LocalDate.now()

    var filter by remember { mutableStateOf(Filter.WEEK) }
    var customFrom by remember { mutableStateOf(WorkCalc.monthStart(today)) }
    var customTo by remember { mutableStateOf(today) }
    var fromDate by remember { mutableStateOf(today.minusDays(30)) }
    var picker by remember { mutableStateOf<String?>(null) }
    var editing by remember { mutableStateOf<LocalDate?>(null) }

    val from: LocalDate
    val to: LocalDate
    when (filter) {
        Filter.WEEK -> {
            from = WorkCalc.weekStart(today); to = WorkCalc.weekStart(today).plusDays(6)
        }
        Filter.MONTH -> {
            from = WorkCalc.monthStart(today); to = today.withDayOfMonth(today.lengthOfMonth())
        }
        Filter.CUSTOM -> {
            from = customFrom; to = customTo
        }
        Filter.FROM_DATE -> {
            from = fromDate; to = today
        }
    }

    val period = WorkCalc.period(from, to, data)
    // Посеред тижня/місяця баланс рахуємо тільки за дні, які вже минули,
    // інакше майбутні дні виглядали б як недоробіток.
    val hasFuture = period.hasFutureDays(today)
    val shown = period.upTo(today)

    LazyColumn(
        modifier = Modifier.fillMaxWidth(),
        contentPadding = PaddingValues(12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        item {
            Row(
                modifier = Modifier.horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                for (option in Filter.entries) {
                    FilterChip(
                        selected = filter == option,
                        onClick = { filter = option },
                        label = { Text(option.title) }
                    )
                }
            }
        }

        if (filter == Filter.CUSTOM) {
            item {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    OutlinedButton(
                        onClick = { picker = "from" },
                        modifier = Modifier.weight(1f)
                    ) { Text("з: ${UaDate.numeric(customFrom)}") }
                    OutlinedButton(
                        onClick = { picker = "to" },
                        modifier = Modifier.weight(1f)
                    ) { Text("по: ${UaDate.numeric(customTo)}") }
                }
            }
        }

        if (filter == Filter.FROM_DATE) {
            item {
                OutlinedButton(
                    onClick = { picker = "fromDate" },
                    modifier = Modifier.fillMaxWidth()
                ) { Text("з ${UaDate.numeric(fromDate)} по сьогодні (${UaDate.numeric(today)})") }
            }
        }

        // --- Підсумок ---
        item {
            ElevatedCard(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    Text(
                        text = "${UaDate.dayMonthYear(period.from)} — ${UaDate.dayMonthYear(period.to)}",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold
                    )
                    Text(
                        text = "${period.items.size} дн.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )

                    Spacer(Modifier.height(12.dp))
                    InfoRow("Відпрацьовано", TimeFormat.full(period.workedMinutes), bold = true)
                    InfoRow("Норма за період", TimeFormat.full(period.normMinutes))
                    if (hasFuture) {
                        InfoRow("Норма по сьогодні включно", TimeFormat.full(shown.normMinutes))
                    }
                    HorizontalDivider(Modifier.padding(vertical = 8.dp))
                    Text(
                        text = TimeFormat.diffTitle(shown.diffMinutes) +
                            if (hasFuture) " на сьогодні" else "",
                        style = MaterialTheme.typography.titleMedium,
                        color = diffColor(shown.diffMinutes)
                    )
                    Text(
                        text = TimeFormat.signedHoursMinutes(shown.diffMinutes),
                        style = MaterialTheme.typography.headlineMedium,
                        fontWeight = FontWeight.Bold,
                        color = diffColor(shown.diffMinutes)
                    )
                    Text(
                        text = "${TimeFormat.signedDecimal(shown.diffMinutes)} год",
                        style = MaterialTheme.typography.titleMedium,
                        color = diffColor(shown.diffMinutes)
                    )
                    if (hasFuture) {
                        Spacer(Modifier.height(6.dp))
                        Text(
                            text = "Баланс рахується проти норми днів, які вже минули. " +
                                "До кінця періоду лишилось відпрацювати " +
                                TimeFormat.hoursMinutes(period.normMinutes - shown.normMinutes) + ".",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }

                    if (period.unfinishedCount > 0) {
                        Spacer(Modifier.height(8.dp))
                        Text(
                            text = "Незавершених днів: ${period.unfinishedCount}",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.error
                        )
                    }
                }
            }
        }

        item {
            Text(
                text = "Дні періоду",
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(start = 4.dp, top = 4.dp)
            )
        }

        items(period.items.map { it.date }, key = { it.toString() }) { date ->
            DayRow(date = date, onClick = { editing = date })
        }
    }

    when (picker) {
        "from" -> DatePickerDialogUa(
            title = "Початок періоду",
            initial = customFrom,
            onConfirm = { customFrom = it; if (customTo < it) customTo = it; picker = null },
            onDismiss = { picker = null }
        )
        "to" -> DatePickerDialogUa(
            title = "Кінець періоду",
            initial = customTo,
            onConfirm = { customTo = it; if (it < customFrom) customFrom = it; picker = null },
            onDismiss = { picker = null }
        )
        "fromDate" -> DatePickerDialogUa(
            title = "З якої дати",
            initial = fromDate,
            onConfirm = { fromDate = it; picker = null },
            onDismiss = { picker = null }
        )
    }

    editing?.let { date ->
        DayEditorDialog(date = date, onDismiss = { editing = null })
    }
}
