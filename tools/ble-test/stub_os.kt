@file:Suppress("UNUSED_PARAMETER", "unused")
package android.os
object Build { object VERSION { @JvmField var SDK_INT: Int = 34 } }
object SystemClock { @JvmStatic fun elapsedRealtime(): Long = System.nanoTime() / 1_000_000L }

// Looper/Handler: 진짜 안드로이드처럼 '메시지 큐를 도는 전용 스레드' 로 구현한다.
// pump()/watchdog 이 메인 스레드에서 도는 상황을 그대로 재현해야 의미가 있다.
class Looper internal constructor(val name: String) {
    internal val q = java.util.concurrent.DelayQueue<Task>()
    companion object {
        private val mainLooper = Looper("main")
        @JvmStatic fun getMainLooper(): Looper = mainLooper
        @JvmStatic fun start() {
            val t = Thread({
                while (true) {
                    val task = mainLooper.q.take()
                    if (task.cancelled) continue
                    try { task.r.run() } catch (e: Throwable) { e.printStackTrace() }
                }
            }, "main")
            t.isDaemon = true; t.start()
        }
    }
}
class Task(val r: Runnable, delayMs: Long) : java.util.concurrent.Delayed {
    val due = System.nanoTime() + delayMs * 1_000_000L
    @Volatile var cancelled = false
    override fun getDelay(u: java.util.concurrent.TimeUnit): Long =
        u.convert(due - System.nanoTime(), java.util.concurrent.TimeUnit.NANOSECONDS)
    override fun compareTo(other: java.util.concurrent.Delayed): Int =
        getDelay(java.util.concurrent.TimeUnit.NANOSECONDS)
            .compareTo(other.getDelay(java.util.concurrent.TimeUnit.NANOSECONDS))
}
class Handler(private val looper: Looper) {
    private val live = java.util.Collections.synchronizedMap(HashMap<Runnable, MutableList<Task>>())
    fun post(r: Runnable): Boolean = postDelayed(r, 0)
    fun postDelayed(r: Runnable, ms: Long): Boolean {
        val t = Task(r, ms)
        live.getOrPut(r) { java.util.Collections.synchronizedList(ArrayList()) }.add(t)
        looper.q.put(t); return true
    }
    fun removeCallbacks(r: Runnable) { live[r]?.forEach { it.cancelled = true }; live[r]?.clear() }
    fun removeCallbacksAndMessages(token: Any?) {
        synchronized(live) { live.values.forEach { l -> l.forEach { it.cancelled = true }; l.clear() } }
    }
}
