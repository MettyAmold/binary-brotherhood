package at.binarybrotherhood.app.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import at.binarybrotherhood.app.R

val Gold = Color(0xFFC9A24D)
val GoldLight = Color(0xFFE8D9A8)
val Ink = Color(0xFF07090D)
val Panel = Color(0xFF11151D)
val PanelAlt = Color(0xFF181D27)
val Parchment = Color(0xFFF1E7CF)
val Muted = Color(0xFF8E97A8)

val Cinzel = FontFamily(
    Font(R.font.cinzel, FontWeight.Normal),
    Font(R.font.cinzel, FontWeight.Bold),
)

private val scheme = darkColorScheme(
    primary = Gold,
    onPrimary = Ink,
    secondary = GoldLight,
    onSecondary = Ink,
    background = Ink,
    onBackground = Parchment,
    surface = Panel,
    onSurface = Parchment,
    surfaceVariant = PanelAlt,
    onSurfaceVariant = Muted,
    outline = Color(0xFF3A4150),
    error = Color(0xFFE05C5C),
)

private val typography = Typography(
    titleLarge = TextStyle(fontFamily = Cinzel, fontWeight = FontWeight.Bold, fontSize = 20.sp, letterSpacing = 1.5.sp),
    titleMedium = TextStyle(fontFamily = Cinzel, fontWeight = FontWeight.Bold, fontSize = 16.sp, letterSpacing = 1.sp),
)

@Composable
fun BinaryBrotherhoodTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = scheme, typography = typography, content = content)
}
