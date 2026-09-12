@file:Suppress("UNUSED_PARAMETER", "unused")
package android.content
abstract class BroadcastReceiver { abstract fun onReceive(c: Context?, i: Intent?) }
class Intent(val action: String? = null) {
    private val ex = HashMap<String, Int>()
    fun putExtra(k: String, v: Int): Intent { ex[k] = v; return this }
    fun getIntExtra(k: String, d: Int): Int = ex[k] ?: d
}
class IntentFilter(val action: String? = null)
interface SharedPreferences {
    fun getString(k: String, d: String?): String?
    fun edit(): Editor
    interface Editor { fun putString(k: String, v: String?): Editor; fun remove(k: String): Editor; fun apply() }
}
open class Context {
    companion object { const val BLUETOOTH_SERVICE = "bluetooth"; const val LOCATION_SERVICE = "location"; const val MODE_PRIVATE = 0 }
    private val prefs = HashMap<String, MemPrefs>()
    var registered: BroadcastReceiver? = null
    open fun getSystemService(name: String): Any? = null
    fun getSharedPreferences(n: String, mode: Int): SharedPreferences = prefs.getOrPut(n) { MemPrefs() }
    fun registerReceiver(r: BroadcastReceiver?, f: IntentFilter?): Intent? { registered = r; return null }
    fun unregisterReceiver(r: BroadcastReceiver?) { registered = null }
    val packageName: String get() = "test"
    val packageManager: PackageManager get() = PackageManager()
}
class MemPrefs : SharedPreferences {
    private val m = HashMap<String, String?>()
    override fun getString(k: String, d: String?): String? = if (m.containsKey(k)) m[k] else d
    override fun edit(): SharedPreferences.Editor = object : SharedPreferences.Editor {
        override fun putString(k: String, v: String?): SharedPreferences.Editor { m[k] = v; return this }
        override fun remove(k: String): SharedPreferences.Editor { m.remove(k); return this }
        override fun apply() {}
    }
}

class PackageInfo { @JvmField var versionName: String? = "1.0.0"; @JvmField var versionCode: Int = 1
    val longVersionCode: Long get() = versionCode.toLong() }
class PackageManager { fun getPackageInfo(n: String, f: Int): PackageInfo = PackageInfo() }
