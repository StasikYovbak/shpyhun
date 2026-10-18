package ua.jarvis.assistant.actions

import android.Manifest
import android.app.SearchManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.media.AudioManager
import android.net.Uri
import android.os.BatteryManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.AlarmClock
import android.telecom.TelecomManager
import android.telephony.SmsManager
import android.util.Log
import androidx.core.content.ContextCompat
import kotlin.math.roundToInt

/** Дії з телефоном: ліхтарик, гучність, батарея, будильник, дзвінки, SMS, карти, пошук. */
class DeviceControl(context: Context, private val launcher: Launcher) {

    private val ctx = context.applicationContext
    private val audio = ctx.getSystemService(AudioManager::class.java)
    private val camera = ctx.getSystemService(CameraManager::class.java)

    // ------------------------------------------------------------ ліхтарик
    // Дозвіл CAMERA для ліхтарика НЕ потрібен: setTorchMode працює без нього.

    @Volatile private var torchOn = false

    private val torchId: String? by lazy {
        runCatching {
            val ids = camera.cameraIdList
            ids.firstOrNull {
                val c = camera.getCameraCharacteristics(it)
                c.get(CameraCharacteristics.FLASH_INFO_AVAILABLE) == true &&
                    c.get(CameraCharacteristics.LENS_FACING) == CameraCharacteristics.LENS_FACING_BACK
            } ?: ids.firstOrNull { camera.getCameraCharacteristics(it).get(CameraCharacteristics.FLASH_INFO_AVAILABLE) == true }
        }.getOrNull()
    }

    private val torchCallback = object : CameraManager.TorchCallback() {
        override fun onTorchModeChanged(cameraId: String, enabled: Boolean) {
            if (cameraId == torchId) torchOn = enabled
        }
    }

    init {
        runCatching { camera.registerTorchCallback(torchCallback, Handler(Looper.getMainLooper())) }
    }

    fun isTorchOn() = torchOn

    fun setTorch(on: Boolean): Boolean {
        val id = torchId ?: return false
        return try {
            camera.setTorchMode(id, on)
            torchOn = on
            true
        } catch (e: Exception) {
            Log.w(TAG, "torch", e)
            false
        }
    }

    // ------------------------------------------------------------ гучність

    fun volumePercent(): Int {
        val max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
        return (audio.getStreamVolume(AudioManager.STREAM_MUSIC) * 100.0 / max).roundToInt()
    }

    /** Гучність мультимедіа у відсотках. Повертає фактично встановлене значення. */
    fun setVolumePercent(percent: Int): Int {
        val max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
        val index = (percent.coerceIn(0, 100) / 100.0 * max).roundToInt()
        audio.setStreamVolume(AudioManager.STREAM_MUSIC, index, AudioManager.FLAG_SHOW_UI)
        return (index * 100.0 / max).roundToInt()
    }

    // ------------------------------------------------------------ батарея

    data class Battery(val percent: Int, val charging: Boolean)

    fun battery(): Battery {
        val bm = ctx.getSystemService(BatteryManager::class.java)
        return Battery(bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY), bm.isCharging)
    }

    // ------------------------------------------------------------ будильник і таймер

    fun setAlarm(hour: Int, minute: Int): Launcher.Outcome = launcher.start(
        Intent(AlarmClock.ACTION_SET_ALARM)
            .putExtra(AlarmClock.EXTRA_HOUR, hour)
            .putExtra(AlarmClock.EXTRA_MINUTES, minute)
            .putExtra(AlarmClock.EXTRA_MESSAGE, "Джарвіс")
            .putExtra(AlarmClock.EXTRA_SKIP_UI, true),
        "Будильник на %d:%02d".format(hour, minute),
    )

    fun setTimer(seconds: Int): Launcher.Outcome = launcher.start(
        Intent(AlarmClock.ACTION_SET_TIMER)
            .putExtra(AlarmClock.EXTRA_LENGTH, seconds.coerceIn(1, 86_400))
            .putExtra(AlarmClock.EXTRA_MESSAGE, "Джарвіс")
            .putExtra(AlarmClock.EXTRA_SKIP_UI, true),
        "Таймер",
    )

    // ------------------------------------------------------------ дзвінки й SMS

    private fun granted(p: String) = ContextCompat.checkSelfPermission(ctx, p) == PackageManager.PERMISSION_GRANTED

    /**
     * Дзвінок через системний TelecomManager — працює навіть із заблокованого екрана
     * і з фону (на відміну від запуску екрана набору).
     */
    fun call(number: String): Launcher.Outcome {
        val uri = Uri.fromParts("tel", number, null)
        if (granted(Manifest.permission.CALL_PHONE)) {
            try {
                ctx.getSystemService(TelecomManager::class.java).placeCall(uri, Bundle())
                return Launcher.Outcome.STARTED
            } catch (e: SecurityException) {
                Log.w(TAG, "placeCall", e)
            }
        }
        return launcher.start(Intent(Intent.ACTION_DIAL, uri), "Дзвінок $number")
    }

    /** true — надіслано; false — немає дозволу (тоді відкриваємо програму SMS із текстом). */
    fun sendSms(number: String, text: String): Boolean {
        if (!granted(Manifest.permission.SEND_SMS)) {
            launcher.start(
                Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:" + Uri.encode(number))).putExtra("sms_body", text),
                "SMS для $number",
            )
            return false
        }
        val sms: SmsManager = if (Build.VERSION.SDK_INT >= 31) {
            ctx.getSystemService(SmsManager::class.java)
        } else {
            @Suppress("DEPRECATION")
            SmsManager.getDefault()
        }
        val parts = sms.divideMessage(text)
        if (parts.size > 1) sms.sendMultipartTextMessage(number, null, parts, null, null)
        else sms.sendTextMessage(number, null, text, null, null)
        return true
    }

    // ------------------------------------------------------------ карти, пошук, програми

    fun navigate(destination: String): Launcher.Outcome {
        val nav = Intent(Intent.ACTION_VIEW, Uri.parse("google.navigation:q=" + Uri.encode(destination)))
            .setPackage(MAPS)
        val r = launcher.start(nav, "Маршрут до $destination")
        if (r != Launcher.Outcome.NOT_FOUND) return r
        return launcher.start(
            Intent(Intent.ACTION_VIEW, Uri.parse("https://www.google.com/maps/dir/?api=1&destination=" + Uri.encode(destination))),
            "Маршрут до $destination",
        )
    }

    fun webSearch(query: String): Launcher.Outcome {
        val r = launcher.start(Intent(Intent.ACTION_WEB_SEARCH).putExtra(SearchManager.QUERY, query), "Пошук: $query")
        if (r != Launcher.Outcome.NOT_FOUND) return r
        return openUrl("https://www.google.com/search?q=" + Uri.encode(query), "Пошук: $query")
    }

    fun openUrl(url: String, title: String = url): Launcher.Outcome {
        val fixed = if (url.startsWith("http://") || url.startsWith("https://")) url else "https://$url"
        return launcher.start(Intent(Intent.ACTION_VIEW, Uri.parse(fixed)), title)
    }

    fun openApp(app: InstalledApp): Launcher.Outcome {
        val intent = ctx.packageManager.getLaunchIntentForPackage(app.pkg) ?: return Launcher.Outcome.NOT_FOUND
        return launcher.start(intent, app.label)
    }

    /** Відтворення конкретного відео: застосунок YouTube одразу запускає його. */
    fun playYouTube(videoId: String, title: String): Launcher.Outcome {
        val url = Uri.parse("https://www.youtube.com/watch?v=$videoId")
        val app = Intent(Intent.ACTION_VIEW, url).setPackage(YOUTUBE)
        val r = launcher.start(app, title)
        if (r != Launcher.Outcome.NOT_FOUND) return r
        return launcher.start(Intent(Intent.ACTION_VIEW, url), title)
    }

    /** Без ключа API можемо лише відкрити пошук у YouTube. */
    fun youTubeSearch(query: String): Launcher.Outcome {
        val r = launcher.start(
            Intent(Intent.ACTION_SEARCH).setPackage(YOUTUBE).putExtra(SearchManager.QUERY, query),
            "YouTube: $query",
        )
        if (r != Launcher.Outcome.NOT_FOUND) return r
        return openUrl("https://www.youtube.com/results?search_query=" + Uri.encode(query), "YouTube: $query")
    }

    fun release() {
        runCatching { camera.unregisterTorchCallback(torchCallback) }
    }

    companion object {
        private const val TAG = "DeviceControl"
        const val YOUTUBE = "com.google.android.youtube"
        const val MAPS = "com.google.android.apps.maps"
    }
}
