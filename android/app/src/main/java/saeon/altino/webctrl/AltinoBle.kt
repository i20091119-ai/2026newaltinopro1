package saeon.altino.webctrl

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.BluetoothStatusCodes
import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.location.LocationManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Base64
import android.util.Log
import android.webkit.JavascriptInterface
import org.json.JSONObject
import java.util.UUID
import kotlin.random.Random

/**
 * 알티노 네오 — BLE(GATT) 브리지. 페어링(본딩) 없이 스캔→연결(ISSC 투명 UART).
 *
 * 부스 12대 동시운영 안정화(재작성):
 *  - GATT 직렬 큐 + 코얼레싱(최신 프레임만) + 콜백 기반 완료대기 + 2초 워치독
 *  - CCCD 쓰기 완료 후에야 connected 발행
 *  - 상태코드(8/19/133)별 처리 + '포기 없는' 재연결(2회부터 autoConnect=true, OS 배경 재연결)
 *  - MAC 바인딩: 한 번 고른 로봇만 저장/재연결(다른 로봇에 안 붙음), 페이지 이동 시 연결 유지
 *  - 스캔: 필터 없이 스캔→이름 접두 선별(UUID 미광고 로봇도 발견) + BALANCED + 10초 자동정지
 *
 * JS 인터페이스(window.AltinoNative):
 *   startScan()/stopScan()/listDevices()  → __altinoOnScan({name,address,rssi})
 *   connectTo(address)  특정 로봇에 연결(그 MAC으로 바인딩)
 *   getState()          {"connected":bool,"address":..,"name":..}  (페이지 진입 시 조회)
 *   unbind()            바인딩 해제 + 연결 종료(‘다른 로봇 선택’)
 *   sendFrame(b64):Boolean   26바이트 프레임(코얼레싱)
 *   disconnect()        수동 종료(자동 재연결 안 함)
 *   openBluetoothSettings()
 * 수신 notify → __altinoOnData(base64)
 */
class AltinoBle(
    private val context: Context,
    private val postToJs: (String) -> Unit,
    private val onOpenSettings: () -> Unit = {},
) {
    companion object {
        private const val TAG = "AltinoBle"
        private const val PREFS = "altino_ble"
        private const val KEY_ADDR = "bound_addr"
        private const val KEY_NAME = "bound_name"
        private val CCCD: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
        // 오케스트라(orchestra2) libapp.so에서 확정: ISSC 투명 UART
        private val SVC_UART: UUID = UUID.fromString("49535343-fe7d-4ae5-8fa9-9fafd205e455")
        private val PREFERRED_WRITE: UUID = UUID.fromString("49535343-8841-43f4-a8d4-ecbe34729bb3")  // 앱→로봇
        private val PREFERRED_NOTIFY: UUID = UUID.fromString("49535343-1e4d-4bd9-ba61-23c647249616") // 로봇→앱
        private val HINT_UUIDS = listOf(
            "49535343-8841-43f4-a8d4-ecbe34729bb3",
            "49535343-1e4d-4bd9-ba61-23c647249616",
            "0000ffe1-0000-1000-8000-00805f9b34fb", // HM-10 FFE1
            "6e400002-b5a3-f393-e0a9-e50e24dcca9e", // Nordic UART TX
            "6e400003-b5a3-f393-e0a9-e50e24dcca9e", // Nordic UART RX
        ).map { it.lowercase() }
        private val NAME_PREFIXES = listOf(
            "ALTINO-NEO", "ALTINO-LITE", "ALTINO-N", "ALTINO-L", "ALTINO", "SMARTFARM", "REALFARM"
        )
        private const val SCAN_MS = 10_000L      // 10초 후 자동 정지
        private const val SCAN_MIN_GAP = 6_000L  // startScan 최소 간격(30초/5회 스로틀 회피)
        private const val CLOSE_SETTLE_MS = 600L // close 후 재연결 최소 대기
        private const val OP_TIMEOUT_MS = 2_000L
        private const val CONNECT_DEADLINE_MS = 12_000L   // 연결 절차 전체 기한
    }

    private val adapter: BluetoothAdapter? = (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter
    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private val main = Handler(Looper.getMainLooper())

    // ---- 스캔 ----
    private var scanner: BluetoothLeScanner? = null
    private var scanCb: ScanCallback? = null
    @Volatile private var scanning = false
    private var lastScanStart = 0L
    // @JavascriptInterface 는 WebView의 JavaBridge 스레드에서, ScanCallback 은 메인 스레드에서
    // 같은 집합을 만진다 → 동기화 필요(미동기화 시 기기 누락 또는 해시맵 경합).
    private val seen = java.util.Collections.synchronizedSet(HashSet<String>())
    private val scanStopRunnable = Runnable { stopScan() }

    // ---- 연결/큐 ----
    // GATT 콜백은 바인더 스레드에서 온다 → 메인 스레드가 대입한 값이 보이도록 @Volatile 필수.
    // (이게 없으면 연결됐는데도 gatt 가 null 로 보여 큐가 멈춘 채 '연결 중'에서 영영 안 넘어간다)
    @Volatile private var gatt: BluetoothGatt? = null
    @Volatile private var writeCh: BluetoothGattCharacteristic? = null
    @Volatile private var notifyCh: BluetoothGattCharacteristic? = null
    @Volatile private var isConnected = false
    // 연결 절차(연결→MTU→탐색→CCCD)가 진행 중. 이 구간에는 isConnected 가 아직 false 라서
    // 재연결 타이머가 끼어들어 멀쩡한 핸드셰이크를 부수던 문제가 있었다.
    @Volatile private var connecting = false
    @Volatile private var negotiatedMtu = 23
    private var lastCloseAt = 0L

    @Volatile private var boundAddress: String? = prefs.getString(KEY_ADDR, null)
    @Volatile private var boundName: String? = prefs.getString(KEY_NAME, null)
    @Volatile private var wantConnect = false     // 자동 재연결 희망 여부(수동 disconnect 시 false)
    @Volatile private var reconnectAttempts = 0
    // 재연결 예약은 반드시 이 하나만 사용한다(매번 새 람다를 postDelayed 하면 취소가 불가능해
    // 여러 개가 쌓이고, 그중 하나가 성공 직전의 연결을 닫아버린다).
    private var reconnectRunnable: Runnable? = null

    // GATT 직렬 큐
    private sealed class Op {
        class Write(val ch: BluetoothGattCharacteristic, val data: ByteArray) : Op()
        class Descriptor(val d: BluetoothGattDescriptor, val data: ByteArray) : Op()
        object Mtu : Op()
        object Discover : Op()
    }
    private val ops = ArrayDeque<Op>()
    private var busy = false
    private var pendingFrame: ByteArray? = null
    // ⚠ 워치독이 한 번 '건너뛰기'를 하면, 그 op 의 진짜 콜백이 뒤늦게 도착한다.
    //   예전엔 그 늦은 콜백이 opDone() 을 불러 '지금 진행 중인 다른 op' 를 완료 처리해 버렸다
    //   → 큐가 한 칸 앞질러 나가면서 두 op 가 동시에 떠 있게 되고, 스택이 뒤엣것을 버린다.
    //   (조향 프레임이 가끔 씹히던 경로) 건너뛴 횟수를 세어 늦은 콜백을 삼킨다.
    private var lateCallbacks = 0
    private val watchdog = Runnable {
        Log.w(TAG, "op timeout → skip")
        synchronized(this) { if (busy) { lateCallbacks++; busy = false; pump() } }
    }

    // ---- 좀비(반열림) 링크 감지 ----
    // '연결됨'인데 로봇이 실제론 죽은 상태(전파 간섭·로봇 리셋)를 OS 타임아웃보다 먼저 잡는다.
    // 우리가 프레임을 계속 보내는 중(≤4초 내 송신)인데 8초 넘게 수신(notify)이 없으면 죽은 링크로 판정.
    @Volatile private var lastRxAt = 0L
    @Volatile private var lastTxAt = 0L
    private val liveness = object : Runnable {
        override fun run() {
            if (!isConnected) return
            val now = SystemClock.elapsedRealtime()
            if (now - lastTxAt < 4_000L && now - lastRxAt > 8_000L) {
                Log.w(TAG, "stale link (tx ok, no rx 8s) → force reconnect")
                isConnected = false
                closeGatt()
                status("disconnected:stale")
                scheduleReconnect()
                return
            }
            main.postDelayed(this, 3_000L)
        }
    }

    // 어댑터 감시 리시버. 예전엔 static 플래그로 '한 번만 등록'했는데, 액티비티가 다시 만들어지면
    // 새 인스턴스는 등록을 건너뛰고 죽은 인스턴스의 리시버만 남아 'BT 껐다 켜기' 복구가 조용히 멎었다
    // (게다가 죽은 WebView 를 붙들고 있어 누수) → 인스턴스마다 등록하고 release() 로 해제한다.
    private var btReceiver: BroadcastReceiver? = null

    init {
        // 블루투스 어댑터 꺼짐/켜짐 감시 — 현장에서 'BT 껐다 켜기' 응급조치를 해도 앱이 스스로 복구.
        run {
            try {
                val rx = object : BroadcastReceiver() {
                    override fun onReceive(c: Context?, i: Intent?) {
                        when (i?.getIntExtra(BluetoothAdapter.EXTRA_STATE, -1)) {
                            BluetoothAdapter.STATE_OFF -> {
                                isConnected = false
                                closeGatt()
                                status("error:bluetooth-off")
                            }
                            BluetoothAdapter.STATE_ON -> {
                                if (wantConnect && boundAddress != null) {
                                    reconnectAttempts = 0
                                    status("reconnecting:1")
                                    main.postDelayed({
                                        if (wantConnect && !isConnected) boundAddress?.let { openConnection(it, false) }
                                    }, 1_200L)   // 어댑터 안정화 대기
                                }
                            }
                        }
                    }
                }
                btReceiver = rx
                context.registerReceiver(rx, IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED))
            } catch (e: Exception) { Log.e(TAG, "bt receiver", e) }
        }
    }

    /** 액티비티 종료 시 호출 — 리시버 해제와 타이머 정리(누수·유령 복구 방지). */
    fun release() {
        try { btReceiver?.let { context.unregisterReceiver(it) } } catch (e: Exception) {}
        btReceiver = null
        main.removeCallbacksAndMessages(null)
    }

    // ======================= 스캔 =======================
    @SuppressLint("MissingPermission")
    @JavascriptInterface
    fun startScan() {
        val a = adapter ?: return status("error:no-bluetooth")
        if (!a.isEnabled) return status("error:bluetooth-off")
        if (isConnected) return status("error:busy")               // 연결 중 스캔 금지
        val now = SystemClock.elapsedRealtime()
        if (now - lastScanStart < SCAN_MIN_GAP && scanning) return  // 과도한 재시작 방지
        lastScanStart = now
        stopScan()
        seen.clear()
        // 위치(Location) 서비스 꺼져 있으면 많은 기기에서 BLE 스캔이 0건 → 경고(스캔은 계속 시도)
        if (!isLocationOn()) status("error:location-off")
        // 바인딩된(이전 선택) 로봇 먼저 노출
        boundAddress?.let { if (seen.add(it)) pushScan(boundName ?: "", it, 0) }
        // 페어링된(본딩된) 알티노도 목록에 노출 — 지금 광고 안 해도(다른 태블릿 연결 등) 주소로 시도 가능
        try {
            adapter?.bondedDevices?.forEach { d ->
                val up = (try { d.name } catch (e: Exception) { null } ?: "").uppercase()
                if (NAME_PREFIXES.any { up.startsWith(it) } && seen.add(d.address)) pushScan(d.name ?: "", d.address, -90)
            }
        } catch (e: Exception) {}
        beginScan()
    }

    private fun isLocationOn(): Boolean {
        return try {
            val lm = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager ?: return true
            if (Build.VERSION.SDK_INT >= 28) lm.isLocationEnabled
            else lm.isProviderEnabled(LocationManager.GPS_PROVIDER) || lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
        } catch (e: Exception) { true }
    }

    @SuppressLint("MissingPermission")
    private fun beginScan() {
        val a = adapter ?: return
        scanner = a.bluetoothLeScanner ?: return status("error:no-scanner")
        val cb = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult) { handle(result) }
            override fun onBatchScanResults(results: MutableList<ScanResult>) { results.forEach { handle(it) } }
            override fun onScanFailed(errorCode: Int) { Log.e(TAG, "scan failed $errorCode"); status("error:scan-failed") }
            private fun handle(r: ScanResult) {
                val d = r.device ?: return
                val addr = d.address ?: return
                val name = try { d.name } catch (e: SecurityException) { null } ?: r.scanRecord?.deviceName ?: ""
                // 필터 없이 스캔하고 '이름 접두'로 거른다 → 서비스UUID를 광고에 안 실은 로봇도 발견(핵심 수정).
                val up = name.uppercase()
                if (NAME_PREFIXES.none { up.startsWith(it) }) return
                if (!seen.add(addr)) return
                pushScan(name, addr, r.rssi)
            }
        }
        scanCb = cb
        scanning = true
        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_BALANCED)         // LOW_LATENCY 금지(전파 혼잡 주범)
            .setCallbackType(ScanSettings.CALLBACK_TYPE_ALL_MATCHES)
            .setReportDelay(0)
            .build()
        try {
            scanner?.startScan(null, settings, cb)               // 필터 null: 모든 광고 수신 후 이름으로 선별
            status("scanning")
            main.removeCallbacks(scanStopRunnable); main.postDelayed(scanStopRunnable, SCAN_MS)
        } catch (e: Exception) { Log.e(TAG, "startScan", e); status("error:scan-failed") }
    }

    @SuppressLint("MissingPermission")
    @JavascriptInterface
    fun stopScan() {
        scanning = false
        main.removeCallbacks(scanStopRunnable)
        try { scanCb?.let { scanner?.stopScan(it) } } catch (e: Exception) {}
        scanCb = null
    }

    @JavascriptInterface
    fun listDevices(): String { startScan(); return "[]" }

    private fun pushScan(name: String, address: String, rssi: Int) {
        val o = JSONObject().put("name", name).put("address", address).put("rssi", rssi)
        postToJs("window.__altinoOnScan && window.__altinoOnScan(${JSONObject.quote(o.toString())});")
    }

    // ======================= 연결/바인딩 =======================
    /** 명시적 사용자 선택 → 그 MAC으로 '바인딩'하고 연결. 이후 자동 재연결은 이 MAC만. */
    @SuppressLint("MissingPermission")
    @JavascriptInterface
    fun connectTo(address: String) {
        val a = adapter ?: return status("error:no-bluetooth")
        try { a.getRemoteDevice(address) } catch (e: IllegalArgumentException) { return status("error:bad-address") }
        // 바인딩 저장(다른 로봇에 안 붙게)
        boundAddress = address
        val known = try { a.getRemoteDevice(address).name } catch (e: Exception) { null }
        if (known != null) boundName = known
        prefs.edit().putString(KEY_ADDR, address).putString(KEY_NAME, boundName).apply()
        wantConnect = true
        reconnectAttempts = 0
        stopScan()
        openConnection(address, autoConnect = false)
    }

    @SuppressLint("MissingPermission")
    private fun openConnection(address: String, autoConnect: Boolean) {
        val a = adapter ?: return status("error:no-bluetooth")
        if (!a.isEnabled) { status("error:bluetooth-off"); return }   // 꺼져 있으면 connectGatt 가 조용히 null 을 준다
        val dev: BluetoothDevice = try { a.getRemoteDevice(address) } catch (e: IllegalArgumentException) { return status("error:bad-address") }
        // 기존 gatt 정리 + close 후 최소 600ms 확보(133 방지)
        closeGatt()
        connecting = true
        val since = SystemClock.elapsedRealtime() - lastCloseAt
        val wait = if (since >= CLOSE_SETTLE_MS) 0L else CLOSE_SETTLE_MS - since
        status("connecting")
        main.postDelayed({
            // 대기하는 사이에 사용자가 해제/짝변경을 했을 수 있다. 확인하지 않으면
            // 해제한 로봇에 계속 붙어 있어 다른 태블릿도 그 로봇을 못 쓴다.
            if (!wantConnect || boundAddress != address) { connecting = false; return@postDelayed }
            synchronized(this) { ops.clear(); busy = false; lateCallbacks = 0; pendingFrame = null; negotiatedMtu = 23 }
            try {
                val g = dev.connectGatt(context, autoConnect, gattCb, BluetoothDevice.TRANSPORT_LE)
                if (g == null) { connecting = false; status("disconnected:connect-failed"); scheduleReconnect(); return@postDelayed }
                gatt = g
                pump()   // 대입 전에 도착한 콜백이 큐에 넣어 둔 작업을 여기서 흘려보낸다
                armConnectDeadline()
            } catch (e: Exception) {
                Log.e(TAG, "connectGatt", e); connecting = false
                status("disconnected:connect-failed"); scheduleReconnect()
            }
        }, wait)
    }

    // 연결 절차가 중간에 멈추면(권한·스택 혼잡·특성 없음 등) 되살릴 방법이 없어
    // '연결 중'에서 영영 머물렀다. 기한을 두고 실패로 처리해 재연결 경로로 보낸다.
    private val connectDeadline = Runnable {
        if (connecting && !isConnected) {
            Log.w(TAG, "connect phase timeout → retry")
            connecting = false
            closeGatt()
            status("disconnected:connect-timeout")
            scheduleReconnect()
        }
    }
    private fun armConnectDeadline() {
        main.removeCallbacks(connectDeadline)
        main.postDelayed(connectDeadline, CONNECT_DEADLINE_MS)
    }

    private val gattCb = object : BluetoothGattCallback() {
        @SuppressLint("MissingPermission")
        override fun onConnectionStateChange(g: BluetoothGatt, statusCode: Int, newState: Int) {
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                try { g.requestConnectionPriority(BluetoothGatt.CONNECTION_PRIORITY_BALANCED) } catch (e: Exception) {}
                enqueue(Op.Mtu)
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                val reason = when (statusCode) {
                    0 -> "normal"; 8 -> "timeout"; 19 -> "remote"; 22 -> "local"; 133 -> "gatt-error"
                    else -> "code-$statusCode"
                }
                isConnected = false; connecting = false
                main.removeCallbacks(connectDeadline)
                closeGatt()
                status("disconnected:$reason")
                scheduleReconnect()
            }
        }
        @SuppressLint("MissingPermission")
        override fun onMtuChanged(g: BluetoothGatt, mtu: Int, statusCode: Int) {
            // 실패하면 23으로 떨어지는데, 그러면 ATT 페이로드가 20바이트라 26바이트 프레임이
            // 잘린다. '연결은 됐는데 차가 말을 안 듣는' 증상이 되므로 로그로 드러낸다.
            negotiatedMtu = if (statusCode == BluetoothGatt.GATT_SUCCESS) mtu else 23
            if (negotiatedMtu < 29) Log.w(TAG, "MTU $negotiatedMtu — 26바이트 프레임이 잘릴 수 있음")
            opDone()
            enqueue(Op.Discover)
        }
        @SuppressLint("MissingPermission")
        override fun onServicesDiscovered(g: BluetoothGatt, statusCode: Int) {
            if (statusCode != BluetoothGatt.GATT_SUCCESS) { opDone(); status("disconnected:no-services"); closeGatt(); scheduleReconnect(); return }
            pickCharacteristics(g)
            val n = notifyCh
            if (writeCh == null || n == null) {
                // UART 특성을 못 찾으면 그대로 멈춰 있었다 → 끊고 다시 시도
                opDone(); status("error:no-uart-char"); connecting = false; closeGatt(); scheduleReconnect(); return
            }
            try {
                g.setCharacteristicNotification(n, true)
                val d = n.getDescriptor(CCCD)
                if (d != null) {
                    enqueue(Op.Descriptor(d, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE))
                } else {
                    // CCCD 없으면 알림만 켜고 바로 연결 확정
                    reconnectAttempts = 0; isConnected = true; connecting = false
                    main.removeCallbacks(connectDeadline); onLinkUp(); status("connected")
                }
            } catch (e: Exception) {
                // 여기서 멈추면 되살릴 길이 없었다 → 실패로 보고 재연결로 보낸다
                Log.e(TAG, "enable notify", e); status("error:notify-failed")
                connecting = false; closeGatt(); scheduleReconnect()
            }
            opDone()
        }
        override fun onDescriptorWrite(g: BluetoothGatt, d: BluetoothGattDescriptor, statusCode: Int) {
            if (statusCode == BluetoothGatt.GATT_SUCCESS) {
                reconnectAttempts = 0; isConnected = true; connecting = false
                main.removeCallbacks(connectDeadline); onLinkUp(); status("connected")   // ★ 여기서 connected
            } else {
                status("error:notify-failed"); connecting = false; closeGatt(); scheduleReconnect()
            }
            opDone()
        }
        override fun onCharacteristicWrite(g: BluetoothGatt, ch: BluetoothGattCharacteristic, statusCode: Int) { opDone() }
        // 수신(버전별 시그니처 둘 다 대응 — 정확히 한 경로만 발화)
        @Suppress("DEPRECATION")
        override fun onCharacteristicChanged(g: BluetoothGatt, ch: BluetoothGattCharacteristic) {
            if (Build.VERSION.SDK_INT < 33) emitData(ch.value)
        }
        override fun onCharacteristicChanged(g: BluetoothGatt, ch: BluetoothGattCharacteristic, value: ByteArray) {
            emitData(value)
        }
    }

    private fun emitData(v: ByteArray?) {
        val bytes = v ?: return
        lastRxAt = SystemClock.elapsedRealtime()
        val b64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
        postToJs("window.__altinoOnData && window.__altinoOnData('$b64');")
    }

    /** 연결 확정 직후: 좀비링크 감시 시작(타임스탬프 초기화). */
    private fun onLinkUp() {
        val now = SystemClock.elapsedRealtime()
        lastRxAt = now; lastTxAt = 0L
        main.removeCallbacks(liveness)
        main.postDelayed(liveness, 3_000L)
    }

    private fun pickCharacteristics(g: BluetoothGatt) {
        var w: BluetoothGattCharacteristic? = null
        var n: BluetoothGattCharacteristic? = null
        val writable = ArrayList<BluetoothGattCharacteristic>()
        val notifiable = ArrayList<BluetoothGattCharacteristic>()
        for (svc in g.services) for (ch in svc.characteristics) {
            val p = ch.properties
            val canWrite = (p and (BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE)) != 0
            val canNotify = (p and (BluetoothGattCharacteristic.PROPERTY_NOTIFY or BluetoothGattCharacteristic.PROPERTY_INDICATE)) != 0
            if (canWrite) writable.add(ch)
            if (canNotify) notifiable.add(ch)
            val id = ch.uuid.toString().lowercase()
            if (ch.uuid == PREFERRED_WRITE) w = ch
            if (ch.uuid == PREFERRED_NOTIFY) n = ch
            if (w == null && canWrite && HINT_UUIDS.contains(id)) w = ch
            if (n == null && canNotify && HINT_UUIDS.contains(id)) n = ch
        }
        if (w == null || n == null) {
            val both = writable.firstOrNull { notifiable.contains(it) }
            if (both != null) { if (w == null) w = both; if (n == null) n = both }
        }
        if (w == null) w = writable.firstOrNull()
        if (n == null) n = notifiable.firstOrNull()
        writeCh = w; notifyCh = n
        Log.i(TAG, "picked write=${w?.uuid} notify=${n?.uuid} mtu=$negotiatedMtu")
    }

    // ---- 직렬 큐 ----
    @Synchronized private fun enqueue(op: Op) { ops.addLast(op); pump() }

    @SuppressLint("MissingPermission")
    @Synchronized private fun pump() {
        if (busy) return
        val g = gatt ?: return
        val op = ops.removeFirstOrNull()
        if (op == null) {                       // 큐 비면 코얼레싱 슬롯의 최신 프레임 1개만
            val f = pendingFrame ?: return
            val ch = writeCh ?: return
            pendingFrame = null
            ops.addLast(Op.Write(ch, f)); pump()
            return
        }
        busy = true
        main.removeCallbacks(watchdog); main.postDelayed(watchdog, OP_TIMEOUT_MS)
        val ok = try {
            when (op) {
                is Op.Write -> writeCompat(g, op.ch, op.data)
                is Op.Descriptor -> writeDescCompat(g, op.d, op.data)
                Op.Mtu -> g.requestMtu(185)               // 247보다 보수적
                Op.Discover -> g.discoverServices()
            }
        } catch (e: Exception) { Log.e(TAG, "pump op", e); false }
        if (!ok) { main.removeCallbacks(watchdog); busy = false; pump() }
    }

    @Synchronized private fun opDone() {
        // 워치독이 이미 넘긴 op 의 뒤늦은 콜백이면, 지금 떠 있는 op 를 건드리지 않고 버린다.
        if (lateCallbacks > 0) { lateCallbacks--; return }
        main.removeCallbacks(watchdog)
        busy = false
        pump()
    }

    @SuppressLint("MissingPermission")
    @Suppress("DEPRECATION")
    private fun writeCompat(g: BluetoothGatt, ch: BluetoothGattCharacteristic, data: ByteArray): Boolean {
        val wtype = if ((ch.properties and BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0)
            BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE else BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
        return if (Build.VERSION.SDK_INT >= 33) {
            g.writeCharacteristic(ch, data, wtype) == BluetoothStatusCodes.SUCCESS
        } else {
            ch.writeType = wtype; ch.value = data; g.writeCharacteristic(ch)
        }
    }

    @SuppressLint("MissingPermission")
    @Suppress("DEPRECATION")
    private fun writeDescCompat(g: BluetoothGatt, d: BluetoothGattDescriptor, data: ByteArray): Boolean {
        return if (Build.VERSION.SDK_INT >= 33) {
            g.writeDescriptor(d, data) == BluetoothStatusCodes.SUCCESS
        } else {
            d.value = data; g.writeDescriptor(d)
        }
    }

    // ---- 송신(코얼레싱: 최신 프레임만) ----
    @JavascriptInterface
    fun sendFrame(b64: String): Boolean {
        val data = try { Base64.decode(b64, Base64.DEFAULT) } catch (e: Exception) { return false }
        lastTxAt = SystemClock.elapsedRealtime()
        synchronized(this) {
            if (gatt == null || writeCh == null || !isConnected) return false
            if (busy || ops.isNotEmpty()) { pendingFrame = data; return true }  // 미완료 → 슬롯 덮어쓰기
            ops.addLast(Op.Write(writeCh!!, data))
        }
        pump()
        return true
    }

    // ---- 재연결(지수 백오프 + 지터, '절대 포기 안 함' = 오케스트라 방식) ----
    private fun scheduleReconnect() {
        if (!wantConnect) return
        val addr = boundAddress ?: return
        if (isConnected || connecting) return   // 이미 붙었거나 붙는 중이면 건드리지 않는다
        reconnectAttempts++
        // 핵심: 포기(give-up) 없음. 로봇이 꺼졌다/멀어졌다 다시 나타나면 스스로 재연결.
        //  - 1회는 direct(빠른 복구), 2회부터는 autoConnect=true → OS가 배경에서 링크요청을
        //    유지하며 로봇이 광고를 재개하는 순간 자동 재연결(혼잡·거리에 압도적으로 강함).
        val auto = reconnectAttempts >= 2
        // 백오프는 최대 ~10초에서 캡(계속 시도하되 전파를 덜 어지럽힘)
        val idx = minOf(reconnectAttempts, 5)
        val base = minOf(800L * (1L shl (idx - 1)), 10_000L)
        val delay = base + Random.nextLong(0, 1200)
        status("reconnecting:$reconnectAttempts")
        // 예약은 항상 하나만 살아 있게 한다(쌓인 타이머가 성공 직전 연결을 닫던 문제).
        reconnectRunnable?.let { main.removeCallbacks(it) }
        val r = Runnable { if (wantConnect && !isConnected && !connecting) openConnection(addr, auto) }
        reconnectRunnable = r
        main.postDelayed(r, delay)
    }

    // ======================= JS 조회/제어 =======================
    @JavascriptInterface
    fun getState(): String = JSONObject()
        .put("connected", isConnected)
        .put("address", boundAddress ?: "")
        .put("name", boundName ?: "")
        .toString()

    @JavascriptInterface
    fun disconnect() {   // 수동 종료 — 자동 재연결 안 함(바인딩은 유지)
        wantConnect = false
        main.removeCallbacksAndMessages(null)
        stopScan()
        isConnected = false
        closeGatt()
        status("disconnected:manual")
    }

    @JavascriptInterface
    fun unbind() {       // ‘다른 로봇 선택’ — 바인딩 해제 + 종료
        wantConnect = false
        boundAddress = null; boundName = null
        prefs.edit().remove(KEY_ADDR).remove(KEY_NAME).apply()
        main.removeCallbacksAndMessages(null)
        stopScan()
        isConnected = false
        closeGatt()
        status("disconnected:unbound")
    }

    /** 하위호환: 주소 없는 자동연결은 폐기. 바인딩된 로봇이 있으면 그 로봇만 연결. */
    @JavascriptInterface
    fun connect() {
        val addr = boundAddress
        if (addr != null) { wantConnect = true; reconnectAttempts = 0; openConnection(addr, false) }
        else status("error:no-bound")
    }

    @JavascriptInterface
    fun openBluetoothSettings() { try { onOpenSettings() } catch (e: Exception) {} }

    /** 설치된 APK 버전 — 태블릿 12대 중 어느 것이 최신인지 화면에서 바로 확인용. */
    @JavascriptInterface
    fun getAppVersion(): String = try {
        context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: ""
    } catch (e: Exception) { "" }

    @SuppressLint("MissingPermission")
    private fun closeGatt() {
        try { gatt?.disconnect() } catch (e: Exception) {}
        try { gatt?.close() } catch (e: Exception) {}
        gatt = null; writeCh = null; notifyCh = null
        lastCloseAt = SystemClock.elapsedRealtime()
        synchronized(this) { ops.clear(); busy = false; lateCallbacks = 0; pendingFrame = null }
        main.removeCallbacks(watchdog)
        main.removeCallbacks(liveness)
    }

    private fun status(s: String) {
        postToJs("window.__altinoOnStatus && window.__altinoOnStatus('$s');")
    }
}
