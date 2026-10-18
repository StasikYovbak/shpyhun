package ua.jarvis.assistant.commands

import ua.jarvis.assistant.actions.DeviceControl
import ua.jarvis.assistant.actions.InstalledApp
import ua.jarvis.assistant.actions.Launcher
import ua.jarvis.assistant.actions.YouTubeApi

object MediaActions {

    /**
     * Знайти пісню й одразу ввімкнути перше відео.
     * [normalize] — спершу попросити Claude виправити назву («білівер» → «Believer»).
     */
    suspend fun playOnYouTube(
        c: CommandContext,
        heard: String,
        io: Interaction,
        normalize: Boolean,
        extraText: String = "",
    ): CommandResult {
        if (heard.isBlank()) {
            val o = c.device.openApp(InstalledApp("YouTube", DeviceControl.YOUTUBE))
            return CommandResult(o == Launcher.Outcome.STARTED, Launcher.describe(o, "відкрию ютуб"), "Відкрито YouTube")
        }
        var query = heard
        if (normalize && c.prefs.fixSongNames && c.prefs.hasClaude) {
            io.status("Уточнюю назву…")
            c.claude.normalizeSongQuery(heard, extraText)?.let { query = it }
        }
        if (!c.prefs.hasYouTube) {
            val o = c.device.youTubeSearch(query)
            return CommandResult(
                o == Launcher.Outcome.STARTED,
                Launcher.describe(o, "відкрию пошук") ?: "Відкриваю пошук. Щоб пісні вмикалися одразу, додайте ключ YouTube API",
                "Пошук YouTube: $query",
            )
        }
        io.status("Шукаю на YouTube: $query")
        val video = try {
            c.youtube.searchFirst(query, c.prefs.youtubeKey)
        } catch (e: YouTubeApi.YouTubeException) {
            return CommandResult(false, e.message, "YouTube: ${e.message}")
        }
        return when (val o = c.device.playYouTube(video.id, video.title)) {
            // Музика вже грає — мовчимо, щоб не перекрикувати її.
            Launcher.Outcome.STARTED -> CommandResult(true, null, "▶ ${video.title}")
            else -> CommandResult(o == Launcher.Outcome.WAITING_UNLOCK, Launcher.describe(o, "увімкну «${video.title}»"), "▶ ${video.title}")
        }
    }
}
