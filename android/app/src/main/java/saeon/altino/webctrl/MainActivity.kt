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
    private lateinit var spp: AltinoSpp

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

        // 읽기 스레드 -> UI 스레드에서 JS 실행
        spp = AltinoSpp(
            { js -> web.post { web.evaluateJavascript(js, null) } },
            { try { startActivity(Intent(Settings.ACTION_BLUETOOTH_SETTINGS)) } catch (e: Exception) {} },
        )
        web.addJavascriptInterface(spp, "AltinoNative")

        requestBtPermsIfNeeded()
        web.loadUrl("file:///android_asset/webapp/home.html")
    }

    /** 안드로이드 12+ 에서 targetSdk를 31 이상으로 올린 경우에만 런타임 권한이 필요. */
    private fun requestBtPermsIfNeeded() {
        if (Build.VERSION.SDK_INT >= 31 && applicationInfo.targetSdkVersion >= 31) {
            val need = arrayOf(Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.BLUETOOTH_SCAN)
                .filter { ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED }
            if (need.isNotEmpty()) ActivityCompat.requestPermissions(this, need.toTypedArray(), 1)
        }
    }

    override fun onDestroy() {
        try { spp.disconnect() } catch (_: Exception) {}
        web.destroy()
        super.onDestroy()
    }
}
