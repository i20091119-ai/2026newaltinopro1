# 알티노 컨트롤 (안드로이드 APK)

태블릿 **하나로 완결**되는 방식. 이미 만든 웹 UI(`webapp/`)를 WebView로 그대로
띄우고, 네이티브가 **Bluetooth Classic SPP(RFCOMM)** 를 직접 처리합니다.
브라우저의 SPP 미지원 문제가 사라지므로 **브리지 컴퓨터가 필요 없습니다.**

```
[알티노 컨트롤.apk]
   └ WebView  ← webapp/ (자산으로 포함, index.html/js/css)
   └ AltinoSpp(네이티브) ── RFCOMM/SPP ──▶ 알티노
        JS ⇄ 네이티브 다리: window.AltinoNative  ↔  webapp/js/transport.js
```

## 구성
- `app/src/main/assets/webapp/` — 웹 UI(최상위 `webapp/`의 사본).
- `AltinoSpp.kt` — SPP 연결 + `@JavascriptInterface`(sendFrame/connect/disconnect/listDevices).
- `MainActivity.kt` — 전체화면 WebView + JS 브리지 주입.
- 통신 규격: `../docs/PROTOCOL.md` (송신 26B / 수신 54B, SPP UUID 00001101…).

## APK 빌드 방법 (둘 중 하나)

### A) Android Studio
1. Android Studio에서 `android/` 폴더를 연다(“Open”).
2. SDK 자동 설치 안내를 수락(compileSdk 34, build-tools 등).
3. 상단 ▶(Run) 또는 **Build ▸ Build APK(s)**.
4. 산출물: `app/build/outputs/apk/debug/app-debug.apk`.

### B) 명령줄 (SDK가 설치된 PC)
```bash
cd android
# SDK 경로 지정 (둘 중 하나)
export ANDROID_SDK_ROOT=/path/to/Android/sdk
#  또는 local.properties 에 sdk.dir=/path/to/Android/sdk

./gradlew assembleDebug          # 디버그 APK
# ./gradlew assembleRelease      # 서명 설정 후 릴리스
```
산출물: `app/build/outputs/apk/debug/app-debug.apk`

> 이 저장소에는 Gradle Wrapper가 포함돼 있어 `./gradlew`만으로 빌드됩니다.
> **Android SDK만 로컬에 있으면 됩니다**(Android Studio 설치 시 자동 포함).

## 태블릿에 설치
1. 태블릿 **설정 ▸ 보안 ▸ 출처를 알 수 없는 앱** 허용.
2. `app-debug.apk`를 태블릿에 복사 후 실행해 설치.
3. **블루투스 설정에서 알티노를 먼저 페어링**(SPP)해 둔다.
4. 앱 실행 → 웹 UI가 뜨면 자동으로 페어링된 알티노에 연결 시도.
   - 이름에 `altino`/`neo`가 포함된 페어링 기기를 우선 선택.
   - 여러 대면 `AltinoNative.connectTo("MAC주소")`로 지정 가능(추후 UI 확장 지점).

## 권한 참고
- 원본 앱과 동일하게 `targetSdk 30`이라, 안드로이드 12+ 기기에서도 설치 시
  `BLUETOOTH`/`BLUETOOTH_ADMIN` 권한이 부여되어 **런타임 권한 팝업 없이** 동작합니다.
- 만약 `targetSdk`를 31 이상으로 올리면 `BLUETOOTH_CONNECT` 런타임 권한 요청이
  필요하며, 이 코드에는 그 처리도 이미 들어 있습니다(`MainActivity.requestBtPermsIfNeeded`).

## 왜 WebView 방식인가
- 이미 검증된 웹 UI/프로토콜 인코더(자체테스트 7/7)를 **그대로 재사용** → 코드 최소.
- UI 수정은 `webapp/`만 고치면 됨(순수 HTML/JS).
- 순수 네이티브(Kotlin Compose) UI로 다시 쓰고 싶다면, 프레임 생성 로직
  (`webapp/js/protocol.js`의 `buildFrame`)을 Kotlin으로 옮기면 됩니다.
