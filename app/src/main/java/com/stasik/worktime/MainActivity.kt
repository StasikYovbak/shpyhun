package com.stasik.worktime

import android.Manifest
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import com.stasik.worktime.ui.MainScreen
import com.stasik.worktime.ui.SettingsScreen
import com.stasik.worktime.ui.StatsScreen
import com.stasik.worktime.ui.WorkTimeTheme

class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Repo.init(applicationContext)
        Notifications.ensureChannel(applicationContext)
        enableEdgeToEdge()
        setContent {
            WorkTimeTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    AppRoot()
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        // Розклад міг збитися, поки додаток був закритий
        ReminderScheduler.rescheduleAll(this)
    }
}

private enum class Tab(val title: String) {
    MAIN("Головна"),
    STATS("Статистика"),
    SETTINGS("Налаштування")
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AppRoot() {
    val context = LocalContext.current
    var tab by rememberSaveable { mutableStateOf(Tab.MAIN.name) }
    val current = runCatching { Tab.valueOf(tab) }.getOrDefault(Tab.MAIN)

    // Дозвіл на повідомлення (Android 13+) — питаємо один раз при першому запуску
    val launcher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission()
    ) { /* результат не важливий: без дозволу просто не буде нагадувань */ }

    LaunchedEffect(Unit) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            !Notifications.hasPermission(context) &&
            !Repo.settings.permissionAsked
        ) {
            Repo.updateSettings { it.copy(permissionAsked = true) }
            launcher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    Scaffold(
        topBar = {
            CenterAlignedTopAppBar(title = { Text(current.title) })
        },
        bottomBar = {
            NavigationBar {
                NavigationBarItem(
                    selected = current == Tab.MAIN,
                    onClick = { tab = Tab.MAIN.name },
                    icon = { Icon(Icons.Default.Home, contentDescription = null) },
                    label = { Text("Головна") }
                )
                NavigationBarItem(
                    selected = current == Tab.STATS,
                    onClick = { tab = Tab.STATS.name },
                    icon = { Icon(Icons.Default.DateRange, contentDescription = null) },
                    label = { Text("Статистика") }
                )
                NavigationBarItem(
                    selected = current == Tab.SETTINGS,
                    onClick = { tab = Tab.SETTINGS.name },
                    icon = { Icon(Icons.Default.Settings, contentDescription = null) },
                    label = { Text("Налаштування") }
                )
            }
        }
    ) { innerPadding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
        ) {
            when (current) {
                Tab.MAIN -> MainScreen()
                Tab.STATS -> StatsScreen()
                Tab.SETTINGS -> SettingsScreen()
            }
        }
    }
}
