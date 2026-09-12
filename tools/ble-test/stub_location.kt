@file:Suppress("UNUSED_PARAMETER", "unused")
package android.location
class LocationManager {
    companion object { const val GPS_PROVIDER = "gps"; const val NETWORK_PROVIDER = "network" }
    fun isProviderEnabled(p: String): Boolean = true
    val isLocationEnabled: Boolean get() = true
}
