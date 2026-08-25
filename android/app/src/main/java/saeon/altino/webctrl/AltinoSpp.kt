package saeon.altino.webctrl

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothSocket
import android.util.Base64
import android.util.Log
import android.webkit.JavascriptInterface
import org.json.JSONArray
import org.json.JSONObject
import java.io.InputStream
import java.io.OutputStream
import java.util.UUID

/**
 * 웹 UI(webapp) <-> 알티노 사이의 네이티브 다리.
 *
 * webapp/js/transport.js 의 AndroidBridgeTransport 와 짝을 이룬다:
 *   JS -> 네이티브 : AltinoNative.sendFrame(base64), connect(), disconnect(), listDevices(), connectTo(addr)
 *   네이티브 -> JS : window.__altinoOnData(base64), window.__altinoOnStatus(text)
 *
 * 통신 규격은 docs/PROTOCOL.md — 클래식 RFCOMM/SPP, 26바이트 송신 / 54바이트 수신.
 */
class AltinoSpp(private val postToJs: (String) -> Unit) {

    companion object {
        private const val TAG = "AltinoSpp"
        // 표준 SPP UUID (원본 앱과 동일)
        private val SPP_UUID: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
    }

    private val adapter: BluetoothAdapter? = BluetoothAdapter.getDefaultAdapter()
    @Volatile private var socket: BluetoothSocket? = null
    @Volatile private var out: OutputStream? = null
    private var readThread: Thread? = null

    // ---------- JS에서 호출되는 메서드들 ----------

    /** 페어링된 기기 중 알티노를 자동 선택해 연결. 이름에 altino 포함 우선, 없으면 첫 기기. */
    @SuppressLint("MissingPermission")
    @JavascriptInterface
    fun connect() {
        val a = adapter ?: return status("error:no-bluetooth")
        if (!a.isEnabled) return status("error:bluetooth-off")
        val bonded = try { a.bondedDevices?.toList() ?: emptyList() } catch (e: SecurityException) {
            return status("error:permission")
        }
        if (bonded.isEmpty()) return status("error:no-paired-device")
        val target = bonded.firstOrNull { (it.name ?: "").contains("altino", true) }
            ?: bonded.firstOrNull { (it.name ?: "").contains("neo", true) }
            ?: bonded.first()
        connectDevice(target)
    }

    /** 특정 MAC 주소로 연결 (JS의 기기 선택 UI에서 사용 가능). */
    @SuppressLint("MissingPermission")
    @JavascriptInterface
    fun connectTo(address: String) {
        val a = adapter ?: return status("error:no-bluetooth")
        try {
            connectDevice(a.getRemoteDevice(address))
        } catch (e: IllegalArgumentException) {
            status("error:bad-address")
        }
    }

    /** 페어링된 기기 목록을 JSON 문자열로 반환: [{"name":..,"address":..}] */
    @SuppressLint("MissingPermission")
    @JavascriptInterface
    fun listDevices(): String {
        val arr = JSONArray()
        try {
            adapter?.bondedDevices?.forEach { d ->
                arr.put(JSONObject().put("name", d.name ?: "").put("address", d.address))
            }
        } catch (e: SecurityException) { /* 권한 없음 */ }
        return arr.toString()
    }

    /** 26바이트 프레임(base64)을 로봇으로 전송. webapp이 50ms마다 호출. */
    @JavascriptInterface
    fun sendFrame(b64: String) {
        val o = out ?: return
        try {
            o.write(Base64.decode(b64, Base64.DEFAULT))
        } catch (e: Exception) {
            Log.e(TAG, "write failed", e)
            closeQuietly(); status("disconnected")
        }
    }

    @JavascriptInterface
    fun disconnect() { closeQuietly(); status("disconnected") }

    // ---------- 내부 ----------

    @SuppressLint("MissingPermission")
    private fun connectDevice(device: BluetoothDevice) {
        closeQuietly()
        Thread {
            try {
                adapter?.cancelDiscovery()
                val s = device.createRfcommSocketToServiceRecord(SPP_UUID)
                s.connect()                     // 블로킹
                socket = s
                out = s.outputStream
                status("connected")
                startReadLoop(s.inputStream)
            } catch (e: Exception) {
                Log.e(TAG, "connect failed", e)
                closeQuietly()
                status("error:connect-failed")
            }
        }.also { it.isDaemon = true; it.start() }
    }

    private fun startReadLoop(input: InputStream) {
        readThread = Thread {
            val buf = ByteArray(256)
            try {
                while (socket?.isConnected == true) {
                    val n = input.read(buf)
                    if (n <= 0) continue
                    val chunk = buf.copyOf(n)
                    // 원시 바이트를 그대로 JS로 전달 → JS의 SensorFrameAssembler가 54B 프레임 정렬
                    val b64 = Base64.encodeToString(chunk, Base64.NO_WRAP)
                    postToJs("window.__altinoOnData && window.__altinoOnData('$b64');")
                }
            } catch (e: Exception) {
                Log.e(TAG, "read loop ended", e)
            } finally {
                closeQuietly(); status("disconnected")
            }
        }.also { it.isDaemon = true; it.start() }
    }

    private fun status(s: String) {
        postToJs("window.__altinoOnStatus && window.__altinoOnStatus('$s');")
    }

    private fun closeQuietly() {
        try { out?.close() } catch (_: Exception) {}
        try { socket?.close() } catch (_: Exception) {}
        out = null; socket = null
    }
}
