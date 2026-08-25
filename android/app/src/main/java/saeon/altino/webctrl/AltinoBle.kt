package saeon.altino.webctrl

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.util.Log
import android.webkit.JavascriptInterface
import org.json.JSONObject
import java.util.UUID

/**
 * 알티노 네오 — BLE(GATT) 브리지. 오케스트라(flutter_ble_lib) 방식과 동일하게
 * "페어링(본딩) 없이" 스캔 → 연결한다.
 *
 * JS 인터페이스(window.AltinoNative)는 클래식(AltinoSpp)과 동일 이름을 유지해
 * webapp/js/transport.js 가 그대로 동작한다. 추가로 스캔 API 제공:
 *   startScan() / stopScan() → window.__altinoOnScan('{"name":..,"address":..,"rssi":..}')
 *   connectTo(address) : BLE GATT 연결(본딩 X) → 서비스 탐색 → write+notify 특성 자동 선택
 *   sendFrame(b64) : write 특성으로 26바이트 프레임 전송(≤20B 청크)
 *   disconnect()
 * 수신 notify → window.__altinoOnData(base64) (기존 SensorFrameAssembler가 54B 정렬)
 */
class AltinoBle(
    private val context: Context,
    private val postToJs: (String) -> Unit,
    private val onOpenSettings: () -> Unit = {},
) {
    companion object {
        private const val TAG = "AltinoBle"
        private val CCCD: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
        // 알티노 특성 UUID를 알게 되면 여기에 못박으면 자동탐지보다 우선 사용된다.
        private val PREFERRED_WRITE: UUID? = null
        private val PREFERRED_NOTIFY: UUID? = null
        // 흔한 투명 UART 특성(자동탐지 우선순위 힌트)
        private val HINT_UUIDS = listOf(
            "0000ffe1-0000-1000-8000-00805f9b34fb", // HM-10 FFE1 (write+notify)
            "0000ffe0-0000-1000-8000-00805f9b34fb",
            "6e400002-b5a3-f393-e0a9-e50e24dcca9e", // Nordic UART TX(write)
            "6e400003-b5a3-f393-e0a9-e50e24dcca9e", // Nordic UART RX(notify)
        ).map { it.lowercase() }
    }

    private val adapter: BluetoothAdapter? = (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter
    private val main = Handler(Looper.getMainLooper())

    private var scanner: BluetoothLeScanner? = null
    private var scanCb: ScanCallback? = null
    @Volatile private var scanning = false
    private val seen = HashSet<String>()

    private var gatt: BluetoothGatt? = null
    private var writeCh: BluetoothGattCharacteristic? = null
    private var notifyCh: BluetoothGattCharacteristic? = null

    // ---------- 스캔 ----------
    @SuppressLint("MissingPermission")
    @JavascriptInterface
    fun startScan() {
        val a = adapter ?: return status("error:no-bluetooth")
        if (!a.isEnabled) return status("error:bluetooth-off")
        stopScan()
        seen.clear()
        scanner = a.bluetoothLeScanner ?: return status("error:no-scanner")
        val cb = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult) { handle(result) }
            override fun onBatchScanResults(results: MutableList<ScanResult>) { results.forEach { handle(it) } }
            override fun onScanFailed(errorCode: Int) { Log.e(TAG, "scan failed $errorCode"); status("error:scan-failed") }
            private fun handle(r: ScanResult) {
                val d = r.device ?: return
                val addr = d.address ?: return
                if (!seen.add(addr)) return
                val name = try { d.name } catch (e: SecurityException) { null } ?: r.scanRecord?.deviceName ?: ""
                // 이름 없는 잡다한 비콘은 숨기고, 알티노류만 노출(이름 미확인은 주소로 표시)
                val show = name.isNotBlank() || true
                if (show) pushScan(name, addr, r.rssi)
            }
        }
        scanCb = cb
        scanning = true
        // 저지연 스캔(부스에서 빠르게 뜨도록)
        val settings = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build()
        try {
            a.bondedDevices?.forEach { pushScan(it.name ?: "", it.address, 0) } // 이미 알던 것도 목록에
            scanner?.startScan(null, settings, cb)
            status("scanning")
        } catch (e: Exception) { Log.e(TAG, "startScan", e); status("error:scan-failed") }
    }

    @SuppressLint("MissingPermission")
    @JavascriptInterface
    fun stopScan() {
        scanning = false
        try { scanCb?.let { scanner?.stopScan(it) } } catch (e: Exception) {}
        scanCb = null
    }

    /** 클래식과 호환: 스캔을 시작만 하고 빈 배열 반환(결과는 __altinoOnScan 콜백). */
    @JavascriptInterface
    fun listDevices(): String { startScan(); return "[]" }

    private fun pushScan(name: String, address: String, rssi: Int) {
        val o = JSONObject().put("name", name).put("address", address).put("rssi", rssi)
        postToJs("window.__altinoOnScan && window.__altinoOnScan(${JSONObject.quote(o.toString())});")
    }

    // ---------- 연결 ----------
    @SuppressLint("MissingPermission")
    @JavascriptInterface
    fun connect() {
        // 페어링된 알티노가 있으면 그 주소로, 없으면 스캔.
        val a = adapter ?: return status("error:no-bluetooth")
        val bonded = try { a.bondedDevices?.toList() ?: emptyList() } catch (e: SecurityException) { emptyList() }
        val t = bonded.firstOrNull { (it.name ?: "").contains("altino", true) }
        if (t != null) connectTo(t.address) else startScan()
    }

    @SuppressLint("MissingPermission")
    @JavascriptInterface
    fun connectTo(address: String) {
        val a = adapter ?: return status("error:no-bluetooth")
        stopScan()
        closeGatt()
        val dev: BluetoothDevice = try { a.getRemoteDevice(address) } catch (e: IllegalArgumentException) { return status("error:bad-address") }
        status("connecting")
        // autoConnect=false 로 즉시 연결(본딩 없음)
        main.post {
            try {
                gatt = dev.connectGatt(context, false, gattCb, BluetoothDevice.TRANSPORT_LE)
            } catch (e: Exception) { Log.e(TAG, "connectGatt", e); status("error:connect-failed") }
        }
    }

    private val gattCb = object : BluetoothGattCallback() {
        @SuppressLint("MissingPermission")
        override fun onConnectionStateChange(g: BluetoothGatt, statusCode: Int, newState: Int) {
            if (newState == BluetoothGatt.STATE_CONNECTED) {
                try { g.requestMtu(247) } catch (e: Exception) { g.discoverServices() }
            } else if (newState == BluetoothGatt.STATE_DISCONNECTED) {
                closeGatt(); status("disconnected")
            }
        }
        @SuppressLint("MissingPermission")
        override fun onMtuChanged(g: BluetoothGatt, mtu: Int, statusCode: Int) {
            g.discoverServices()
        }
        @SuppressLint("MissingPermission")
        override fun onServicesDiscovered(g: BluetoothGatt, statusCode: Int) {
            if (statusCode != BluetoothGatt.GATT_SUCCESS) { status("error:no-services"); return }
            pickCharacteristics(g)
            val w = writeCh; val n = notifyCh
            if (w == null || n == null) { status("error:no-uart-char"); return }
            // notify 활성화(CCCD)
            try {
                g.setCharacteristicNotification(n, true)
                n.getDescriptor(CCCD)?.let { d ->
                    d.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                    g.writeDescriptor(d)
                }
            } catch (e: Exception) { Log.e(TAG, "enable notify", e) }
            status("connected")
        }
        override fun onCharacteristicChanged(g: BluetoothGatt, ch: BluetoothGattCharacteristic) {
            val v = ch.value ?: return
            val b64 = Base64.encodeToString(v, Base64.NO_WRAP)
            postToJs("window.__altinoOnData && window.__altinoOnData('$b64');")
        }
    }

    /** write(가능) 특성과 notify(가능) 특성을 자동 선택. 힌트 UUID 우선. */
    private fun pickCharacteristics(g: BluetoothGatt) {
        var w: BluetoothGattCharacteristic? = null
        var n: BluetoothGattCharacteristic? = null
        val writable = ArrayList<BluetoothGattCharacteristic>()
        val notifiable = ArrayList<BluetoothGattCharacteristic>()
        for (svc in g.services) {
            for (ch in svc.characteristics) {
                val p = ch.properties
                val canWrite = (p and (BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE)) != 0
                val canNotify = (p and (BluetoothGattCharacteristic.PROPERTY_NOTIFY or BluetoothGattCharacteristic.PROPERTY_INDICATE)) != 0
                if (canWrite) writable.add(ch)
                if (canNotify) notifiable.add(ch)
                val id = ch.uuid.toString().lowercase()
                if (PREFERRED_WRITE != null && ch.uuid == PREFERRED_WRITE) w = ch
                if (PREFERRED_NOTIFY != null && ch.uuid == PREFERRED_NOTIFY) n = ch
                if (w == null && canWrite && HINT_UUIDS.contains(id)) w = ch
                if (n == null && canNotify && HINT_UUIDS.contains(id)) n = ch
            }
        }
        // 힌트로 못 찾으면: write+notify 둘 다 되는 단일 특성(HM-10 FFE1형) 우선
        if (w == null || n == null) {
            val both = writable.firstOrNull { notifiable.contains(it) }
            if (both != null) { if (w == null) w = both; if (n == null) n = both }
        }
        if (w == null) w = writable.firstOrNull()
        if (n == null) n = notifiable.firstOrNull()
        writeCh = w; notifyCh = n
        Log.i(TAG, "picked write=${w?.uuid} notify=${n?.uuid}")
    }

    // ---------- 송신 ----------
    @SuppressLint("MissingPermission")
    @JavascriptInterface
    fun sendFrame(b64: String) {
        val g = gatt ?: return
        val ch = writeCh ?: return
        val data = try { Base64.decode(b64, Base64.DEFAULT) } catch (e: Exception) { return }
        // 기본 write type: 응답 없는 쓰기가 스트리밍에 유리
        ch.writeType = if ((ch.properties and BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0)
            BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE else BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
        try {
            // MTU가 충분하면 한 번에, 아니면 20B 청크로.
            ch.value = data
            if (!g.writeCharacteristic(ch)) {
                var off = 0
                while (off < data.size) {
                    val end = minOf(off + 20, data.size)
                    ch.value = data.copyOfRange(off, end)
                    g.writeCharacteristic(ch)
                    off = end
                }
            }
        } catch (e: Exception) { Log.e(TAG, "write", e) }
    }

    @JavascriptInterface
    fun disconnect() { stopScan(); closeGatt(); status("disconnected") }

    @JavascriptInterface
    fun openBluetoothSettings() { try { onOpenSettings() } catch (e: Exception) {} }

    @SuppressLint("MissingPermission")
    private fun closeGatt() {
        try { gatt?.disconnect() } catch (e: Exception) {}
        try { gatt?.close() } catch (e: Exception) {}
        gatt = null; writeCh = null; notifyCh = null
    }

    private fun status(s: String) {
        postToJs("window.__altinoOnStatus && window.__altinoOnStatus('$s');")
    }
}
