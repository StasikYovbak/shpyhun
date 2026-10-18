package ua.jarvis.assistant.speech

import android.content.Context
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import okhttp3.Request
import ua.jarvis.assistant.core.Http
import ua.jarvis.assistant.text.TextNorm
import java.io.File
import java.io.IOException
import java.util.zip.ZipInputStream
import kotlin.coroutines.coroutineContext

/** Опис моделі Vosk, яку можна поставити. */
data class VoskModelSpec(
    val id: String,
    val title: String,
    val dirName: String,
    val zipSizeMb: Int,
    val unpackedMb: Int,
) {
    val url get() = "https://alphacephei.com/vosk/models/$dirName.zip"
}

object VoskModels {
    val UK_SMALL = VoskModelSpec("uk-small", "Українська small (рекомендовано)", "vosk-model-small-uk-v3-small", 138, 420)
    val UK_NANO = VoskModelSpec("uk-nano", "Українська nano (легша, але без слова «джарвіс»)", "vosk-model-small-uk-v3-nano", 73, 130)
    val EN = VoskModelSpec("en", "Англійська small", "vosk-model-small-en-us-0.15", 40, 70)
    val RU = VoskModelSpec("ru", "Російська small", "vosk-model-small-ru-0.22", 45, 90)

    val main = listOf(UK_SMALL, UK_NANO)

    fun mainById(id: String) = main.firstOrNull { it.id == id } ?: UK_SMALL
    fun extraByLang(lang: String) = when (lang) {
        "en" -> EN
        "ru" -> RU
        else -> null
    }
}

/**
 * Де лежить модель і як вона туди потрапляє.
 *
 * Варіант 1 (за замовчуванням): застосунок сам качає ZIP з alphacephei.com
 *   і розпаковує в internal storage: /data/data/ua.jarvis.assistant/files/vosk/<назва>.
 * Варіант 2 (без інтернету на телефоні): покладіть розпаковану теку моделі в
 *   app/src/main/assets/<назва>/ (наприклад assets/vosk-model-small-uk-v3-small/am/final.mdl)
 *   — при першому запуску її буде скопійовано звідти.
 */
class ModelManager(context: Context) {

    private val ctx = context.applicationContext
    private val root = File(ctx.filesDir, "vosk")

    fun dir(spec: VoskModelSpec) = File(root, spec.dirName)

    fun isInstalled(spec: VoskModelSpec): Boolean {
        val d = dir(spec)
        return File(d, MARKER).exists() && File(d, "am/final.mdl").exists()
    }

    private fun hasAsset(spec: VoskModelSpec): Boolean =
        runCatching { ctx.assets.list("${spec.dirName}/am")?.contains("final.mdl") == true }.getOrDefault(false)

    /** Гарантує, що модель є на диску. [progress] отримує текст і відсоток (0–100). */
    suspend fun ensure(spec: VoskModelSpec, progress: (String, Int) -> Unit): File = withContext(Dispatchers.IO) {
        val target = dir(spec)
        if (isInstalled(spec)) return@withContext target
        root.mkdirs()
        val free = ctx.filesDir.usableSpace / (1024 * 1024)
        val need = spec.unpackedMb + spec.zipSizeMb + 50
        if (free < need) throw IOException("Замало місця: потрібно ~$need МБ, вільно $free МБ")

        val tmp = File(root, spec.dirName + ".tmp")
        tmp.deleteRecursively()
        if (hasAsset(spec)) {
            progress("Копіюю модель з APK…", 0)
            copyAssetDir(spec.dirName, tmp)
        } else {
            val zip = File(ctx.cacheDir, spec.dirName + ".zip")
            download(spec, zip, progress)
            progress("Розпаковую модель…", 99)
            unzip(zip, tmp)
            zip.delete()
        }
        val modelRoot = findModelRoot(tmp) ?: throw IOException("В архіві немає моделі Vosk")
        target.deleteRecursively()
        if (!modelRoot.renameTo(target)) {
            modelRoot.copyRecursively(target, overwrite = true)
        }
        tmp.deleteRecursively()
        File(target, MARKER).writeText(spec.id)
        progress("Модель готова", 100)
        target
    }

    private suspend fun download(spec: VoskModelSpec, out: File, progress: (String, Int) -> Unit) {
        val req = Request.Builder().url(spec.url).build()
        Http.client.newCall(req).execute().use { resp ->
            if (!resp.isSuccessful) throw IOException("Не вдалося завантажити модель: HTTP ${resp.code}")
            val body = resp.body ?: throw IOException("Порожня відповідь сервера")
            val total = body.contentLength().takeIf { it > 0 } ?: (spec.zipSizeMb * 1024L * 1024L)
            var done = 0L
            var lastPct = -1
            body.byteStream().use { input ->
                out.outputStream().use { output ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        coroutineContext.ensureActive()
                        val n = input.read(buf)
                        if (n < 0) break
                        output.write(buf, 0, n)
                        done += n
                        val pct = (done * 98 / total).toInt().coerceIn(0, 98)
                        if (pct != lastPct) {
                            lastPct = pct
                            progress("Завантажую модель: ${done / 1048576} з ${total / 1048576} МБ", pct)
                        }
                    }
                }
            }
        }
    }

    private fun unzip(zip: File, dest: File) {
        dest.mkdirs()
        val destPath = dest.canonicalPath + File.separator
        ZipInputStream(zip.inputStream().buffered()).use { zis ->
            while (true) {
                val e = zis.nextEntry ?: break
                val f = File(dest, e.name)
                // Захист від «zip slip»: файл не повинен вийти за межі теки.
                if (!f.canonicalPath.startsWith(destPath)) throw IOException("Підозрілий шлях в архіві: ${e.name}")
                if (e.isDirectory) f.mkdirs() else {
                    f.parentFile?.mkdirs()
                    f.outputStream().use { zis.copyTo(it) }
                }
            }
        }
    }

    private fun copyAssetDir(path: String, dest: File) {
        val children = ctx.assets.list(path) ?: emptyArray()
        if (children.isEmpty()) {
            dest.parentFile?.mkdirs()
            ctx.assets.open(path).use { input -> dest.outputStream().use { input.copyTo(it) } }
        } else {
            dest.mkdirs()
            children.forEach { copyAssetDir("$path/$it", File(dest, it)) }
        }
    }

    /** Тека, в якій лежать am/ і conf/ (в архівах вона буває вкладеною). */
    private fun findModelRoot(dir: File): File? {
        if (File(dir, "am").isDirectory && File(dir, "conf").isDirectory) return dir
        return dir.listFiles()?.filter { it.isDirectory }?.firstNotNullOfOrNull { findModelRoot(it) }
    }

    fun delete(spec: VoskModelSpec) = dir(spec).deleteRecursively()

    fun installedSizeMb(spec: VoskModelSpec): Long =
        dir(spec).walkTopDown().filter { it.isFile }.sumOf { it.length() } / (1024 * 1024)

    /**
     * Чи є слова у словнику моделі. Якщо слова там немає, Vosk ніколи його не «почує»
     * — замість нього буде щось схоже. Перевіряє graph/words.txt.
     */
    suspend fun checkVocabulary(spec: VoskModelSpec, words: List<String>): Map<String, Boolean> = withContext(Dispatchers.IO) {
        val file = File(dir(spec), "graph/words.txt")
        val wanted = words.associateWith { w -> TextNorm.tokens(w) }
        val needed = wanted.values.flatten().toMutableSet()
        if (!file.exists()) return@withContext words.associateWith { true }
        val found = HashSet<String>()
        try {
            file.bufferedReader().useLines { lines ->
                for (line in lines) {
                    val w = TextNorm.normalize(line.substringBefore(' '))
                    if (w in needed) { found += w; if (found.size == needed.size) break }
                }
            }
        } catch (e: Exception) {
            Log.w("ModelManager", "vocab check failed", e)
        }
        wanted.mapValues { (_, toks) -> toks.all { it in found } }
    }

    companion object {
        private const val MARKER = ".jarvis_ok"
    }
}
