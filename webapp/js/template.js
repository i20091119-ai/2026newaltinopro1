// ═══════════════════════════════════════════════════════════════════
// 알티노 학교자율시간 앱 템플릿 (template.js)
//
// 이 파일을 복사해 새 앱을 시작하세요. 구역이 두 가지입니다:
//   ★ 공통 구역 — 연결/스캔/짝잠금/스트리밍/센서 수신. 전 앱 동일해야 하므로
//               수정 금지. (수정이 필요하면 3인 합의 후 전 앱 동시 반영)
//   ✎ 앱 구역  — 여러분의 활동 내용. 마음껏 바꾸세요.
//
// 반드시 지킬 것 (이유는 docs/dev-guide/04_시행착오_사례집.md):
//   1. 로봇 제어는 전부 state.*() + 10Hz 스트리밍. BLE 직접 호출 금지.
//   2. 페이지 진입 시 nativeStart() — 다른 앱에서 살아있는 연결을 이어받음.
//   3. 학생 진행 상태는 localStorage에 저장 (연결 끊김·재시작 대비).
//   4. localStorage 키는 앱 고유 접두 사용 (예: 'altinoT07V1').
// ═══════════════════════════════════════════════════════════════════
'use strict';
(function () {
  const P = window.AltinoProtocol;
  const T = window.AltinoTransport;

  // ───────────────────────────────────────────────
  // ★ 공통: 상태·전송 기본 골격
  // ───────────────────────────────────────────────
  const state = new P.AltinoState();           // 로봇에 보낼 논리 상태(조향·모터·소리·도트·LED)
  const assembler = new P.SensorFrameAssembler(); // 수신 바이트 → 54바이트 센서 프레임 조립
  let transport = null, streamTimer = null;
  const STREAM_MS = 100;                       // 10Hz 고정 — 12대 동시 운영 시 전파 혼잡 방지. 올리지 말 것.

  const $ = (id) => document.getElementById(id);
  const setStatus = (t, c) => { const e = $('status'); e.textContent = t; e.className = 'status ' + (c || ''); };
  function toast(m) { const t = $('toast'); t.textContent = m; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 1400); }
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // 스트리밍: 현재 state를 10Hz로 계속 전송. 조작은 state만 바꾸면 됨.
  function startStream() { stopStream(); streamTimer = setInterval(tick, STREAM_MS); }
  function stopStream() { if (streamTimer) { clearInterval(streamTimer); streamTimer = null; } }
  function tick() {
    // ✎ 주행형 앱이면 여기서 intent → state 반영 (아래 조종 예시 참고)
    const m = intent.drive * DRIVE;
    state.go(m, m); state.steer(intent.steer * STEER);
    if (transport && transport.connected) { try { transport.send(P.buildFrame(state)); } catch (e) {} }
  }

  // ───────────────────────────────────────────────
  // ★ 공통: 센서 수신 (UI 갱신은 200ms 스로틀 — 숫자 떨림 방지)
  // ───────────────────────────────────────────────
  // 센서 객체 s: {ir1,ir2,ir3,ir4,ir5,ir6,cds,battery}
  //   ir1/2/3=전면 좌/중/우 TOF, ir4=우측면, ir5=좌측면, ir6=후면, cds=조도
  //   TOF는 '작을수록 가까움' (개방≈1300, 5cm≈60)
  const BATT_LOW = 700; let battWarned = false, lastUi = 0;
  let latest = null;                           // 최신 센서값 — 앱 로직에서 자유롭게 사용
  function onSensor(s) {
    latest = s;
    const now = Date.now(); if (now - lastUi < 200) return; lastUi = now;
    $('chipIr2').textContent = s.ir2;
    $('chipCds').textContent = Math.max(30, s.cds);   // 조도 최소 30 표시(0 혼란 방지 관례)
    const c = $('battChip');
    if (c && s.battery > 0) {
      c.style.display = ''; c.textContent = '🔋 ' + s.battery;
      const low = s.battery < BATT_LOW; c.classList.toggle('err', low);
      if (low && !battWarned) { battWarned = true; toast('🔋 배터리 낮음! 충전/교체'); }
      if (!low) battWarned = false;
    }
    // ✎ 앱 로직에서 센서를 쓰려면 여기서 호출하거나 latest를 참조
  }

  // ───────────────────────────────────────────────
  // ★ 공통: 연결 — nativeStart() 패턴 (수정 금지)
  //   연결됨 → 입양(adopt: 살아있는 링크 이어받기, 재연결 아님)
  //   짝 있음 → 그 로봇에만 연결   /   없음 → 스캔 피커
  //   재연결은 네이티브(APK)가 전담 — JS에서 재연결 타이머 만들지 말 것.
  // ───────────────────────────────────────────────
  function connErr(s) {
    const m = { 'error:no-bound': '로봇을 먼저 선택', 'error:give-up': '연결 실패 — 다시 선택', 'error:no-uart-char': 'UART 특성 없음', 'error:notify-failed': '알림 설정 실패', 'error:busy': '연결 중(스캔 불가)', 'error:no-bluetooth': '블루투스 없음', 'error:bluetooth-off': '블루투스를 켜세요', 'error:location-off': '태블릿 위치(Location)를 켜주세요 — 스캔에 필요', 'error:scan-failed': '스캔 실패' };
    return m[s] || s.replace('error:', '');
  }
  function wireNative(t) {
    t.on('status', (s) => {
      const b = String(s).split(':')[0];       // 'disconnected:remote' → 'disconnected'
      if (b === 'connected') setStatus('🔗 연결됨 ✓', 'ok');
      else if (b === 'reconnecting') setStatus('🔗 재연결 중…', 'pending');
      else if (b === 'disconnected') setStatus('🔗 연결 끊김', 'off');
      else setStatus('⚠ ' + connErr(s), 'err');
    });
    t.on('data', (bytes) => { for (const f of assembler.push(bytes)) onSensor(f); });
  }
  async function connect(kind, addr) {
    await disconnect();
    try {
      if (kind === 'native') { transport = new T.AndroidBridgeTransport(); wireNative(transport); setStatus('🔗 연결 중…', 'pending'); if (addr) await transport.connectTo(addr); else await transport.connect(); }
      else { transport = new T.MockTransport(); wireNative(transport); await transport.connect({}); setStatus('🔗 연결됨 ✓ (데모)', 'ok'); }
    } catch (e) { setStatus('⚠ 연결 실패', 'err'); transport = null; }
  }
  function adoptNative() { transport = new T.AndroidBridgeTransport(); wireNative(transport); transport.adopt(); }
  function nativeStart() {
    if (!T.AndroidBridgeTransport.supported) { connect('mock'); return; }  // 브라우저 개발 시 자동 데모
    const st = new T.AndroidBridgeTransport().state();
    if (st.connected) adoptNative();
    else if (st.address) connect('native', st.address);
    else pickAndConnect();
  }
  async function disconnect() {
    stopScanning(); state.stopAll();
    if (transport) { try { await transport.send(P.buildFrame(state)); } catch (e) {} try { await transport.disconnect(); } catch (e) {} }
    transport = null; setStatus('🔗 연결 안 됨', 'off');
  }

  // ───────────────────────────────────────────────
  // ★ 공통: 스캔 피커 — 스티커번호 ⟨BF16⟩ 표시 + 1:1 짝 잠금 + 짝 해제 (수정 금지)
  // ───────────────────────────────────────────────
  let scanner = null, scanDevs = [];
  function stopScanning() { if (scanner) { try { scanner.stopScan(); } catch (e) {} scanner = null; } }
  function pickAndConnect() {
    if (!T.AndroidBridgeTransport.supported) { connect('mock'); return; }
    scanDevs = [];
    let ov = $('scanOverlay');
    if (!ov) {
      ov = document.createElement('div'); ov.id = 'scanOverlay';
      ov.style.cssText = 'position:fixed;inset:0;background:rgba(20,20,30,.55);display:flex;align-items:center;justify-content:center;z-index:40';
      ov.innerHTML = `<div style="background:#fff;border-radius:20px;padding:20px 22px;width:min(560px,92vw);max-height:82vh;overflow:auto;box-shadow:var(--shadow)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <h2 style="margin:0">🔗 알티노 연결 <span style="font-size:.9rem;color:var(--mut)">(페어링 필요 없어요)</span></h2>
          <button id="scanClose" class="btn ghost" style="padding:6px 12px">닫기</button></div>
        <p class="lead" style="margin:0 0 8px">차 바닥 스티커의 <b>Bluetooth No.</b>(예: <b>BF16</b>)를 찾아 탭하세요. 한 번 고르면 <b>그 차에만</b> 연결/재연결돼요.</p>
        <input id="scanSearch" type="text" placeholder="번호로 검색 (예: BF16)" style="width:100%;margin-bottom:8px">
        <div id="scanList"><p class="lead">🔍 주변 알티노를 찾는 중… 차 전원을 켜주세요.</p></div>
        <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap"><button id="scanSettings" class="btn ghost">📶 블루투스 설정</button><button id="scanUnbind" class="btn ghost">🔓 이 태블릿 짝 해제</button></div></div>`;
      document.body.appendChild(ov);
      ov.querySelector('#scanClose').onclick = () => { stopScanning(); ov.classList.add('hidden'); };
      ov.querySelector('#scanSettings').onclick = () => { try { new T.AndroidBridgeTransport().openSettings(); } catch (e) {} };
      ov.querySelector('#scanUnbind').onclick = () => { try { new T.AndroidBridgeTransport().unbind(); } catch (e) {} toast('짝 해제됨 — 새 로봇을 고르세요'); renderScan(); };
      ov.querySelector('#scanSearch').addEventListener('input', renderScan);
    }
    ov.classList.remove('hidden');
    stopScanning();
    scanner = new T.AndroidBridgeTransport();
    scanner.on('scan', d => { if (!d || !d.address) return; const i = scanDevs.findIndex(x => x.address === d.address); if (i >= 0) { if (d.name) scanDevs[i].name = d.name; } else scanDevs.push({ name: d.name || '', address: d.address, rssi: d.rssi || 0 }); renderScan(); });
    scanner.startScan();
    renderScan();
  }
  function renderScan() {
    const list = $('scanList'); if (!list) return;
    const q = ($('scanSearch') && $('scanSearch').value || '').trim().toLowerCase();
    const devs = scanDevs.filter(d => !q || (d.name || '').toLowerCase().includes(q) || (d.address || '').toLowerCase().replace(/:/g, '').includes(q.replace(/:/g, '')));
    if (!devs.length) { list.innerHTML = '<p class="lead">🔍 주변 알티노를 찾는 중… 차 전원을 켜주세요.</p>'; return; }
    devs.sort((a, b) => (b.rssi || -999) - (a.rssi || -999));
    const boundSt = new T.AndroidBridgeTransport().state();
    const bound = boundSt.address || '';
    list.innerHTML = '';
    devs.forEach((d, i) => {
      const b = document.createElement('button'); b.className = 'btn ghost'; b.style.cssText = 'display:block;width:100%;text-align:left;margin-bottom:8px';
      const code = stickerCode(d.name, d.address);
      const near = i === 0 && d.rssi ? ' <span style="color:var(--mint);font-size:.8rem">· 가장 가까움</span>' : '';
      const locked = bound && d.address !== bound;
      const tag = d.address === bound ? ' <span style="color:var(--sun);font-size:.8rem">· 내 짝 ✓</span>' : (locked ? ' <span style="color:var(--mut);font-size:.8rem">· 🔒 짝 해제 필요</span>' : '');
      b.innerHTML = `🚗 <b style="font-size:1.5rem;color:var(--blue)">⟨${code}⟩</b>${near}${tag}<br><span style="font-size:.75rem;color:var(--mut)">${d.name || ''} · ${d.address}</span>`;
      if (locked) b.style.opacity = '.5';
      b.onclick = () => {
        if (bound && d.address !== bound) { toast('이 태블릿은 ⟨' + stickerCode(boundSt.name, bound) + '⟩과 짝이에요 — [🔓 짝 해제]를 먼저 누르세요'); return; }
        stopScanning(); $('scanOverlay').classList.add('hidden'); connect('native', d.address);
      };
      list.appendChild(b);
    });
  }
  function mac4(addr) { const h = String(addr || '').replace(/:/g, ''); return h.slice(-4).toUpperCase(); }
  // 로봇 몸체 'Bluetooth No.'(예: BF16)는 BLE 이름에 들어있음(ALTINO-NBF16)
  function stickerCode(name, addr) {
    const up = String(name || '').toUpperCase().trim();
    const PRE = ['ALTINO-NEO-', 'ALTINO-NEO', 'ALTINO-LITE-', 'ALTINO-LITE', 'ALTINO-N', 'ALTINO-L', 'ALTINO-', 'ALTINO', 'SMARTFARM-', 'SMARTFARM', 'REALFARM-', 'REALFARM'];
    let c = up;
    for (const p of PRE) if (up.startsWith(p)) { c = up.slice(p.length); break; }
    c = c.replace(/^[\-\s_]+/, '');
    return /^[A-Z0-9]{2,8}$/.test(c) ? c : mac4(addr);
  }

  // ───────────────────────────────────────────────
  // ★ 공통 헬퍼: 소리(부저) — 계이름 코드는 이 8개만 사용
  // ───────────────────────────────────────────────
  const NOTE_NAME = { 37: '도', 39: '레', 41: '미', 42: '파', 44: '솔', 46: '라', 48: '시', 49: '높은도' };
  const NOTE_FREQ = { 37: 523.25, 39: 587.33, 41: 659.25, 42: 698.46, 44: 783.99, 46: 880.0, 48: 987.77, 49: 1046.5 };
  let audioCtx = null;
  function beep(freq, ms) {         // 태블릿 스피커 — 로봇 미연결에도 소리 확인 가능
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'square'; o.frequency.value = freq; g.gain.value = 0.08;
      o.connect(g); g.connect(audioCtx.destination); o.start(); o.stop(audioCtx.currentTime + ms / 1000);
    } catch (e) {}
  }
  async function playNote(code, ms) {   // 로봇 부저 + 태블릿 동시 재생. soundSet(0)으로 반드시 끄기!
    beep(NOTE_FREQ[code] || 660, ms || 400);
    if (transport && transport.connected) {
      try { state.soundSet(code); transport.send(P.buildFrame(state)); await sleep((ms || 400) + 20); state.soundSet(0); transport.send(P.buildFrame(state)); } catch (e) {}
    }
  }

  // ───────────────────────────────────────────────
  // ★ 공통 헬퍼: 도트매트릭스 — 180° 보정 내장 (수정 금지)
  //   로봇 정면에서 보는 사람 기준으로 숫자가 바르게 보임.
  //   dot180(c,r): 1..8 좌표를 180° 회전해 찍음.
  // ───────────────────────────────────────────────
  const DOT_FONT = { // 3×5 숫자 폰트 (행 5개, 각 행 3비트)
    0: [0b111, 0b101, 0b101, 0b101, 0b111], 1: [0b010, 0b110, 0b010, 0b010, 0b111],
    2: [0b111, 0b001, 0b111, 0b100, 0b111], 3: [0b111, 0b001, 0b111, 0b001, 0b111],
    4: [0b101, 0b101, 0b111, 0b001, 0b001], 5: [0b111, 0b100, 0b111, 0b001, 0b111],
    6: [0b111, 0b100, 0b111, 0b101, 0b111], 7: [0b111, 0b001, 0b010, 0b010, 0b010],
    8: [0b111, 0b101, 0b111, 0b101, 0b111], 9: [0b111, 0b101, 0b111, 0b001, 0b111],
  };
  const dot180 = (c, r) => state.dotOn(9 - c, 9 - r);
  function stampDigit(d, baseCol) {     // baseCol: 숫자 왼쪽 열(1..6)
    const rows = DOT_FONT[d]; if (!rows) return;
    for (let dr = 0; dr < 5; dr++) for (let dc = 0; dc < 3; dc++)
      if (rows[dr] & (1 << (2 - dc))) dot180(baseCol + dc, 2 + dr);
  }
  function drawNumber(n) {              // 0..99 를 도트에 표시 (십의 자리=왼쪽) — 현장 검증된 배치
    n = Math.max(0, Math.min(99, n | 0));
    state.dotClear(); state.displayMode = 0xFF;
    if (n < 10) stampDigit(n, 3);
    else { stampDigit((n / 10) | 0, 5); stampDigit(n % 10, 1); }
    if (transport && transport.connected) { try { transport.send(P.buildFrame(state)); } catch (e) {} }
  }

  // ───────────────────────────────────────────────
  // ★ 공통 헬퍼: 진행 상태 저장 — 키는 앱 고유로! ('altino' + 앱ID + 'V1')
  // ───────────────────────────────────────────────
  const SAVE_KEY = 'altinoTplV1';       // ✎ 새 앱에선 반드시 변경 (예: 'altinoT07V1')
  function saveState(obj) { try { localStorage.setItem(SAVE_KEY, JSON.stringify(obj)); } catch (e) {} }
  function loadState() { try { return JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch (e) { return null; } }
  function clearState() { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} }

  // ═══════════════════════════════════════════════
  // ✎ 앱 구역: 여기부터 여러분의 활동 내용
  //   (아래는 조종·소리·도트·기록 데모 — 필요한 것만 남기고 교체)
  // ═══════════════════════════════════════════════
  let DRIVE = 250;                      // 150~550 권장 (300=순항, 550=최고 체감)
  const STEER = 100;                    // 조향 -127..127
  const intent = { drive: 0, steer: 0 };
  let count = 0;

  function bindHold(el, onDown, onUp) { // 터치·마우스 겸용 '누르는 동안' 버튼
    const d = (e) => { e.preventDefault(); onDown(); el.classList.add('pressed'); };
    const u = (e) => { if (e) e.preventDefault(); onUp(); el.classList.remove('pressed'); };
    el.addEventListener('touchstart', d, { passive: false });
    el.addEventListener('touchend', u, { passive: false });
    el.addEventListener('touchcancel', u, { passive: false });
    el.addEventListener('mousedown', d); el.addEventListener('mouseup', u);
    el.addEventListener('mouseleave', (e) => { if (el.classList.contains('pressed')) u(e); });
  }

  function init() {
    // 조종 데모
    bindHold($('d-up'),    () => intent.drive = 1,  () => intent.drive = 0);
    bindHold($('d-down'),  () => intent.drive = -1, () => intent.drive = 0);
    bindHold($('d-left'),  () => intent.steer = -1, () => intent.steer = 0);
    bindHold($('d-right'), () => intent.steer = 1,  () => intent.steer = 0);
    $('d-stop').onclick = () => { intent.drive = 0; intent.steer = 0; };
    $('spd').addEventListener('input', e => { DRIVE = +e.target.value; $('spdVal').textContent = DRIVE; });

    // 소리 데모
    Object.keys(NOTE_NAME).forEach(code => { const o = document.createElement('option'); o.value = code; o.textContent = NOTE_NAME[code]; $('note').appendChild(o); });
    $('playNote').onclick = () => playNote(+$('note').value, 400);

    // LED 데모
    $('ledOn').onclick = () => { state.ledSet(15); toast('💡 LED 켬'); };
    $('ledOff').onclick = () => { state.ledSet(0); };

    // 도트매트릭스 데모
    $('dotShow').onclick = () => { drawNumber(+$('dotNum').value || 0); toast('도트 표시: ' + (+$('dotNum').value || 0)); };
    $('dotClear').onclick = () => { state.dotClear(); };

    // 기록(localStorage) 데모 — 재시작해도 유지
    const saved = loadState();
    if (saved && typeof saved.count === 'number') count = saved.count;
    $('cnt').textContent = count;
    $('cntUp').onclick = () => { count++; $('cnt').textContent = count; saveState({ count }); };
    $('cntReset').onclick = () => { count = 0; $('cnt').textContent = count; clearState(); };

    // 안전: 화면 이탈 시 정지
    window.addEventListener('blur', () => { intent.drive = 0; });
    document.addEventListener('visibilitychange', () => { if (document.hidden) intent.drive = 0; });

    // ★ 공통: 상태칩 탭 → 연결창, 진입 즉시 연결 이어받기, 스트리밍 시작
    $('status').addEventListener('click', () => { if (T.AndroidBridgeTransport.supported) pickAndConnect(); else connect('mock'); });
    nativeStart();
    startStream();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
