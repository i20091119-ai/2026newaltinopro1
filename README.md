# 알티노 네오 태블릿 웹 컨트롤

`altinoneoCodingplay.apk`(㈜새온, `saeon.co.kr.altinoneocodingplay` v1.3)를
리버스 엔지니어링해, 태블릿 **웹앱**에서 알티노 네오를 조종할 수 있게 만든
프로젝트입니다.

- `docs/PROTOCOL.md` — 앱에서 복원한 **통신 프로토콜 전체 명세**
- `webapp/` — 터치 친화적 웹 컨트롤 UI (주행·LED·부저·도트매트릭스·센서)
- `bridge/` — WebSocket ↔ Bluetooth SPP **중계 서버**(Node)

## APK 분석 요약

| 항목 | 결과 |
|------|------|
| 통신 방식 | **Bluetooth Classic — RFCOMM / SPP** |
| SPP UUID | `00001101-0000-1000-8000-00805F9B34FB` |
| 권한 | `BLUETOOTH`, `BLUETOOTH_ADMIN` (BLE·WiFi·위치 권한 전혀 없음) |
| 송신 | 26바이트 고정 프레임을 **50ms 주기로 계속 스트리밍** |
| 수신 | 54바이트 고정 프레임(IR6·조도·배터리 센서) |
| 구조 | 표준 Android BluetoothChat 패턴(`BluetoothService`의 Connect/Connected 스레드) |

명령 체계(모두 상태 프레임의 특정 바이트만 변경):
`Go(a,b)`(모터), `Steering(v)`(조향 서보), `Led(mask)`, `Sound(code)`,
`Display/Dot`(8×8 도트매트릭스). 자세한 바이트 배치는 `docs/PROTOCOL.md`.

## ⚠️ 반드시 알아야 할 제약: 브라우저는 SPP에 직접 못 붙는다

이 로봇은 **Bluetooth Classic SPP**를 씁니다. 그런데 브라우저의
**Web Bluetooth API는 BLE(GATT)만 지원**하고 클래식 SPP는 지원하지 않습니다.
따라서 "태블릿 브라우저 페이지 하나만으로 로봇에 바로 연결"은 **불가능**합니다.

실제로 동작시키는 방법은 두 가지입니다.

### 방법 A — 웹앱 + 브리지 (이 저장소 기본 제공, 권장)
```
[태블릿 브라우저: webapp] --WebSocket--> [브리지(PC/라즈베리파이)] --SPP--> [알티노]
```
- 알티노와 페어링되는 PC/라즈베리파이에서 `bridge/`를 실행.
- 태블릿에서는 웹앱만 열어 `ws://브리지IP:8080`으로 접속하면 끝.
- **장점**: 웹앱은 순수 브라우저에서 그대로 동작, 로봇 펌웨어 변경 불필요.
- **단점**: 브리지용 컴퓨터가 1대 필요.
- 절차: `bridge/README.md` 참고.

### 방법 B — APK(WebView 래퍼) : 브리지 없이 태블릿만으로 ★
**`android/` 에 바로 빌드 가능한 안드로이드 프로젝트로 제공합니다.**
이 `webapp/`을 그대로 WebView로 띄우고, 네이티브가 RFCOMM SPP를 직접 처리합니다.
- Android WebView + `@JavascriptInterface`(`window.AltinoNative`) ↔ 웹앱의
  `AndroidBridgeTransport`. 브라우저 SPP 미지원 문제가 사라져 **브리지 불필요.**
- **장점**: 태블릿 1대로 완결, 추가 하드웨어 없음. 검증된 웹 UI 그대로 재사용.
- **단점**: APK 빌드 1회 필요(Android Studio에서 원클릭, 또는 `./gradlew assembleDebug`).
- 빌드·설치 절차: **`android/README.md`** 참고.

> 이 저장소를 만든 샌드박스에는 Android SDK가 없고 Google 다운로드 서버가
> 정책상 차단되어, **여기서 완성된 .apk를 직접 뽑지는 못했습니다.** 대신
> Gradle Wrapper까지 포함한 완성 프로젝트를 넣어 두었으니, SDK가 있는 PC나
> Android Studio에서 그대로 빌드하면 됩니다.

> 참고: 알티노의 블루투스 모듈을 BLE 지원 모듈로 교체하면 Web Bluetooth로
> 직접 연결도 가능하지만, 펌웨어/모듈 변경이 필요해 이 저장소 범위 밖입니다.

## 빠른 시작 (데모 모드 — 로봇 없이 UI 확인)
1. `webapp/`를 아무 정적 서버로 서빙하거나 `index.html`을 브라우저로 엽니다.
   ```bash
   cd webapp && python3 -m http.server 5173
   ```
2. 상단에서 **데모(목)** 버튼을 누르면 가짜 센서값이 흐르고, 주행/LED/도트
   조작 시 콘솔에서 생성되는 TX 프레임을 확인할 수 있습니다
   (`window.__ALTINO_LOG_TX = true`).
3. 인코더 정확성은 `webapp/protocol.test.html` 에서 확인(모두 통과해야 정상).

## 실물 연결 시 안전 수칙
- 처음엔 **낮은 속도**로 시작하고, 바퀴가 뜬 상태에서 방향/부호부터 확인하세요.
- 방향이 반대면 `docs/PROTOCOL.md`의 모터 매핑(MOTOR_A/B, 부호)을 조정.
- 창을 벗어나거나 화면이 숨겨지면 웹앱이 자동으로 정지 프레임을 보냅니다.

## 라이선스/주의
원본 앱과 프로토콜의 저작권은 제작사(㈜새온)에 있습니다. 본 저장소는 보유
기기와의 상호운용(교육·개인용) 목적의 분석 결과물입니다.
