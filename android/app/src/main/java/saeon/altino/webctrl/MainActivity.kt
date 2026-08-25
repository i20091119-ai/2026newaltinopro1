package saeon.altino.webctrl

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import android.os.Bundle
import android.view.WindowManager
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

/**
 * webapp(WebView)을 전체화면으로 띄우고, AltinoNative(SPP 브리지)를 JS에 노출한다.
 * webapp/js/transport.js 가 window.AltinoNative 존재를 감지해 자동으로 네이티브
 * 경로(AndroidBridgeTransport)로 연결하므로, 브리지 컴퓨터가 필요 없다.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var web: WebView
    private lateinit var ble: AltinoBle

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        web = WebView(this)
        setContentView(web)

        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = true
            mediaPlaybackRequiresUserGesture = false
        }
        web.webViewClient = WebViewClient()

        // 오케스트라와 동일한 BLE(ISSC 투명 UART) — 페어링 없이 스캔→연결.
        ble = AltinoBle(
            applicationContext,
            { js -> web.post { web.evaluateJavascript(js, null) } },
            { try { startActivity(Intent(Settings.ACTION_BLUETOOTH_SETTINGS)) } catch (e: Exception) {} },
        )
        web.addJavascriptInterface(ble, "AltinoNative")

        requestBtPermsIfNeeded()
        web.loadUrl("file:///android_asset/webapp/home.html")
    }

    /** BLE 스캔에 필요한 런타임 권한 요청.
     *  - API ≤30: 클래식/BLE 검색에 위치 권한(ACCESS_FINE_LOCATION) 필요.
     *  - API 31+: BLUETOOTH_SCAN(neverForLocation) + BLUETOOTH_CONNECT. */
    private fun requestBtPermsIfNeeded() {
        val need = ArrayList<String>()
        if (Build.VERSION.SDK_INT >= 31) {
            for (p in arrayOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT))
                if (ContextCompat.checkSelfPermission(this, p) != PackageManager.PERMISSION_GRANTED) need.add(p)
        } else {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED)
                need.add(Manifest.permission.ACCESS_FINE_LOCATION)
        }
        if (need.isNotEmpty()) ActivityCompat.requestPermissions(this, need.toTypedArray(), 1)
    }

    override fun onDestroy() {
        try { ble.disconnect() } catch (_: Exception) {}
        web.destroy()
        super.onDestroy()
    }
}
