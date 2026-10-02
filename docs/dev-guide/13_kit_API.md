# 13. kit API — `js/kit.js` (AltinoKit 1.0)

주제 앱이 쓰는 전부. 견본은 `webapp/t00.html` + `webapp/js/t00.js` (모든 API 를 한 번씩 씀).
**kit.js 는 통합 담당자만 고친다** — 필요한 기능이 없으면 요청한다(01 §5).

## 0. 페이지 뼈대

```html
<div class="topbar">
  <a href="school.html">← 로봇학교</a> <h1>…</h1>
  <div id="kitBar"></div>            <!-- kit 이 👥모둠 · 🚗로봇번호 · 🔋 · 🔗연결 칩을 채운다 -->
</div>
…
<script src="js/protocol.js"></script>
<script src="js/ui.js"></script>
<script src="js/dotmatrix.js"></script>
<script src="js/transport.js"></script>
<script src="js/kit.js"></script>
<script src="js/t07.js"></script>   <!-- 이 순서 고정 (검사기가 확인) -->
```

## 1. 만들기

```js
const kit = AltinoKit.create({
  appId: 't07',                 // 필수. 파일 번호와 같게 (t07.html ↔ 't07')
  title: '수학 시험 보는 날',
  onSensor: (s, kit) => {},     // 센서 프레임마다(10Hz). s.ir1~ir6, s.cds, s.battery
  onTick: (kit) => {},          // 100ms 마다, 전송 직전
  onStatus: (base, raw) => {},  // 연결 상태 바뀔 때. base: connected | reconnecting | disconnected | error …
  onRunEnd: () => {},           // kit.run 이 끝날 때(정상·정지·오류 모두)
  kick: true,                   // false 면 느린 출발 킥(S4)을 끈다 — t02 에서 '출발 못 하는 속도'를 보여 줄 때
});
```
- 한 화면에 kit 은 **하나만** (두 번 만들면 오류).
- 태블릿(APK)에서는 짝지은 로봇에 자동 연결, 짝이 없으면 연결창을 띄운다.
- **브라우저에서는 가짜 로봇**(MockTransport)으로 바로 동작한다 → 로봇 없이 개발.

## 2. 움직이기

| API | 설명 |
|---|---|
| `kit.drive(speed, steer)` | speed −1000~1000(양수 전진), steer −127(좌)~127(우). **지시만** 하고 전송은 kit 이 10Hz 로 |
| `kit.stop()` | 즉시 정지(정지 프레임 바로 전송) + 자율 동작 중단 + 소리 끔 |
| `kit.hold(el, onDown, onUp)` | **누르는 동안만** 버튼. 포인터 캡처·touch-action 자동. 창이 떠 있으면 눌러도 무시 |
| `kit.block(el)` | 이 요소(창)가 보이는 동안 움직임을 막는다 |
| `kit.isBlocked()` | 지금 막혀 있는가 |
| `kit.connected` · `kit.running` | 연결됨? / 자율 동작 중? (읽기 전용) |

속도 감각(03 §1): 300 순항 · 330~450 게임 · 250 이하는 제자리 출발 못 함(킥이 해결).

## 3. 자율 동작 — 반드시 `kit.run`

```js
const started = kit.run(async (r) => {
  while (r.alive()) {                 // 정지·화면 이탈·재시작이면 false
    if (r.sensor.ir2 < 200) break;
    r.drive(300, 0);
    if (!await r.sleep(100)) return;  // 기다리는 사이 정지되면 false → 바로 return
  }
  r.drive(0, 0);
});
if (!started) kit.toast('이미 움직이는 중이에요');
```

| `r.` | 설명 |
|---|---|
| `alive()` | 이 실행이 아직 유효한가 |
| `drive(s, st)` | 유효할 때만 움직임 지시 |
| `sleep(ms)` → `Promise<boolean>` | 기다린 뒤 유효하면 true. **false 면 그 뒤 동작을 하지 말고 return** |
| `sensor` · `fresh()` | 최신 센서 / 1.2초 안에 받은 값인가 |

- 실행 중 센서가 1.2초 끊기면 kit 이 움직임을 0 으로 만든다(S6).
- 오류가 나도 정지하고 `onRunEnd` 가 불린다.

## 4. 소리 · 신호 · LED · 도트

| API | 설명 |
|---|---|
| `kit.beep(code, ms=400)` | 부저. **ms 뒤 자동으로 꺼짐.** 코드는 실측된 8음만: 37도 39레 41미 42파 44솔 46라 48시 49높은도 |
| `kit.signal(name)` | **신호 사전**(05 §3). `success` `fail` `notice` `start` `caught`. 뜻이 있는 소리는 이걸로 |
| `kit.led(mask)` | LED. 실측된 값은 **15 = 전방등**, 0 = 끔. 나머지 비트는 미실측(03 §6) |
| `kit.dot.number(n)` | 도트에 0~99 |
| `kit.dot.bytes(rows)` | 8바이트 그림: 바이트=행(위→아래), 비트7=맨 왼쪽 |
| `kit.dot.icon(name)` | `ok`✓ `no`✗ `ask`? `heart`♥ `smile`☺ |
| `kit.dot.clear()` · `kit.dot.calibrate()` | 지우기 / 방향 맞추기 화면(모든 앱 공용 저장) |

`kit.state` 로 `AltinoState` 를 직접 만질 수 있지만, **소리는 `beep`·`signal`, 움직임은 `drive` 로** —
직접 만지면 S2·S7 이 깨진다(12 문서).

## 5. 저장 · 공용 데이터

| API | 저장 위치 | 설명 |
|---|---|---|
| `kit.store.get(key, 기본값)` · `set(key, 값)` · `remove(key)` | `altino.t07.key` | **이 앱만** 쓰는 저장. 값은 JSON 으로 |
| `kit.store.num(key, 기본값, 최소, 최대)` | 〃 | 숫자를 범위로 잘라 읽기 — 망가진 저장값 방어 |
| `kit.team.get()` · `set(이름)` | `altino.team.name` | **모둠 알티노 이름**(12자). t01 이 짓고 모든 앱이 읽음 |
| `kit.record.add({title, detail, stars})` | `altino.record` | **성장기록부**에 한 줄. title 40자·detail 120자·stars 0~3. 앱 번호·시각 자동 |
| `kit.record.list()` · `ofApp(id)` | 〃 | 전체 / 한 앱의 기록 (t15 졸업식이 모음) |

- `localStorage` 를 직접 쓰지 않는다(검사기가 잡음). 다른 앱의 `altino.tNN.*` 를 읽지 않는다.
- 저장은 **태블릿에** 된다. 앱을 **지우고 새로 깔면 날아간다** — 업데이트는 덮어쓰기로(06 §5).

## 6. 화면 도우미

| API | 설명 |
|---|---|
| `kit.toast(글, ms=1800)` | 짧은 안내 |
| `await kit.confirm({title, lines, okText, cancelText, danger})` | 확인창 → true/false. **기본 `confirm()` 은 태블릿에서 먹통** |
| `kit.openConnect()` | 연결창 열기(상단 🔗 칩을 눌러도 열림) |
| `kit.stickerCode(name, addr)` | BLE 이름 → 로봇 스티커 번호(BF16) |
| `kit.josa(낱말, '과와')` | 받침 보고 조사 붙이기: `josa('BF12','과와')` → `BF12와` (`'이가'` `'은는'` `'을를'`) |

## 7. 시험 도구가 쓰는 창구 (앱에서 쓰지 말 것)

- `window.__altinoKit` — `tests/smoke.mjs` 가 kit 을 들여다보는 통로. 앱 코드에서 쓰면 검사기가 잡는다.
- `AltinoKit.SIGNALS` · `AltinoKit.ICONS` — 신호·아이콘 정의(문서·시험용).
