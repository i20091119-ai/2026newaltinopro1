@file:Suppress("UNUSED_PARAMETER", "unused")
package android.bluetooth.le
import android.bluetooth.BluetoothDevice
class ScanRecord { val deviceName: String? = null }
class ScanResult(val device: BluetoothDevice, val rssi: Int) { val scanRecord: ScanRecord? = null }
abstract class ScanCallback {
    open fun onScanResult(type: Int, r: ScanResult) {}
    open fun onBatchScanResults(rs: MutableList<ScanResult>) {}
    open fun onScanFailed(err: Int) {}
}
class ScanSettings private constructor() {
    companion object { const val SCAN_MODE_BALANCED = 1; const val CALLBACK_TYPE_ALL_MATCHES = 1 }
    class Builder {
        fun setScanMode(m: Int): Builder = this
        fun setCallbackType(t: Int): Builder = this
        fun setReportDelay(d: Long): Builder = this
        fun build(): ScanSettings = ScanSettings()
    }
}
class BluetoothLeScanner {
    fun startScan(filters: List<Any?>?, settings: ScanSettings?, cb: ScanCallback) {}
    fun stopScan(cb: ScanCallback) {}
}
