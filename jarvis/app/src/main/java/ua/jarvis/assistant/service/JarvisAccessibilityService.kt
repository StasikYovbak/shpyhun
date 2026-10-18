package ua.jarvis.assistant.service

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.graphics.Rect
import android.os.Bundle
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import ua.jarvis.assistant.text.TextNorm

/**
 * Служба спеціальних можливостей: «очі й руки» Джарвіса в інших програмах.
 *  - читає, що зараз на екрані (кнопки, поля, тексти);
 *  - натискає, вводить текст, прокручує, тисне «Назад» / «Додому»;
 *  - а ще дає Android-винятковий дозвіл відкривати програми з фону.
 *
 * Вмикається вручну: Налаштування → Спеціальні можливості → Джарвіс.
 */
class JarvisAccessibilityService : AccessibilityService() {

    /** Один елемент екрана, як його бачить Claude. */
    data class Element(val index: Int, val node: AccessibilityNodeInfo, val description: String)

    data class Snapshot(val pkg: String, val elements: List<Element>) {
        fun toText(): String = buildString {
            append("Відкрита програма: ").append(pkg).append('\n')
            if (elements.isEmpty()) append("(на екрані немає елементів, які можна прочитати)")
            elements.forEach { append('[').append(it.index).append("] ").append(it.description).append('\n') }
        }
    }

    @Volatile var foregroundPackage: String = ""
        private set

    private var last: Snapshot? = null

    override fun onServiceConnected() {
        instance = this
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event?.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
            event.packageName?.toString()?.let { if (it.isNotBlank()) foregroundPackage = it }
        }
    }

    override fun onInterrupt() {}

    override fun onDestroy() {
        if (instance === this) instance = null
        super.onDestroy()
    }

    // ------------------------------------------------------------ читання екрана

    fun snapshot(maxElements: Int = 70): Snapshot {
        val root = rootInActiveWindow
        val list = mutableListOf<Element>()
        if (root != null) collect(root, list, maxElements, 0)
        val snap = Snapshot(root?.packageName?.toString() ?: foregroundPackage, list)
        last = snap
        return snap
    }

    private fun collect(node: AccessibilityNodeInfo, out: MutableList<Element>, max: Int, depth: Int) {
        if (out.size >= max || depth > 40) return
        if (node.isVisibleToUser) {
            val text = node.text?.toString().orEmpty().replace('\n', ' ').trim()
            val desc = node.contentDescription?.toString().orEmpty().replace('\n', ' ').trim()
            val hint = node.hintText?.toString().orEmpty().trim()
            val label = listOf(text, desc).filter { it.isNotEmpty() }.distinct().joinToString(" / ")
            val interesting = node.isClickable || node.isEditable || node.isScrollable || node.isCheckable || label.isNotEmpty()
            if (interesting && (label.isNotEmpty() || node.isEditable || node.isScrollable)) {
                @Suppress("DEPRECATION") // isChecked замінено на getChecked() лише в Android 16
                val kind = when {
                    node.isEditable -> "поле вводу"
                    node.isCheckable -> if (node.isChecked) "перемикач (увімкнено)" else "перемикач (вимкнено)"
                    node.isClickable -> "кнопка"
                    node.isScrollable -> "список (можна прокрутити)"
                    else -> "текст"
                }
                val shown = label.take(80).ifEmpty { if (hint.isNotEmpty()) "підказка: ${hint.take(60)}" else "" }
                out += Element(out.size + 1, node, "$kind «$shown»")
            }
        }
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            collect(child, out, max, depth + 1)
            if (out.size >= max) return
        }
    }

    private fun element(index: Int): AccessibilityNodeInfo? = last?.elements?.firstOrNull { it.index == index }?.node

    fun describe(index: Int): String? = last?.elements?.firstOrNull { it.index == index }?.description

    // ------------------------------------------------------------ дії

    fun click(index: Int): Boolean {
        var node = element(index) ?: return false
        node.refresh()
        var hops = 0
        while (!node.isClickable && hops < 6) {
            node = node.parent ?: break
            hops++
        }
        if (node.isClickable && node.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return true
        return tapCenter(node)
    }

    /** Натиснути елемент, у тексті якого є [text] (якщо Claude назвав кнопку словами). */
    fun clickText(text: String): Boolean {
        val snap = snapshot()
        val want = TextNorm.normalize(text)
        val hit = snap.elements.firstOrNull { TextNorm.normalize(it.description).contains(want) } ?: return false
        return click(hit.index)
    }

    fun type(index: Int?, text: String): Boolean {
        val target = index?.let { element(it) }
            ?: rootInActiveWindow?.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
            ?: last?.elements?.firstOrNull { it.node.isEditable }?.node
            ?: return false
        target.refresh()
        if (!target.isFocused) target.performAction(AccessibilityNodeInfo.ACTION_FOCUS)
        val args = Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
        }
        return target.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
    }

    fun scroll(down: Boolean): Boolean {
        val root = rootInActiveWindow ?: return false
        val scrollable = findScrollable(root)
        val action = if (down) AccessibilityNodeInfo.ACTION_SCROLL_FORWARD else AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD
        if (scrollable != null && scrollable.performAction(action)) return true
        // запасний варіант — жест пальцем
        val dm = resources.displayMetrics
        val x = dm.widthPixels / 2f
        val (y1, y2) = if (down) dm.heightPixels * 0.75f to dm.heightPixels * 0.3f else dm.heightPixels * 0.3f to dm.heightPixels * 0.75f
        return swipe(x, y1, x, y2)
    }

    private fun findScrollable(node: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        if (node.isScrollable && node.isVisibleToUser) return node
        for (i in 0 until node.childCount) {
            val c = node.getChild(i) ?: continue
            findScrollable(c)?.let { return it }
        }
        return null
    }

    fun global(name: String): Boolean {
        val action = when (name) {
            "back" -> GLOBAL_ACTION_BACK
            "home" -> GLOBAL_ACTION_HOME
            "recents" -> GLOBAL_ACTION_RECENTS
            "notifications" -> GLOBAL_ACTION_NOTIFICATIONS
            "quick_settings" -> GLOBAL_ACTION_QUICK_SETTINGS
            "lock" -> GLOBAL_ACTION_LOCK_SCREEN
            "screenshot" -> GLOBAL_ACTION_TAKE_SCREENSHOT
            else -> return false
        }
        return performGlobalAction(action)
    }

    private fun tapCenter(node: AccessibilityNodeInfo): Boolean {
        val r = Rect()
        node.getBoundsInScreen(r)
        if (r.isEmpty) return false
        val p = Path().apply { moveTo(r.exactCenterX(), r.exactCenterY()) }
        return dispatchGesture(GestureDescription.Builder().addStroke(GestureDescription.StrokeDescription(p, 0, 60)).build(), null, null)
    }

    private fun swipe(x1: Float, y1: Float, x2: Float, y2: Float): Boolean {
        val p = Path().apply { moveTo(x1, y1); lineTo(x2, y2) }
        return dispatchGesture(GestureDescription.Builder().addStroke(GestureDescription.StrokeDescription(p, 0, 350)).build(), null, null)
    }

    companion object {
        @Volatile var instance: JarvisAccessibilityService? = null
            private set
    }
}
