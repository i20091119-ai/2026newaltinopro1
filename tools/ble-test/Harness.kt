// 진짜 AltinoBle.kt 를 JVM 에서 돌려, 블루투스 스택이 밀릴 때 무슨 일이 나는지 잰다.
// 재는 것:
//   A) sendFrame(=웹 화면이 기다리는 호출)이 최대 몇 ms 막히는가
//   B) 메인 스레드(워치독)가 최대 몇 ms 막히는가   ← 5초 넘으면 ANR
//   C) GATT 호출이 동시에 2개 뜬 적이 있는가       ← 큐가 깨졌다는 뜻
//   D) 프레임이 실제로 몇 개 나갔는가
package harness

import android.bluetooth.*
import android.content.Context
import android.location.LocationManager
import android.os.Looper
import saeon.altino.webctrl.AltinoBle
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

class TestContext : Context() {
    val btm = BluetoothManager()
    override fun getSystemService(name: String): Any? = when (name) {
        BLUETOOTH_SERVICE -> btm
        LOCATION_SERVICE -> LocationManager()
        else -> null
    }
}

fun uart(): BluetoothGattService {
    val svc = BluetoothGattService(UUID.fromString("49535343-fe7d-4ae5-8fa9-9fafd205e455"))
    svc.characteristics.add(BluetoothGattCharacteristic(
        UUID.fromString("49535343-8841-43f4-a8d4-ecbe34729bb3"),
        BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE))
    svc.characteristics.add(BluetoothGattCharacteristic(
        UUID.fromString("49535343-1e4d-4bd9-ba61-23c647249616"),
        BluetoothGattCharacteristic.PROPERTY_NOTIFY))
    return svc
}

object Main {
    @JvmStatic fun main(args: Array<String>) {
        val stallMs = (args.getOrNull(0) ?: "300").toLong()
        val label = args.getOrNull(1) ?: "?"
        Looper.start()
        val ctx = TestContext()
        val statuses = java.util.Collections.synchronizedList(ArrayList<String>())
        val ble = AltinoBle(ctx, { js -> statuses.add(js) }, {})

        // 연결 성립까지 몰아준다
        ble.connectTo("AA:BB:CC:DD:EE:FF")
        Thread.sleep(900)
        val dev = ctx.btm.adapter!!.device!!
        val g = dev.gattToReturn!!
        g.services.add(uart())
        g.cb!!.onConnectionStateChange(g, BluetoothGatt.GATT_SUCCESS, BluetoothProfile.STATE_CONNECTED)
        var waited = 0
        while (!synchronized(statuses) { statuses.any { it.contains("connected") } } && waited < 3000) { Thread.sleep(50); waited += 50 }
        if (!synchronized(statuses) { statuses.any { it.contains("connected") } }) { println("연결 성립 실패: " + synchronized(statuses) { statuses.toList() }); return }

        // 여기서부터 스택이 밀리기 시작한다
        g.stallMs = stallMs

        val stop = AtomicBoolean(false)
        val maxSend = AtomicLong(0); val sends = AtomicLong(0)
        val maxMain = AtomicLong(0)

        // (1) WebView JavaBridge 스레드 — 10Hz 로 프레임 송신. JS 는 이 호출이 끝나야 다음 줄로 간다.
        val frame = android.util.Base64.encodeToString(ByteArray(26) { it.toByte() }, android.util.Base64.NO_WRAP)
        val tx = Thread({
            while (!stop.get()) {
                val t0 = System.nanoTime()
                ble.sendFrame(frame)
                val ms = (System.nanoTime() - t0) / 1_000_000L
                maxSend.updateAndGet { m -> if (ms > m) ms else m }
                sends.incrementAndGet()
                Thread.sleep(100)
            }
        }, "JavaBridge")

        // (2) 메인 스레드 응답성 — 워치독/재연결 타이머가 도는 스레드가 얼마나 막히는지
        val main = android.os.Handler(Looper.getMainLooper())
        val probe = Thread({
            while (!stop.get()) {
                val t0 = System.nanoTime()
                val done = java.util.concurrent.CountDownLatch(1)
                main.post { done.countDown() }
                done.await()
                val ms = (System.nanoTime() - t0) / 1_000_000L
                maxMain.updateAndGet { m -> if (ms > m) ms else m }
                Thread.sleep(50)
            }
        }, "probe")

        tx.start(); probe.start()
        Thread.sleep(6000)
        stop.set(true); tx.join(); probe.join()

        println("[$label] 스택 지연 ${stallMs}ms")
        println("  A) sendFrame 최대 대기 : ${maxSend.get()} ms   (웹 화면이 그동안 멈춘다)")
        println("  B) 메인 스레드 최대 대기: ${maxMain.get()} ms   (5000 넘으면 ANR)")
        println("  C) GATT 동시 호출 최대  : ${g.maxInFlight.get()} 개  (1이어야 정상)")
        println("  D) 6초 동안 나간 프레임 : ${g.writes.get()} 개 / 시도 ${sends.get()}")
        System.exit(0)
    }
}
