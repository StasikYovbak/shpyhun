package ua.jarvis.assistant.ui

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.RecyclerView
import ua.jarvis.assistant.R
import ua.jarvis.assistant.core.LogEntry
import ua.jarvis.assistant.databinding.ItemLogBinding
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Журнал останніх команд на головному екрані. */
class LogAdapter : RecyclerView.Adapter<LogAdapter.Holder>() {

    private var items: List<LogEntry> = emptyList()
    private val fmt = SimpleDateFormat("dd.MM HH:mm", Locale.getDefault())

    class Holder(val b: ItemLogBinding) : RecyclerView.ViewHolder(b.root)

    @android.annotation.SuppressLint("NotifyDataSetChanged") // максимум 20 рядків
    fun submit(list: List<LogEntry>) {
        items = list
        notifyDataSetChanged()
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) =
        Holder(ItemLogBinding.inflate(LayoutInflater.from(parent.context), parent, false))

    override fun getItemCount() = items.size

    override fun onBindViewHolder(h: Holder, position: Int) {
        val e = items[position]
        h.b.logTime.text = fmt.format(Date(e.time))
        h.b.logCommand.text = e.command.ifBlank { "—" }
        h.b.logResult.text = e.result
        val color = if (e.ok) R.color.jarvis_green else R.color.jarvis_red
        h.b.logDot.setBackgroundColor(ContextCompat.getColor(h.itemView.context, color))
    }
}
