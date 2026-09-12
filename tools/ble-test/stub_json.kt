@file:Suppress("UNUSED_PARAMETER", "unused")
package org.json
class JSONObject {
    private val m = LinkedHashMap<String, Any?>()
    fun put(k: String, v: Any?): JSONObject { m[k] = v; return this }
    override fun toString(): String = m.entries.joinToString(",", "{", "}") { (k, v) ->
        "\"$k\":" + when (v) { is String -> quote(v); null -> "null"; else -> v.toString() }
    }
    companion object { @JvmStatic fun quote(s: String): String = "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"") + "\"" }
}
