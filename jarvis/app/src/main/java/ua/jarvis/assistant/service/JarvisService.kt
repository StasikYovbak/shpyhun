package ua.jarvis.assistant.service

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.util.Log
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleService
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import org.vosk.LibVosk
import org.vosk.LogLevel
import org.vosk.Model
import ua.jarvis.assistant.actions.AppFinder
import ua.jarvis.assistant.actions.ContactFinder
import ua.jarvis.assistant.actions.DeviceControl
import ua.jarvis.assistant.actions.Launcher
import ua.jarvis.assistant.actions.YouTubeApi
import ua.jarvis.assistant.commands.CommandContext
import ua.jarvis.assistant.commands.CommandInput
import ua.jarvis.assistant.commands.CommandResult
import ua.jarvis.assistant.commands.CommandRouter
import ua.jarvis.assistant.commands.Interaction
import ua.jarvis.assistant.core.CommandLog
import ua.jarvis.assistant.core.JarvisState
import ua.jarvis.assistant.core.Notifications
import ua.jarvis.assistant.core.Prefs
import ua.jarvis.assistant.core.Status
import ua.jarvis.assistant.smart.ClaudeAgent
import ua.jarvis.assistant.speech.ModelManager
import ua.jarvis.assistant.speech.SpeechEngine
import ua.jarvis.assistant.speech.Speaker
import ua.jarvis.assistant.speech.VoskModels
import ua.jarvis.assistant.text.PhraseMatcher
import ua.jarvis.assistant.text.TextNorm
import ua.jarvis.assistant.text.WakeSession

/**
 * Фоновий сервіс, що постійно слухає мікрофон (foregroundServiceType="microphone").
 *
 * Стани: LISTENING → (слово активації) → RECORDING → (слово виконання) → EXECUTING
 *        [→ CONFIRMING для дзвінків/SMS/небезпечних дій] → LISTENING.
 */
class JarvisService : LifecycleService(), SpeechEngine.Listener, Interaction {

    private lateinit var prefs: Prefs
    private lateinit var speaker: Speaker
    private lateinit var models: ModelManager
    private lateinit var launcher: Launcher
    private lateinit var device: DeviceControl
    private lateinit var claude: ClaudeAgent
    private lateinit var router: CommandRouter
    private lateinit var session: WakeSession

    private val main = Handler(Looper.getMainLooper())
    private var engine: SpeechEngine? = null
    private var mainModel: Model? = null
    private var extraModel: Model? = null
    private var loadedModelId = ""
    private var loadedExtraLang = ""
    private var bootJob: Job? = null
    private var recordTimeout: Job? = null
    private var execJob: Job? = null
    private var pendingConfirm: CompletableDeferred<Boolean>? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var lastExtra = ""
    private var status = Status.OFF
    private var lastNotified = ""
    private var engineRetries = 0
    private var cancelMatcher = PhraseMatcher(Prefs.DEFAULT_CANCEL)

    private val unlockReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == Intent.ACTION_USER_PRESENT) launcher.onUserPresent()
        }
    }

    // ------------------------------------------------------------ життєвий цикл

    override fun onCreate() {
        super.onCreate()
        running = true
        prefs = Prefs(this)
        models = ModelManager(this)
        launcher = Launcher(this)
        device = DeviceControl(this, launcher)
        claude = ClaudeAgent(prefs)
        speaker = Speaker(this) { speaking -> engine?.muted = speaking }
        router = CommandRouter(
            CommandContext(this, prefs, launcher, AppFinder(this), ContactFinder(this), device, YouTubeApi(), claude)
        )
        rebuildSession()
        ContextCompat.registerReceiver(
            this, unlockReceiver, IntentFilter(Intent.ACTION_USER_PRESENT), ContextCompat.RECEIVER_NOT_EXPORTED,
        )
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        super.onStartCommand(intent, flags, startId)
        when (intent?.action) {
            ACTION_STOP -> {
                prefs.enabled = false
                ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_RELOAD -> {
                if (bootJob != null) reloadSettings()
                return START_STICKY
            }
        }
        // ACTION_START або перезапуск системою (intent == null)
        if (!goForeground()) return START_NOT_STICKY
        prefs.enabled = true
        Notifications.cancel(this, Notifications.ID_TAP_TO_START)
        if (bootJob == null) bootJob = lifecycleScope.launch { boot() }
        return START_STICKY
    }

    private fun goForeground(): Boolean {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            JarvisState.set(Status.ERROR, "Немає дозволу на мікрофон")
            stopSelf()
            return false
        }
        return try {
            val notification = Notifications.service(this, "запуск", "Готую розпізнавання мови…")
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                ServiceCompat.startForeground(
                    this, Notifications.ID_SERVICE, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE,
                )
            } else {
                // Android 10: тип «microphone» ще не існував, вистачає звичайного foreground-сервісу.
                startForeground(Notifications.ID_SERVICE, notification)
            }
            true
        } catch (e: Exception) {
            // Android 14+ не дозволяє вмикати мікрофон із фону (наприклад, після перезавантаження).
            Log.w(TAG, "startForeground refused", e)
            Notifications.showTapToStart(this, "Android не дозволяє фоновим програмам вмикати мікрофон самостійно. Один дотик — і Джарвіс знову слухає.")
            JarvisState.set(Status.OFF)
            stopSelf()
            false
        }
    }

    private suspend fun boot() {
        acquireWakeLock()
        try {
            val spec = VoskModels.mainById(prefs.modelId)
            setStatus(Status.LOADING, "Готую модель…")
            val dir = models.ensure(spec) { text, _ -> progress(text) }
            val extraSpec = VoskModels.extraByLang(prefs.extraLang)
            val extraDir = extraSpec?.let { s ->
                runCatching { models.ensure(s) { text, _ -> progress("Друга мова. $text") } }
                    .onFailure { Log.w(TAG, "extra model", it) }
                    .getOrNull()
            }
            setStatus(Status.LOADING, "Завантажую модель у пам'ять (кілька секунд)…")
            val (m, em) = withContext(Dispatchers.IO) {
                LibVosk.setLogLevel(LogLevel.WARNINGS)
                Model(dir.absolutePath) to extraDir?.let { d -> runCatching { Model(d.absolutePath) }.getOrNull() }
            }
            mainModel = m
            extraModel = em
            loadedModelId = spec.id
            loadedExtraLang = prefs.extraLang
            startEngine()
            checkVocabulary()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Log.e(TAG, "boot failed", e)
            setStatus(Status.ERROR, "Модель розпізнавання: ${e.message}")
            speaker.speak("Не вдалося підготувати модель розпізнавання")
            bootJob = null
        }
    }

    private fun progress(text: String) {
        JarvisState.detail.value = text
        main.post { updateNotification(Status.LOADING.title, text) }
    }

    private fun startEngine() {
        val m = mainModel ?: return
        engine?.stop()
        engine = SpeechEngine(m, extraModel, this).also { it.start() }
        setStatus(Status.LISTENING)
    }

    private fun checkVocabulary() = lifecycleScope.launch {
        val spec = VoskModels.mainById(prefs.modelId)
        val words = listOf(prefs.wakeWord, prefs.execWord, prefs.cancelWord)
        val missing = models.checkVocabulary(spec, words).filterValues { !it }.keys
        JarvisState.warning.value = if (missing.isEmpty()) "" else
            "Слів ${missing.joinToString { "«$it»" }} немає у словнику моделі: вона їх не почує дослівно. " +
                "Оберіть інші слова або додайте варіанти, як модель їх чує."
    }

    private fun rebuildSession() {
        session = WakeSession(
            prefs.wakeWord, PhraseMatcher.splitVariants(prefs.wakeVariants),
            prefs.execWord, emptyList(),
            prefs.cancelWord, CANCEL_EXTRA,
        )
        cancelMatcher = PhraseMatcher(prefs.cancelWord, CANCEL_EXTRA, PhraseMatcher::strictTypos)
    }

    private fun reloadSettings() {
        speaker.applySettings()
        rebuildSession()
        if (loadedModelId.isNotEmpty() && (loadedModelId != prefs.modelId || loadedExtraLang != prefs.extraLang)) {
            engine?.stop(); engine = null
            closeModels()
            bootJob?.cancel()
            bootJob = lifecycleScope.launch { boot() }
        } else if (status == Status.LISTENING) {
            checkVocabulary()
            updateNotification(status.title, "")
        }
    }

    private fun closeModels() {
        runCatching { mainModel?.close() }
        runCatching { extraModel?.close() }
        mainModel = null
        extraModel = null
        loadedModelId = ""
    }

    override fun onDestroy() {
        running = false
        recordTimeout?.cancel()
        execJob?.cancel()
        engine?.stop()
        engine = null
        closeModels()
        speaker.shutdown()
        device.release()
        claude.close()
        runCatching { unregisterReceiver(unlockReceiver) }
        wakeLock?.let { if (it.isHeld) it.release() }
        // Помилку (наприклад, «немає дозволу на мікрофон») лишаємо на екрані.
        if (JarvisState.status.value != Status.ERROR) JarvisState.set(Status.OFF)
        JarvisState.command.value = ""
        JarvisState.heard.value = ""
        super.onDestroy()
    }

    @SuppressLint("WakelockTimeout") // тримаємо, поки сервіс живий; відпускаємо в onDestroy
    private fun acquireWakeLock() {
        if (wakeLock?.isHeld == true) return
        wakeLock = getSystemService(PowerManager::class.java)
            .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "jarvis:listen")
            .apply { setReferenceCounted(false); acquire() }
    }

    // ------------------------------------------------------------ статус і сповіщення

    private fun setStatus(s: Status, detail: String = "") {
        status = s
        JarvisState.set(s, detail)
        updateNotification(s.title, detail)
    }

    private fun updateNotification(title: String, detail: String) {
        val key = "$title|$detail"
        if (key == lastNotified) return
        lastNotified = key
        runCatching {
            getSystemService(NotificationManager::class.java)
                .notify(Notifications.ID_SERVICE, Notifications.service(this, title.lowercase(), detail))
        }
    }

    // ------------------------------------------------------------ розпізнавання

    override fun onPartial(text: String) {
        JarvisState.heard.value = text
        if (status != Status.LISTENING && status != Status.RECORDING) return
        handle(session.onPartial(text))
    }

    override fun onFinal(text: String, extra: String?) {
        JarvisState.heard.value = text
        when (status) {
            Status.CONFIRMING -> { answerConfirmation(text); return }
            Status.EXECUTING -> {
                // «Скасуй» під час виконання зупиняє розумний режим
                val tokens = TextNorm.tokens(text)
                cancelMatcher.find(tokens)?.let { if (it.last == tokens.lastIndex) cancelExecution() }
                return
            }
            Status.LISTENING, Status.RECORDING -> Unit
            else -> return
        }
        if (extra != null) lastExtra = extra
        handle(session.onFinal(text))
    }

    override fun onEngineError(message: String) {
        Log.w(TAG, "engine error: $message")
        engine?.stop()
        engine = null
        setStatus(Status.ERROR, message)
        val wait = (3_000L shl engineRetries.coerceAtMost(4)).coerceAtMost(60_000L)
        engineRetries++
        lifecycleScope.launch {
            delay(wait)
            if (prefs.enabled && mainModel != null && engine == null) startEngine()
        }
    }

    private fun handle(events: List<WakeSession.Event>) {
        for (e in events) when (e) {
            WakeSession.Event.WakeDetected -> onWake()
            is WakeSession.Event.CommandUpdated -> JarvisState.command.value = e.text
            is WakeSession.Event.Execute -> onExecute(e.command)
            WakeSession.Event.Cancelled -> onCancelled()
            WakeSession.Event.FalseWake -> {
                recordTimeout?.cancel()
                engine?.captureExtra = false
                JarvisState.command.value = ""
                setStatus(Status.LISTENING)
            }
        }
    }

    private fun onWake() {
        engineRetries = 0
        val already = status == Status.RECORDING
        setStatus(Status.RECORDING)
        JarvisState.command.value = ""
        lastExtra = ""
        engine?.captureExtra = true
        if (!already) speaker.signalStart()
        recordTimeout?.cancel()
        recordTimeout = lifecycleScope.launch {
            delay(prefs.timeoutSec * 1000L)
            session.reset()
            engine?.captureExtra = false
            speaker.signalCancel()
            speaker.speak("Час вийшов, команду скасовано")
            JarvisState.command.value = ""
            setStatus(Status.LISTENING)
        }
    }

    private fun onCancelled() {
        recordTimeout?.cancel()
        engine?.captureExtra = false
        JarvisState.command.value = ""
        speaker.signalCancel()
        speaker.speak("Скасовано")
        setStatus(Status.LISTENING)
    }

    private fun onExecute(command: String) {
        recordTimeout?.cancel()
        engine?.captureExtra = false
        val extra = lastExtra
        lastExtra = ""
        JarvisState.command.value = command
        if (command.isBlank()) {
            speaker.speak("Команда порожня. Скажіть, що зробити, а потім «${prefs.execWord}»")
            setStatus(Status.LISTENING)
            return
        }
        JarvisState.lastCommand.value = command
        setStatus(Status.EXECUTING, command)
        speaker.signalDone()

        execJob = lifecycleScope.launch {
            val input = CommandInput(command, extra)
            val plan = withContext(Dispatchers.Default) { router.route(input) }
            if (plan == null) {
                val hint = if (!prefs.hasClaude) " Додайте ключ Claude в налаштуваннях, і я зрозумію більше." else ""
                speaker.say("Не зрозумів команду.$hint")
                CommandLog.add(this@JarvisService, command, "Не зрозумів команду", false)
                return@launch
            }
            if (plan.ack && prefs.sayAck) speaker.speak("Виконую")
            val result = try {
                plan.run(this@JarvisService)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.e(TAG, "command failed", e)
                CommandResult(false, "Сталася помилка: ${e.message ?: e.javaClass.simpleName}")
            }
            result.say?.let { speaker.say(it) }
            CommandLog.add(
                this@JarvisService, command,
                result.log ?: result.say ?: if (result.ok) "Виконано: ${plan.title}" else "Не вдалося",
                result.ok,
            )
        }.also { job ->
            job.invokeOnCompletion { main.post { backToListening() } }
        }
    }

    private fun backToListening() {
        if (status == Status.EXECUTING || status == Status.CONFIRMING) {
            JarvisState.command.value = ""
            engine?.reset()
            setStatus(Status.LISTENING)
        }
    }

    private fun cancelExecution() {
        pendingConfirm?.complete(false)
        execJob?.cancel()
        speaker.stopSpeaking()
        speaker.speak("Скасовано")
        CommandLog.add(this, JarvisState.lastCommand.value, "Скасовано голосом", false)
    }

    // ------------------------------------------------------------ Interaction (для команд)

    override suspend fun say(text: String) = withContext(Dispatchers.Main) { speaker.say(text) }

    override fun sayAsync(text: String) {
        main.post { speaker.speak(text) }
    }

    override fun status(text: String) {
        main.post {
            JarvisState.detail.value = text
            updateNotification(status.title, text)
        }
    }

    override suspend fun confirm(question: String): Boolean = withContext(Dispatchers.Main) {
        val answer = CompletableDeferred<Boolean>()
        pendingConfirm = answer
        speaker.say("$question Скажіть «так» або «ні».")
        engine?.reset()
        setStatus(Status.CONFIRMING, question)
        val result = withTimeoutOrNull(CONFIRM_TIMEOUT_MS) { answer.await() }
        pendingConfirm = null
        setStatus(Status.EXECUTING, JarvisState.lastCommand.value)
        if (result == null) speaker.say("Не почув відповіді. Скасовую")
        result ?: false
    }

    private fun answerConfirmation(text: String) {
        val tokens = TextNorm.tokens(text)
        val no = tokens.any { it in NO } || cancelMatcher.containsIn(tokens)
        val yes = tokens.any { it in YES } || PhraseMatcher(prefs.execWord, typos = PhraseMatcher::strictTypos).containsIn(tokens)
        when {
            no -> pendingConfirm?.complete(false)
            yes -> pendingConfirm?.complete(true)
        }
    }

    companion object {
        private const val TAG = "JarvisService"
        const val ACTION_START = "ua.jarvis.assistant.START"
        const val ACTION_STOP = "ua.jarvis.assistant.STOP"
        const val ACTION_RELOAD = "ua.jarvis.assistant.RELOAD"
        private const val CONFIRM_TIMEOUT_MS = 15_000L

        private val CANCEL_EXTRA = listOf("відміна", "відмінити")
        private val YES = setOf("так", "да", "ага", "угу", "звісно", "звичайно", "підтверджую", "yes", "ок", "окей", "добре", "авжеж", "давай")
        private val NO = setOf("ні", "нє", "нет", "не", "no", "стоп", "відміна", "відмінити")

        @Volatile var running = false
            private set

        fun start(ctx: Context) {
            // Без дозволу на мікрофон сервіс не зможе стати foreground, а Android за це закриває програму.
            if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                JarvisState.set(Status.ERROR, "Немає дозволу на мікрофон")
                return
            }
            ContextCompat.startForegroundService(ctx, Intent(ctx, JarvisService::class.java).setAction(ACTION_START))
        }

        fun stop(ctx: Context) {
            Prefs(ctx).enabled = false
            if (running) ctx.startService(Intent(ctx, JarvisService::class.java).setAction(ACTION_STOP))
        }

        fun reload(ctx: Context) {
            if (running) ctx.startService(Intent(ctx, JarvisService::class.java).setAction(ACTION_RELOAD))
        }
    }
}
