@file:Suppress("UNUSED_PARAMETER", "unused")
package android.util
object Log {
    @JvmStatic fun i(t: String, m: String): Int = 0
    @JvmStatic fun w(t: String, m: String): Int = 0
    @JvmStatic fun e(t: String, m: String): Int = 0
    @JvmStatic fun e(t: String, m: String, e: Throwable): Int = 0
}
object Base64 {
    const val DEFAULT = 0
    const val NO_WRAP = 2
    @JvmStatic fun decode(s: String, flags: Int): ByteArray = java.util.Base64.getDecoder().decode(s)
    @JvmStatic fun encodeToString(b: ByteArray, flags: Int): String = java.util.Base64.getEncoder().encodeToString(b)
}
