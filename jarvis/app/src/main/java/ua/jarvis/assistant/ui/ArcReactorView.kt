package ua.jarvis.assistant.ui

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.BlurMaskFilter
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import android.util.AttributeSet
import android.view.View
import android.view.animation.LinearInterpolator
import ua.jarvis.assistant.core.Status
import kotlin.math.min
import kotlin.math.sin

/**
 * «Дуговий реактор» Залізної людини як індикатор стану:
 * тьмяний — вимкнено, спокійна пульсація — слухаю, яскраво й швидко — записую команду,
 * обертання — виконую, бурштиновий — чекаю «так/ні», червоний — помилка.
 */
class ArcReactorView @JvmOverloads constructor(
    context: Context, attrs: AttributeSet? = null,
) : View(context, attrs) {

    var state: Status = Status.OFF
        set(value) {
            field = value
            invalidate()
        }

    private var phase = 0f
    private var rotation = 0f
    private val animator = ValueAnimator.ofFloat(0f, 1f).apply {
        duration = 1000
        repeatCount = ValueAnimator.INFINITE
        interpolator = LinearInterpolator()
        addUpdateListener {
            val speed = when (state) {
                Status.RECORDING -> 3.2f
                Status.EXECUTING, Status.LOADING -> 2.0f
                Status.CONFIRMING -> 1.6f
                Status.LISTENING -> 0.8f
                else -> 0.25f
            }
            phase += 0.016f * speed
            rotation = (rotation + speed * 1.2f) % 360f
            invalidate()
        }
    }

    private val glow = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
    private val line = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
    private val core = Paint(Paint.ANTI_ALIAS_FLAG)
    private val rect = RectF()
    private var shaderColor = 0

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        val r = min(w, h) / 2f * 0.86f
        if (r > 0) glow.maskFilter = BlurMaskFilter(r * 0.12f, BlurMaskFilter.Blur.NORMAL)
        shaderColor = 0 // центр змінився — градієнт треба перебудувати
    }

    private fun colorFor(s: Status) = when (s) {
        Status.OFF -> Color.rgb(60, 90, 110)
        Status.LOADING -> Color.rgb(120, 200, 255)
        Status.LISTENING -> Color.rgb(0, 229, 255)
        Status.RECORDING -> Color.rgb(140, 255, 255)
        Status.CONFIRMING -> Color.rgb(255, 196, 0)
        Status.EXECUTING -> Color.rgb(64, 160, 255)
        Status.ERROR -> Color.rgb(255, 82, 82)
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        animator.start()
    }

    override fun onDetachedFromWindow() {
        animator.cancel()
        super.onDetachedFromWindow()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val cx = width / 2f
        val cy = height / 2f
        val r = min(width, height) / 2f * 0.86f
        val color = colorFor(state)
        val pulse = when (state) {
            Status.OFF -> 0.25f
            Status.RECORDING -> 0.75f + 0.25f * sin(phase * 6f)
            else -> 0.6f + 0.2f * sin(phase * 3f)
        }
        val alpha = (255 * pulse).toInt().coerceIn(40, 255)

        // Зовнішнє світіння
        glow.color = color
        glow.alpha = (alpha * 0.55f).toInt()
        glow.strokeWidth = r * 0.10f
        canvas.drawCircle(cx, cy, r, glow)

        // Зовнішнє кільце
        line.color = color
        line.alpha = alpha
        line.strokeWidth = r * 0.025f
        line.maskFilter = null
        canvas.drawCircle(cx, cy, r, line)
        canvas.drawCircle(cx, cy, r * 0.93f, line.apply { strokeWidth = r * 0.01f; this.alpha = (alpha * 0.6f).toInt() })

        // Сегменти, що обертаються (як котушки реактора)
        canvas.save()
        canvas.rotate(rotation, cx, cy)
        val segments = 10
        val ri = r * 0.62f
        val ro = r * 0.84f
        val mid = (ri + ro) / 2
        rect.set(cx - mid, cy - mid, cx + mid, cy + mid)
        line.strokeWidth = ro - ri
        line.alpha = (alpha * 0.8f).toInt()
        val sweep = 360f / segments
        for (i in 0 until segments) canvas.drawArc(rect, i * sweep + 4f, sweep - 8f, false, line)
        canvas.restore()

        // Внутрішнє кільце у протилежний бік
        canvas.save()
        canvas.rotate(-rotation * 1.5f, cx, cy)
        line.strokeWidth = r * 0.02f
        line.alpha = alpha
        val r2 = r * 0.50f
        rect.set(cx - r2, cy - r2, cx + r2, cy + r2)
        for (i in 0 until 3) canvas.drawArc(rect, i * 120f, 80f, false, line)
        canvas.restore()

        // Ядро (градієнт перебудовуємо лише при зміні кольору)
        val coreMax = r * 0.36f
        if (color != shaderColor) {
            shaderColor = color
            core.shader = RadialGradient(
                cx, cy, coreMax,
                intArrayOf(Color.WHITE, color, Color.argb(0, Color.red(color), Color.green(color), Color.blue(color))),
                floatArrayOf(0f, 0.45f, 1f), Shader.TileMode.CLAMP,
            )
        }
        core.alpha = alpha.coerceAtLeast(90)
        canvas.drawCircle(cx, cy, coreMax * (0.92f + 0.08f * pulse), core)
    }
}
