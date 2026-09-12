package saeon.altino.webctrl

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import android.webkit.JavascriptInterface
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL

/**
 * 앱 안에서 최신 버전 확인 → 내려받기 → 덮어쓰기 설치.
 *
 * 왜 필요한가: 태블릿 12대를 매번 [Actions → 아티팩트 zip → USB/드라이브 → 삭제 후 재설치]
 * 하는 게 현장에선 너무 번거로웠다. 서명키가 고정(altino.keystore)이라 같은 앱 위에
 * '업데이트' 설치가 되므로, 앱이 직접 받아서 설치하면 버튼 한 번으로 끝난다.
 *
 * 배포 경로: GitHub Releases (저장소가 공개라 로그인·토큰 없이 내려받힌다)
 *   CI가 빌드할 때마다 태그 v1.0.<빌드번호> 로 릴리스를 만들고 apk 를 첨부한다.
 *   앱은 /releases/latest 를 조회해 tag_name 의 빌드번호와 설치된 versionCode 를 비교한다.
 *   ⚠ 태그를 버전마다 새로 만드는 이유: 고정 태그(latest)면 다운로드 URL이 같아서
 *     CDN이 옛 apk 를 캐시해 내려줄 수 있다. 버전마다 URL이 달라지면 그 위험이 없다.
 *
 * JS 인터페이스(window.AltinoUpdate):
 *   info()                 {"code":63,"name":"1.0.63","canInstall":true}
 *   check()                → __altinoOnUpdate({ok,newer,code,name,notes,url,size}) 또는 {ok:false,error}
 *   download(url,name)     → __altinoOnUpdateProgress(0~100), 끝나면 설치화면
 *   openInstallPermission() '출처를 알 수 없는 앱' 허용 화면 열기
 *   openReleasePage()      브라우저로 릴리스 페이지 열기(수동 대안)
 */
class AltinoUpdate(
    private val act: Activity,
    private val postToJs: (String) -> Unit,
) {
    companion object {
        private const val TAG = "AltinoUpdate"
        private const val REPO = "i20091119-ai/2026newaltinopro1"
        private const val API_LATEST = "https://api.github.com/repos/$REPO/releases/latest"
        private const val RELEASES_PAGE = "https://github.com/$REPO/releases/latest"
        private const val TIMEOUT = 15_000
    }

    @Volatile private var busy = false

    // ── JS 로 결과 보내기 ──────────────────────────────────────────────
    private fun emit(fn: String, o: JSONObject) {
        // JSON 을 문자열 리터럴로 감싸 전달(따옴표·개행이 섞여도 안전)
        val s = JSONObject.quote(o.toString())
        postToJs("if(window.$fn)window.$fn($s);")
    }
    private fun fail(msg: String) = emit("__altinoOnUpdate", JSONObject().put("ok", false).put("error", msg))

    private fun currentCode(): Long = try {
        val pi = act.packageManager.getPackageInfo(act.packageName, 0)
        if (Build.VERSION.SDK_INT >= 28) pi.longVersionCode else @Suppress("DEPRECATION") pi.versionCode.toLong()
    } catch (e: Exception) { 0L }

    /** 설치된 버전 + '알 수 없는 출처' 허용 여부 */
    @JavascriptInterface
    fun info(): String = try {
        JSONObject()
            .put("code", currentCode())
            .put("name", act.packageManager.getPackageInfo(act.packageName, 0).versionName ?: "")
            .put("canInstall", canInstall())
            .toString()
    } catch (e: Exception) { "{}" }

    private fun canInstall(): Boolean =
        if (Build.VERSION.SDK_INT >= 26) act.packageManager.canRequestPackageInstalls() else true

    /** '출처를 알 수 없는 앱 설치' 허용 화면 — 기기당 한 번만 켜 주면 된다. */
    @JavascriptInterface
    fun openInstallPermission() {
        try {
            if (Build.VERSION.SDK_INT >= 26) {
                act.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:${act.packageName}")))
            } else {
                act.startActivity(Intent(Settings.ACTION_SECURITY_SETTINGS))
            }
        } catch (e: Exception) { Log.w(TAG, "perm screen: $e") }
    }

    @JavascriptInterface
    fun openReleasePage() {
        try { act.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(RELEASES_PAGE))) } catch (e: Exception) {}
    }

    // ── 1) 최신 버전 조회 ──────────────────────────────────────────────
    @JavascriptInterface
    fun check() {
        if (busy) { fail("이미 진행 중이에요"); return }
        busy = true
        Thread {
            try {
                val body = httpText(API_LATEST)
                val rel = JSONObject(body)
                val tag = rel.optString("tag_name", "")            // v1.0.63
                val code = Regex("(\\d+)\\s*$").find(tag)?.groupValues?.get(1)?.toLongOrNull()
                    ?: throw Exception("릴리스 태그를 이해하지 못했어요: $tag")
                var url = ""; var size = 0L; var fname = "altino.apk"
                val assets = rel.optJSONArray("assets")
                if (assets != null) for (i in 0 until assets.length()) {
                    val a = assets.getJSONObject(i)
                    if (a.optString("name").endsWith(".apk")) {
                        url = a.optString("browser_download_url")
                        size = a.optLong("size"); fname = a.optString("name"); break
                    }
                }
                if (url.isEmpty()) throw Exception("릴리스에 apk 파일이 없어요")
                emit("__altinoOnUpdate", JSONObject()
                    .put("ok", true)
                    .put("newer", code > currentCode())
                    .put("code", code)
                    .put("name", tag.removePrefix("v"))
                    .put("notes", rel.optString("body", "").take(600))
                    .put("size", size)
                    .put("file", fname)
                    .put("url", url))
            } catch (e: Exception) {
                Log.w(TAG, "check: $e")
                fail(friendly(e))
            } finally { busy = false }
        }.start()
    }

    // ── 2) 내려받기 → 설치 ────────────────────────────────────────────
    @JavascriptInterface
    fun download(url: String, expectSize: String) {
        if (busy) return
        busy = true
        Thread {
            var out: File? = null
            try {
                if (!url.startsWith("https://")) throw Exception("안전하지 않은 주소")
                val dir = act.getExternalFilesDir(null) ?: act.filesDir
                // 이전에 받다 만 파일이 남아 있으면 지우고 시작
                dir.listFiles()?.forEach { if (it.name.startsWith("update-") && it.name.endsWith(".apk")) it.delete() }
                out = File(dir, "update-${System.currentTimeMillis()}.apk")
                val total = expectSize.toLongOrNull() ?: -1L
                var got = 0L; var lastPct = -1
                openStream(url).use { ins ->
                    FileOutputStream(out).use { fos ->
                        val buf = ByteArray(64 * 1024)
                        while (true) {
                            val n = ins.read(buf); if (n <= 0) break
                            fos.write(buf, 0, n); got += n
                            if (total > 0) {
                                val pct = ((got * 100) / total).toInt().coerceIn(0, 100)
                                if (pct != lastPct) {
                                    lastPct = pct
                                    postToJs("if(window.__altinoOnUpdateProgress)window.__altinoOnUpdateProgress($pct);")
                                }
                            }
                        }
                    }
                }
                if (out.length() < 1_000_000L) throw Exception("받은 파일이 너무 작아요(네트워크 차단?)")
                postToJs("if(window.__altinoOnUpdateProgress)window.__altinoOnUpdateProgress(100);")
                install(out)
            } catch (e: Exception) {
                Log.w(TAG, "download: $e")
                try { out?.delete() } catch (_: Exception) {}
                fail(friendly(e))
            } finally { busy = false }
        }.start()
    }

    private fun install(apk: File) {
        act.runOnUiThread {
            try {
                if (!canInstall()) { openInstallPermission(); return@runOnUiThread }
                val uri = FileProvider.getUriForFile(act, "${act.packageName}.fileprovider", apk)
                val i = Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(uri, "application/vnd.android.package-archive")
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                act.startActivity(i)
            } catch (e: Exception) {
                Log.w(TAG, "install: $e")
                fail("설치 화면을 열지 못했어요: ${e.message}")
            }
        }
    }

    // ── HTTP (리다이렉트 직접 따라감) ────────────────────────────────
    // HttpURLConnection 은 호스트가 바뀌는 리다이렉트를 자동으로 따라가지 않는 경우가 있다.
    // 릴리스 asset 은 objects.githubusercontent.com 으로 넘어가므로 직접 처리한다.
    private fun openConn(url: String, accept: String): HttpURLConnection {
        var cur = url; var hop = 0
        while (true) {
            val c = (URL(cur).openConnection() as HttpURLConnection).apply {
                connectTimeout = TIMEOUT; readTimeout = TIMEOUT
                instanceFollowRedirects = false
                setRequestProperty("Accept", accept)
                setRequestProperty("User-Agent", "AltinoWebCtrl")
                setRequestProperty("Cache-Control", "no-cache")
            }
            val code = c.responseCode
            if (code in 300..399) {
                val loc = c.getHeaderField("Location"); c.disconnect()
                if (loc == null || ++hop > 5) throw Exception("리다이렉트 오류")
                cur = URL(URL(cur), loc).toString()
                continue
            }
            if (code == 403 || code == 429) { c.disconnect(); throw Exception("조회 횟수 제한(잠시 후 다시)") }
            if (code != 200) { c.disconnect(); throw Exception("서버 응답 $code") }
            return c
        }
    }
    private fun httpText(url: String): String =
        openConn(url, "application/vnd.github+json").inputStream.bufferedReader().use { it.readText() }
    private fun openStream(url: String) = openConn(url, "application/octet-stream").inputStream

    private fun friendly(e: Exception): String {
        val m = e.message ?: e.toString()
        return when {
            m.contains("Unable to resolve host") || m.contains("UnknownHost") ->
                "인터넷에 연결되어 있지 않아요 (와이파이 확인)"
            m.contains("timed out") || m.contains("timeout") -> "응답이 없어요 — 잠시 후 다시 눌러 주세요"
            m.contains("SSL") || m.contains("handshake") -> "학교 망이 GitHub 을 막고 있어요 (와이파이로 바꿔 보세요)"
            else -> m
        }
    }
}
