// 고친 뒤에 '다른 게 깨지지 않았는지' 를 본다.
//  1) 연결 절차의 GATT 호출 순서가 보존되는가 (mtu → discover → desc)
//  2) 어떤 순간에도 GATT 호출이 2개 겹치지 않는가
//  3) 로봇이 응답을 안 줄 때 큐가 영영 멈추지 않는가 (워치독이 살려내는가)
//  4) 응답이 돌아오면 정상 복구되는가
//  5) 연결/해제를 마구 반복해도 죽거나 멈추지 않는가
package harness

import android.bluetooth.*
import android.os.Looper
import java.util.concurrent.atomic.AtomicBoolean

object Stress {
    var pass = 0; var fail = 0
    fun ok(n: String, c: Boolean, extra: String = "") {
        if (c) { pass++; println("✓ $n") } else { fail++; println("✗ $n" + if (extra.isNotEmpty()) "  → $extra" else "") }
    }

    @JvmStatic fun main(args: Array<String>) {
        Looper.start()
        val ctx = TestContext()
        val st = java.util.Collections.synchronizedList(ArrayList<String>())
        val ble = AltinoBleFactory.make(ctx) { js -> st.add(js) }

        ble.connectTo("AA:BB:CC:DD:EE:FF")
        Thread.sleep(900)
        val dev = ctx.btm.adapter!!.device!!
        val g = dev.gattToReturn!!
        g.services.add(uart())
        g.cb!!.onConnectionStateChange(g, BluetoothGatt.GATT_SUCCESS, BluetoothProfile.STATE_CONNECTED)
        var w = 0
        while (!synchronized(st) { st.any { it.contains("connected") } } && w < 3000) { Thread.sleep(50); w += 50 }

        // 1) 연결 절차 호출 순서
        val setup = synchronized(g.calls) { g.calls.toList() }
        ok("연결 절차 순서 보존 (mtu → discover → desc)",
           setup.take(3) == listOf("mtu", "discover", "desc"), setup.toString())
        ok("연결 성립", synchronized(st) { st.any { it.contains("connected") } })

        // 2) 프레임을 쏘는 내내 GATT 호출이 겹치지 않는가
        g.stallMs = 40
        val frame = android.util.Base64.encodeToString(ByteArray(26), android.util.Base64.NO_WRAP)
        val stop = AtomicBoolean(false)
        val tx = Thread({ while (!stop.get()) { ble.sendFrame(frame); Thread.sleep(20) } }, "JavaBridge")
        tx.start(); Thread.sleep(2500); stop.set(true); tx.join()
        ok("동시에 뜬 GATT 호출 최대 1개", g.maxInFlight.get() == 1, "${g.maxInFlight.get()}개")
        val sentA = g.writes.get()
        ok("프레임이 실제로 나감", sentA > 5, "$sentA 개")

        // 3) 로봇이 잠깐 응답을 끊음 → 큐가 멈추면 안 된다 (워치독이 2초마다 살려야 함)
        //    ⚠ 좀비링크 감지가 '8초간 수신 없음'에서 링크를 끊어 버리므로, 그보다 짧게 본다.
        //      (그 감지 자체는 아래 6)에서 따로 확인한다)
        g.autoReply = false
        val before = g.writes.get()
        val stop2 = AtomicBoolean(false)
        val tx2 = Thread({ while (!stop2.get()) { ble.sendFrame(frame); Thread.sleep(20) } }, "JavaBridge2")
        tx2.start(); Thread.sleep(4200); stop2.set(true); tx2.join()
        val during = g.writes.get() - before
        ok("응답이 끊겨도 큐가 영영 멈추지 않음 (워치독 복구)", during >= 2, "4.2초 동안 $during 회 시도")
        ok("이 구간에선 링크가 아직 살아 있음", !synchronized(st) { st.any { it.contains("stale") } },
           synchronized(st) { st.takeLast(2).toString() })

        // 4) 응답 재개 → 곧바로 정상 속도로 복구되어야 한다
        //    (여기서 '늦은 콜백 세기'를 넣었다가 되돌렸다 — 세면 이 복구가 2초에 한 건씩 기어간다)
        g.autoReply = true
        g.cb!!.onCharacteristicWrite(g, g.services[0].characteristics[0], BluetoothGatt.GATT_SUCCESS)
        val before2 = g.writes.get()
        val stop3 = AtomicBoolean(false)
        val tx3 = Thread({ while (!stop3.get()) { ble.sendFrame(frame); Thread.sleep(20) } }, "JavaBridge3")
        tx3.start(); Thread.sleep(2000); stop3.set(true); tx3.join()
        val after = g.writes.get() - before2
        ok("응답 재개 후 곧바로 정상 속도 복구", after > 5, "2초 동안 $after 회")
        ok("복구 후에도 겹침 없음", g.maxInFlight.get() == 1, "${g.maxInFlight.get()}개")

        // 5) 좀비 링크 감지 — 오래 수신이 없으면 스스로 끊고 재연결해야 한다
        g.autoReply = false
        val stop5 = AtomicBoolean(false)
        val tx5 = Thread({ while (!stop5.get()) { ble.sendFrame(frame); Thread.sleep(50) } }, "JavaBridge5")
        tx5.start(); Thread.sleep(11000); stop5.set(true); tx5.join()
        ok("오래 무응답이면 좀비 링크로 보고 끊는다",
           synchronized(st) { st.any { it.contains("stale") } },
           synchronized(st) { st.takeLast(3).toString() })

        // 6) 연결/해제를 반복하며 송신 — 죽거나 멈추지 않아야 한다
        val stop4 = AtomicBoolean(false)
        val err = java.util.Collections.synchronizedList(ArrayList<String>())
        val tx4 = Thread({ while (!stop4.get()) { try { ble.sendFrame(frame) } catch (e: Throwable) { err.add(e.toString()) }; Thread.sleep(10) } }, "JavaBridge4")
        val churn = Thread({
            var i = 0
            while (!stop4.get()) {
                try {
                    if (i % 2 == 0) g.cb!!.onConnectionStateChange(g, 8, BluetoothProfile.STATE_DISCONNECTED)
                    else g.cb!!.onConnectionStateChange(g, BluetoothGatt.GATT_SUCCESS, BluetoothProfile.STATE_CONNECTED)
                } catch (e: Throwable) { err.add(e.toString()) }
                i++; Thread.sleep(60)
            }
        }, "churn")
        tx4.start(); churn.start(); Thread.sleep(4000); stop4.set(true); tx4.join(3000); churn.join(3000)
        ok("연결/해제 반복 중 예외 없음", err.isEmpty(), err.take(3).toString())
        ok("송신 스레드가 멈추지 않음(데드락 없음)", !tx4.isAlive)
        ok("해제 반복 스레드도 정상 종료", !churn.isAlive)

        // 7) 스레드 수가 늘어나지 않는가(누수)
        val gattThreads = Thread.getAllStackTraces().keys.count { it.name.startsWith("altino-gatt") }
        ok("GATT 전용 스레드는 1개만", gattThreads <= 1, "$gattThreads 개")

        println("──────────────"); println("결과: $pass 통과 / $fail 실패")
        System.exit(if (fail > 0) 1 else 0)
    }
}
