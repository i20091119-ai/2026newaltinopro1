package saeon.altino.webctrl

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import android.os.Bundle
import android.view.WindowManager
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
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
    private lateinit var updater: AltinoUpdate

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
            // 이게 false(기본값)면 <meta viewport> 가 통째로 무시되어 화면 폭이 기기 dp 로 잡힌다.
            // 그러면 1280x800 기준으로 짠 레이아웃이 태블릿마다 다른 폭이 되고,
            // body{height:100vh;overflow:hidden} 때문에 넘친 부분(예: 심화 링크, 조향 패드)이
            // 스크롤도 안 된 채 잘려 보인다.
            useWideViewPort = true
            loadWithOverviewMode = true
            // 시스템 '글꼴 크기'(접근성) 배율을 따라가면 글자만 커져 버튼이 화면 밖으로 밀린다.
            textZoom = 100
        }
        // 실기에서만 나는 문제를 노트북에서 chrome://inspect 로 들여다볼 수 있게.
        try { WebView.setWebContentsDebuggingEnabled(true) } catch (e: Exception) {}
        web.webViewClient = WebViewClient()
        // WebChromeClient 가 없으면 WebView 는 JS 의 alert()/confirm() 을 '창 없이 false 반환'으로
        // 처리한다 → 확인 절차를 붙인 버튼이 실기에서 먹통이 된다. 앱은 자체 확인창
        // (js/ui.js)을 쓰지만, 혹시 남아 있는 기본 대화상자도 동작하도록 안전망으로 설정.
        web.webChromeClient = WebChromeClient()

        // 오케스트라와 동일한 BLE(ISSC 투명 UART) — 페어링 없이 스캔→연결.
        ble = AltinoBle(
            applicationContext,
            { js -> web.post { web.evaluateJavascript(js, null) } },
            { try { startActivity(Intent(Settings.ACTION_BLUETOOTH_SETTINGS)) } catch (e: Exception) {} },
        )
        web.addJavascriptInterface(ble, "AltinoNative")

        // 앱 안 업데이트(홈 화면 '업데이트 확인' 버튼) — GitHub Releases 에서 최신 apk 를
        // 받아 덮어쓰기 설치. 태블릿마다 지우고 다시 까는 작업을 없애기 위함.
        updater = AltinoUpdate(this) { js -> web.post { web.evaluateJavascript(js, null) } }
        web.addJavascriptInterface(updater, "AltinoUpdate")

        // 상태바만 숨겨 몰입감을 유지하되(키보드 동작을 막는 windowFullscreen 대신),
        // 키보드가 뜨면 화면이 줄어들도록 한다.
        try {
            WindowCompat.setDecorFitsSystemWindows(window, false)
            WindowInsetsControllerCompat(window, web).let {
                it.hide(WindowInsetsCompat.Type.statusBars())
                it.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } catch (e: Exception) {}

        // 뒤로가기: 앱을 종료하지 말고 웹 화면 뒤로. (학생이 무심코 눌러 앱이 꺼지고
        // 자율배송 6단계 진행이 통째로 날아가던 문제)
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() { if (web.canGoBack()) web.goBack() }
        })

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
        try { ble.release() } catch (_: Exception) {}   // 리시버 해제(누수·유령 복구 방지)
        web.destroy()
        super.onDestroy()
    }
}
