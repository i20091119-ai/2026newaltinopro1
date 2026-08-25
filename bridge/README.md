# 알티노 브리지 (WebSocket ↔ Bluetooth SPP)

브라우저는 클래식 SPP에 직접 붙을 수 없으므로, 이 작은 Node 프로그램이
웹앱과 알티노 사이에서 바이트를 중계합니다.

```
[태블릿/PC 브라우저: webapp] --WebSocket--> [이 브리지] --RFCOMM/SPP--> [알티노]
```

## 어디서 실행하나?
알티노와 **블루투스로 페어링 가능한 컴퓨터**에서 실행합니다.
- PC/노트북/라즈베리파이(리눅스·윈도우·맥) — 권장.
- 태블릿에서 브라우저만으로 끝내고 싶다면 이 방식 대신 최상위
  `README.md`의 **WebView 래퍼 앱** 방법을 쓰세요.

## 설치
```bash
cd bridge
npm install
```
> `bluetooth-serial-port`는 네이티브 모듈입니다.
> - 리눅스: `sudo apt-get install build-essential libbluetooth-dev`
> - 윈도우: 빌드 도구 필요(node-gyp). 맥: Xcode CLT.

## 사용
1. OS 블루투스 설정에서 알티노를 **페어링**합니다.
2. 브리지 실행:
   ```bash
   node server.js --addr AA:BB:CC:DD:EE:FF   # 알티노 MAC 주소
   # 주소를 모르면 자동 검색:
   node server.js
   ```
3. 웹앱(`webapp/index.html`)을 열고 상단 WebSocket 주소를
   `ws://<브리지PC-IP>:8080` 으로 맞춘 뒤 **브리지 연결**.

## 프로토콜
브리지는 내용을 해석하지 않고 **바이트를 그대로** 양방향 전달합니다.
프레임 규격은 `../docs/PROTOCOL.md` 참고. (송신 26바이트 / 수신 54바이트)
