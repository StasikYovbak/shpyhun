package ua.jarvis.assistant.actions

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.provider.ContactsContract.CommonDataKinds.Phone
import androidx.core.content.ContextCompat
import ua.jarvis.assistant.text.NameMatch

data class Contact(val name: String, val number: String)

/** Пошук контакту за сказаним іменем, навіть у відмінку («мамі», «олегу»). */
class ContactFinder(context: Context) {

    private val ctx = context.applicationContext

    fun hasPermission() =
        ContextCompat.checkSelfPermission(ctx, Manifest.permission.READ_CONTACTS) == PackageManager.PERMISSION_GRANTED

    /** Усі контакти з номером. Для кожного імені — основний (або мобільний) номер. */
    fun all(): List<Contact> {
        if (!hasPermission()) return emptyList()
        data class Row(val name: String, val number: String, val primary: Boolean, val mobile: Boolean)
        val rows = mutableListOf<Row>()
        ctx.contentResolver.query(
            Phone.CONTENT_URI,
            arrayOf(Phone.DISPLAY_NAME, Phone.NUMBER, Phone.IS_SUPER_PRIMARY, Phone.TYPE),
            null, null, null,
        )?.use { c ->
            val iName = c.getColumnIndexOrThrow(Phone.DISPLAY_NAME)
            val iNum = c.getColumnIndexOrThrow(Phone.NUMBER)
            val iPrim = c.getColumnIndexOrThrow(Phone.IS_SUPER_PRIMARY)
            val iType = c.getColumnIndexOrThrow(Phone.TYPE)
            while (c.moveToNext()) {
                val name = c.getString(iName) ?: continue
                val num = c.getString(iNum) ?: continue
                rows += Row(name, num, c.getInt(iPrim) == 1, c.getInt(iType) == Phone.TYPE_MOBILE)
            }
        }
        return rows.groupBy { it.name }.map { (name, list) ->
            val best = list.firstOrNull { it.primary } ?: list.firstOrNull { it.mobile } ?: list.first()
            Contact(name, best.number)
        }
    }

    fun find(spoken: String, contacts: List<Contact> = all()): Pair<Contact, Double>? =
        contacts.map { it to NameMatch.score(spoken, it.name) }
            .maxByOrNull { it.second }
            ?.takeIf { it.second >= NameMatch.CONTACT_THRESHOLD }
}
