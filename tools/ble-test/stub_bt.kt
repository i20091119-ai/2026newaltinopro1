@file:Suppress("UNUSED_PARAMETER", "unused")
package android.bluetooth
import java.util.UUID

class BluetoothGattDescriptor(val uuid: UUID) {
    companion object { @JvmField val ENABLE_NOTIFICATION_VALUE = byteArrayOf(1, 0) }
    @JvmField var value: ByteArray? = null
}
class BluetoothGattCharacteristic(val uuid: UUID, val properties: Int) {
    companion object {
        const val PROPERTY_WRITE = 8; const val PROPERTY_WRITE_NO_RESPONSE = 4
        const val PROPERTY_NOTIFY = 16; const val PROPERTY_INDICATE = 32
        const val WRITE_TYPE_DEFAULT = 2; const val WRITE_TYPE_NO_RESPONSE = 1
    }
    @JvmField var writeType: Int = WRITE_TYPE_DEFAULT
    @JvmField var value: ByteArray? = null
    private val descs = HashMap<UUID, BluetoothGattDescriptor>()
    fun getDescriptor(u: UUID): BluetoothGattDescriptor? = descs.getOrPut(u) { BluetoothGattDescriptor(u) }
}
class BluetoothGattService(val uuid: UUID) {
    @JvmField val characteristics = ArrayList<BluetoothGattCharacteristic>()
}
object BluetoothProfile { const val STATE_CONNECTED = 2; const val STATE_DISCONNECTED = 0 }
object BluetoothStatusCodes { const val SUCCESS = 0 }

/**
 * 가짜 GATT — 여기서 '블루투스 스택이 멈추는' 상황을 만든다.
 * stallMs 만큼 writeCharacteristic 안에서 잠들어, 실제 기기에서 스택이 밀릴 때를 흉내낸다.
 */
class BluetoothGatt {
    companion object { const val GATT_SUCCESS = 0; const val CONNECTION_PRIORITY_BALANCED = 0 }
    @JvmField var cb: BluetoothGattCallback? = null
    @JvmField val services = ArrayList<BluetoothGattService>()
    @Volatile @JvmField var stallMs: Long = 0          // 스택이 밀리는 시간
    @JvmField val inFlight = java.util.concurrent.atomic.AtomicInteger(0)
    @JvmField val maxInFlight = java.util.concurrent.atomic.AtomicInteger(0)
    @JvmField val writes = java.util.concurrent.atomic.AtomicInteger(0)
    @JvmField val calls = java.util.Collections.synchronizedList(ArrayList<String>())
    @JvmField var autoReply = true                     // 콜백을 돌려줄지
    private val binder = java.util.concurrent.Executors.newSingleThreadExecutor { r ->
        Thread(r, "binder").apply { isDaemon = true } }

    fun getServices(): List<BluetoothGattService> = services
    fun discoverServices(): Boolean { calls.add("discover"); reply { cb?.onServicesDiscovered(this, GATT_SUCCESS) }; return true }
    fun requestMtu(m: Int): Boolean { calls.add("mtu"); reply { cb?.onMtuChanged(this, m, GATT_SUCCESS) }; return true }
    fun requestConnectionPriority(p: Int): Boolean = true
    fun setCharacteristicNotification(c: BluetoothGattCharacteristic, on: Boolean): Boolean = true
    fun disconnect() {}
    fun close() {}

    // ⚠ 이게 핵심: API 33+ 의 writeCharacteristic 은 값을 돌려주므로 '동기 바인더 호출'이다.
    //    호출한 스레드가 블루투스 프로세스의 응답을 기다린다.
    fun writeCharacteristic(c: BluetoothGattCharacteristic, data: ByteArray, type: Int): Int {
        enter(); try { if (stallMs > 0) Thread.sleep(stallMs) } finally { leave() }
        writes.incrementAndGet(); calls.add("write")
        reply { cb?.onCharacteristicWrite(this, c, GATT_SUCCESS) }
        return BluetoothStatusCodes.SUCCESS
    }
    fun writeCharacteristic(c: BluetoothGattCharacteristic): Boolean {
        enter(); try { if (stallMs > 0) Thread.sleep(stallMs) } finally { leave() }
        writes.incrementAndGet(); calls.add("write")
        reply { cb?.onCharacteristicWrite(this, c, GATT_SUCCESS) }
        return true
    }
    fun writeDescriptor(d: BluetoothGattDescriptor, data: ByteArray): Int {
        calls.add("desc"); reply { cb?.onDescriptorWrite(this, d, GATT_SUCCESS) }; return BluetoothStatusCodes.SUCCESS
    }
    fun writeDescriptor(d: BluetoothGattDescriptor): Boolean {
        calls.add("desc"); reply { cb?.onDescriptorWrite(this, d, GATT_SUCCESS) }; return true
    }
    private fun enter() {
        val n = inFlight.incrementAndGet()
        maxInFlight.updateAndGet { m -> if (n > m) n else m }
    }
    private fun leave() { inFlight.decrementAndGet() }
    private fun reply(f: () -> Unit) { if (autoReply) binder.execute { f() } }
}
abstract class BluetoothGattCallback {
    open fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {}
    open fun onServicesDiscovered(g: BluetoothGatt, status: Int) {}
    open fun onMtuChanged(g: BluetoothGatt, mtu: Int, status: Int) {}
    open fun onCharacteristicWrite(g: BluetoothGatt, c: BluetoothGattCharacteristic, status: Int) {}
    open fun onDescriptorWrite(g: BluetoothGatt, d: BluetoothGattDescriptor, status: Int) {}
    open fun onCharacteristicChanged(g: BluetoothGatt, c: BluetoothGattCharacteristic, v: ByteArray) {}
    open fun onCharacteristicChanged(g: BluetoothGatt, c: BluetoothGattCharacteristic) {}
}
class BluetoothDevice(val address: String, val name: String? = "ALTINO-TEST") {
    companion object { const val TRANSPORT_LE = 2 }
    @JvmField var gattToReturn: BluetoothGatt? = null
    fun connectGatt(c: android.content.Context?, auto: Boolean, cb: BluetoothGattCallback, transport: Int): BluetoothGatt? {
        val g = gattToReturn ?: BluetoothGatt().also { gattToReturn = it }
        g.cb = cb; return g
    }
}
class BluetoothAdapter {
    companion object {
        const val ACTION_STATE_CHANGED = "bt.state"; const val EXTRA_STATE = "state"
        const val STATE_OFF = 10; const val STATE_ON = 12
    }
    @JvmField var isEnabled: Boolean = true
    @JvmField var device: BluetoothDevice? = null
    @JvmField var bondedDevices: Set<BluetoothDevice> = emptySet()
    val bluetoothLeScanner: android.bluetooth.le.BluetoothLeScanner? = android.bluetooth.le.BluetoothLeScanner()
    fun getRemoteDevice(addr: String): BluetoothDevice = device ?: BluetoothDevice(addr).also { device = it }
}
class BluetoothManager { @JvmField var adapter: BluetoothAdapter? = BluetoothAdapter() }
