package com.stasik.worktime.ui

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext

private val LightColors = lightColorScheme(
    primary = Color(0xFF1E6B4F),
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFFA8F2CD),
    onPrimaryContainer = Color(0xFF002115),
    secondary = Color(0xFF4C6358),
    onSecondary = Color(0xFFFFFFFF),
    secondaryContainer = Color(0xFFCEE9DA),
    onSecondaryContainer = Color(0xFF092017),
    background = Color(0xFFF7FBF7),
    onBackground = Color(0xFF191C1A),
    surface = Color(0xFFF7FBF7),
    onSurface = Color(0xFF191C1A),
    surfaceVariant = Color(0xFFDBE5DD),
    onSurfaceVariant = Color(0xFF404943),
    outline = Color(0xFF707973),
    error = Color(0xFFBA1A1A),
    onError = Color(0xFFFFFFFF)
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFF8CD6B2),
    onPrimary = Color(0xFF003827),
    primaryContainer = Color(0xFF00513A),
    onPrimaryContainer = Color(0xFFA8F2CD),
    secondary = Color(0xFFB2CCBF),
    onSecondary = Color(0xFF1E352C),
    secondaryContainer = Color(0xFF344C41),
    onSecondaryContainer = Color(0xFFCEE9DA),
    background = Color(0xFF101412),
    onBackground = Color(0xFFE1E3E0),
    surface = Color(0xFF101412),
    onSurface = Color(0xFFE1E3E0),
    surfaceVariant = Color(0xFF404943),
    onSurfaceVariant = Color(0xFFBFC9C2),
    outline = Color(0xFF8A938C),
    error = Color(0xFFFFB4AB),
    onError = Color(0xFF690005)
)

/** Кольори переробітку/недоробітку — окремо для темної і світлої теми. */
object DiffColors {
    val positiveLight = Color(0xFF1B7F3B)
    val positiveDark = Color(0xFF7BDB9C)
    val negativeLight = Color(0xFFC62828)
    val negativeDark = Color(0xFFFF9A90)
}

@Composable
fun diffColor(minutes: Int): Color {
    val dark = isSystemInDarkTheme()
    return when {
        minutes > 0 -> if (dark) DiffColors.positiveDark else DiffColors.positiveLight
        minutes < 0 -> if (dark) DiffColors.negativeDark else DiffColors.negativeLight
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }
}

@Composable
fun WorkTimeTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    dynamicColor: Boolean = true,
    content: @Composable () -> Unit
) {
    val colorScheme = when {
        dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
            val context = LocalContext.current
            if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        }
        darkTheme -> DarkColors
        else -> LightColors
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = MaterialTheme.typography,
        content = content
    )
}
