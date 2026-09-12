// 심화활동 — "정밀 주차 챌린지"
// 모든 활동을 끝낸 학생용 5분 도전. 배움 기둥 ①(센서 숫자→수학)의 심화:
//   차를 몰아 목표 TOF 거리에 정확히 멈추고, 멈춘 뒤 '오차 = |목표 − 현재|'를 직접 계산.
//   오차가 작을수록 고득점 → 측정·어림·절댓값(차이) 수학을 경쟁적으로 연습.
'use strict';
(function () {
  const P = window.AltinoProtocol;
  const T = window.AltinoTransport;

  const state = new P.AltinoState();
  const assembler = new P.SensorFrameAssembler();
  let transport = null, streamTimer = null;
  // ⚠ 50(20Hz)이었다. 다른 화면은 전부 100(10Hz)로 내렸는데 여기만 남아 있었다.
  //   12대가 동시에 20Hz로 쏘면 블루투스가 밀려 명령이 씹힌다 — '버튼이 잘 안 먹는' 증상.
  const STREAM_MS = 100;
  // (재연결은 네이티브가 담당 — JS 타이머 불필요)

  // 정밀 조작이라 순항보다 느리게 간다. 그런데 250은 제자리에서 출발할 때
  // 모터가 못 이기고 안 도는 일이 있었다(꼬리잡기의 최저 속도가 330인 이유와 같다).
  // → 출발하는 순간만 짧게 세게 밀어 주고(KICK), 곧 느린 속도로 떨어뜨린다.
  const DRIVE = 250;
  const KICK = 400, KICK_MS = 180;
  const STEER = 100;
  const intent = { drive: 0, steer: 0 };
  let kickUntil = 0, lastDrive = 0;

  // 챌린지 상태
  let target = 120;           // 목표 TOF
  let front = null;           // 최신 전면 TOF(ir2)
  let snapshot = null;        // 주차 순간 측정값
  let tries = 0, best = null, minErr = null;

  const $ = (id) => document.getElementById(id);
  const setStatus = (t, c) => { const e = $('status'); e.textContent = t; e.className = 'status ' + (c || ''); };
  function toast(m) { const t = $('toast'); t.textContent = m; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 1400); }

  // 목표 거리 후보(작을수록 벽에 가까움). 너무 코앞(<70)은 부딪히기 쉬워 제외.
  const TARGETS = [90, 110, 130, 150, 170, 200];
  function newRound() {
    let t; do { t = TARGETS[Math.floor(Math.random() * TARGETS.length)]; } while (TARGETS.length > 1 && t === target);
    target = t;
    snapshot = null;
    $('targetVal').textContent = target;
    if ($('howTgt')) $('howTgt').textContent = target;
    renderTrack();
    $('scoreArea').classList.add('hidden');
    $('preMeasure').classList.remove('hidden');
    $('resultBox').classList.add('hidden');
    $('errInput').value = ''; $('errFb').textContent = '';
    intent.drive = 0; intent.steer = 0;
  }

  function startStream() { stopStream(); streamTimer = setInterval(tick, STREAM_MS); }
  function stopStream() { if (streamTimer) { clearInterval(streamTimer); streamTimer = null; } }
  // 연결창·확인창이 떠 있으면 조작을 받지 않는다 — 패드를 누른 채 창이 열리면
  // 차가 계속 달렸다(꼬리잡기와 같은 문제).
  function inputBlocked() {
    const ov = $('scanOverlay');
    if (ov && !ov.classList.contains('hidden')) return true;
    const cf = document.getElementById('altinoConfirm');
    if (cf && cf.style.display === 'flex') return true;
    return false;
  }

  function tick() {
    if (inputBlocked()) { intent.drive = 0; intent.steer = 0; }
    // 멈춰 있다가 막 출발하는 순간에만 KICK — 그 뒤로는 느린 DRIVE 로 정밀하게
    if (intent.drive !== 0 && lastDrive === 0) kickUntil = Date.now() + KICK_MS;
    lastDrive = intent.drive;
    const speed = (Date.now() < kickUntil) ? KICK : DRIVE;
    const m = intent.drive * speed;
    state.go(m, m); state.steer(intent.steer);
    if (transport && transport.connected) { try { transport.send(P.buildFrame(state)); } catch (e) {} }
  }

  // 막대에서 값이 놓일 자리(0~100%). 벽에 붙으면 왼쪽, 멀면 오른쪽.
  const TRACK_MIN = 60, TRACK_MAX = 320;
  const pos = (v) => Math.max(0, Math.min(100, ((v - TRACK_MIN) / (TRACK_MAX - TRACK_MIN)) * 100));
  const OK_BAND = 5;                     // 이 안이면 ⭐⭐⭐
  function renderTrack() {
    const mt = $('mkTgt'), mn = $('mkNow'), zn = $('tgtZone'), gd = $('guide');
    if (!mt) return;
    mt.style.left = pos(target) + '%';
    const lo = pos(target - OK_BAND), hi = pos(target + OK_BAND);
    if (zn) {                      // 실제 폭이 얇아도 눈에 보이게 최소 폭을 준다
      const w = Math.max(6, hi - lo);
      zn.style.left = Math.max(0, lo - (w - (hi - lo)) / 2) + '%';
      zn.style.width = w + '%';
    }
    if (front == null) {
      mn.style.display = 'none';
      if (gd) { gd.textContent = '로봇을 연결하고 ▲▼ 로 움직여 보세요'; gd.className = 'guide'; }
      return;
    }
    mn.style.display = ''; mn.style.left = pos(front) + '%';
    if (!gd) return;
    const d = front - target;            // +면 목표보다 멀다(앞으로 더 가야 함)
    if (Math.abs(d) <= OK_BAND) { gd.textContent = '딱 좋아요! 🅿️ 주차 완료를 누르세요 🎯'; gd.className = 'guide ok'; }
    else if (d > 0) { gd.textContent = `▲ 조금 더 앞으로 — ${d} 남았어요`; gd.className = 'guide far'; }
    else { gd.textContent = `▼ 너무 가까워요 — ${-d} 만큼 뒤로`; gd.className = 'guide near'; }
  }

  const BATT_LOW = 700; let battWarned = false, lastUi = 0;
  function onSensor(s) {
    front = s.ir2;
    const now = Date.now(); if (now - lastUi < 200) return; lastUi = now;
    if ($('frontNow')) $('frontNow').textContent = front;
    if ($('frontChip')) $('frontChip').textContent = front;
    renderTrack();
    const c = $('battChip');
    if (c && s.battery > 0) { c.style.display = ''; c.textContent = '🔋 ' + s.battery; const low = s.battery < BATT_LOW; c.classList.toggle('err', low); if (low && !battWarned) { battWarned = true; toast('🔋 배터리 낮음! 충전/교체'); } if (!low) battWarned = false; }
  }

  // 주차 완료 → 현재 앞거리 스냅샷 + 차 정지 + 오차 계산 문제 제시
  function park() {
    intent.drive = 0; intent.steer = 0; state.go(0, 0); state.steer(0);
    if (transport && transport.connected) { try { transport.send(P.buildFrame(state)); } catch (e) {} }
    if (front == null) { toast('먼저 연결하고 차를 움직여 보세요 (데모는 연결 후)'); return; }
    snapshot = front;
    $('preMeasure').classList.add('hidden');
    $('scoreArea').classList.remove('hidden');
    $('resultBox').classList.add('hidden');
    $('errProb').textContent = `오차 = | 목표 ${target} − 현재 ${snapshot} | = ?`;
    $('errInput').value = ''; $('errFb').textContent = ''; $('errInput').focus();
  }

  function checkErr() {
    const v = parseInt($('errInput').value, 10);
    const fb = $('errFb');
    if (snapshot == null) return;
    const err = Math.abs(target - snapshot);
    if (isNaN(v)) { fb.textContent = '숫자를 넣어요.'; fb.style.color = 'var(--coral)'; return; }
    if (v !== err) { fb.textContent = '다시 계산! (큰 수에서 작은 수를 빼요)'; fb.style.color = 'var(--coral)'; return; }
    // 정답 → 채점
    fb.textContent = '오차 계산 정답! ✅'; fb.style.color = 'var(--mint)';
    const score = Math.max(0, 100 - err);
    const stars = err <= 5 ? '⭐⭐⭐' : err <= 15 ? '⭐⭐' : err <= 30 ? '⭐' : '💪';
    $('stars').textContent = stars;
    $('thisErr').textContent = err;
    $('thisScore').textContent = score;
    $('resultBox').classList.remove('hidden');
    tries++; $('tries').textContent = tries;
    if (best == null || score > best) best = score;
    if (minErr == null || err < minErr) minErr = err;
    $('best').textContent = best; $('minErr').textContent = minErr;
    // 로봇: 잘했으면 삐- 소리 + LED
    if (transport && transport.connected) {
      try { state.soundSet(err <= 15 ? 49 : 44); state.ledSet(15); transport.send(P.buildFrame(state)); setTimeout(() => { state.soundSet(0); state.ledSet(0); if (transport && transport.connected) transport.send(P.buildFrame(state)); }, 400); } catch (e) {}
    }
    toast(err <= 5 ? '완벽한 주차! 🏆' : err <= 15 ? '훌륭해요! 🎯' : '좋아요, 더 정확히! 💪');
  }

  // ---- 조종 ----
  // 누르고 있는 동안만 움직인다.
  // ⚠ 예전엔 mouseleave 로도 손을 뗀 것으로 처리했다. 손가락이 버튼 가장자리에서
  //   조금만 미끄러져도 차가 멈춰, 아이들 눈에는 '버튼이 안 먹는다'로 보였다.
  //   포인터를 이 버튼에 붙잡아 두면(setPointerCapture) 밖으로 나가도 놓을 때까지 유지된다.
  function bindHold(el, onDown, onUp) {
    let held = false;
    const down = (e) => {
      if (held) return; held = true;
      if (e.cancelable) e.preventDefault();
      try { if (e.pointerId != null) el.setPointerCapture(e.pointerId); } catch (err) {}
      onDown(); el.classList.add('pressed');
    };
    const up = (e) => {
      if (!held) return; held = false;
      if (e && e.cancelable) e.preventDefault();
      onUp(); el.classList.remove('pressed');
    };
    if (window.PointerEvent) {
      el.addEventListener('pointerdown', down);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    } else {
      el.addEventListener('touchstart', down, { passive: false });
      el.addEventListener('touchend', up, { passive: false });
      el.addEventListener('touchcancel', up, { passive: false });
      el.addEventListener('mousedown', down); el.addEventListener('mouseup', up);
      el.addEventListener('mouseleave', (e) => { if (held) up(e); });
    }
    // 어떤 경로로든 창을 벗어나면 반드시 놓은 것으로 — 눌린 채 남아 차가 계속 가는 일 방지
    window.addEventListener('blur', () => { if (held) up(null); });
  }

  // ---- 연결 (BLE 무페어링, tag/mode1과 동일: 바인딩된 로봇 자동 이어받기·재연결은 네이티브) ----
  function connErr(s) {
    const m = { 'error:no-bound': '로봇을 먼저 선택', 'error:give-up': '연결 실패 — 다시 선택', 'error:no-uart-char': 'UART 특성 없음', 'error:notify-failed': '알림 설정 실패', 'error:busy': '연결 중(스캔 불가)', 'error:no-bluetooth': '블루투스 없음', 'error:bluetooth-off': '블루투스를 켜세요', 'error:location-off': '태블릿 위치(Location)를 켜주세요 — 스캔에 필요' };
    return m[s] || s.replace('error:', '');
  }
  function wireNative(t) {
    t.on('status', (s) => {
      const b = String(s).split(':')[0];
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
  function adoptNative() { transport = new T.AndroidBridgeTransport(); wireNative(transport); transport.adopt(); } // 살아있는 링크 이어받기
  function nativeStart() { const st = new T.AndroidBridgeTransport().state(); if (st.connected) adoptNative(); else if (st.address) connect('native', st.address); else pickAndConnect(); }
  async function disconnect() {
    stopScanning(); state.stopAll();
    if (transport) { try { await transport.send(P.buildFrame(state)); } catch (e) {} try { await transport.disconnect(); } catch (e) {} }
    transport = null; setStatus('🔗 연결 안 됨', 'off');
  }

  // ---- BLE 스캔 피커(동적 오버레이) ----
  let scanner = null, scanDevs = [];
  // 블루투스/위치 권한을 방금 허용했다면 스캔을 다시 건다.
  // (첫 실행: 권한 없이 스캔 → 0건 → 허용 → 아무도 다시 안 걸어 목록이 계속 비어 있었다)
  window.__altinoOnPermission = function (granted) {
    if (!granted) { toast('블루투스 권한이 없으면 로봇을 찾을 수 없어요'); return; }
    try { if (scanner) scanner.startScan(); } catch (e) {}
  };
  function stopScanning() { if (scanner) { try { scanner.stopScan(); } catch (e) {} try { scanner.detach(); } catch (e) {} scanner = null; } }
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
        <p class="lead" style="margin:0 0 8px">차 바닥 스티커 번호(예: <b>BD77</b>)를 찾아 탭하세요.</p>
        <input id="scanSearch" type="text" placeholder="번호로 검색 (예: BD77)" style="width:100%;margin-bottom:8px;font-size:1.1rem;padding:10px 12px;border-radius:12px;border:2px solid var(--line);text-align:center">
        <div id="scanList"><p class="lead">🔍 주변 알티노를 찾는 중… 차 전원을 켜주세요.</p></div>
        <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap"><button id="scanSettings" class="btn ghost">📶 블루투스 설정</button><button id="scanUnbind" class="btn ghost">🔓 이 태블릿 짝 해제</button></div></div>`;
      document.body.appendChild(ov);
      ov.querySelector('#scanClose').onclick = () => { stopScanning(); ov.classList.add('hidden'); };
      ov.querySelector('#scanSettings').onclick = () => { try { new T.AndroidBridgeTransport().openSettings(); } catch (e) {} };
      ov.querySelector('#scanUnbind').onclick = async () => {
        if (!await AltinoUI.confirm({ title: '이 태블릿의 짝을 해제할까요?',
          lines: ['지금 연결된 로봇과의 짝이 풀리고 연결이 끊겨요.', '다른 로봇을 새로 골라야 해요.'],
          okText: '네, 짝 해제' })) return;
        try { new T.AndroidBridgeTransport().unbind(); } catch (e) {}
        disconnect();   // 짝만 풀고 연결을 남겨두면, 방금 남남이 된 로봇에 계속 프레임을 쏜다
        toast('짝 해제됨 — 새 로봇을 고르세요'); renderScan(); };
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
    devs.forEach(d => {
      const b = document.createElement('button'); b.className = 'btn ghost'; b.style.cssText = 'display:block;width:100%;text-align:left;margin-bottom:8px';
      const locked = bound && d.address !== bound;
      const tag = d.address === bound ? ' <span style="color:var(--sun,#ffb23e);font-size:.8rem">· 내 짝 ✓</span>' : (locked ? ' <span style="color:var(--mut);font-size:.8rem">· 🔒 짝 해제 필요</span>' : '');
      b.innerHTML = `🚗 <b style="font-size:1.15rem">${d.name || '(이름없음)'}</b>${tag}<br><span style="font-size:.85rem;color:var(--mut)">${d.address}</span>`;
      if (locked) b.style.opacity = '.5';
      b.onclick = () => {
        if (bound && d.address !== bound) { toast('이 태블릿은 이미 짝이 있어요 · [🔓 짝 해제] 먼저 누르세요'); return; }
        stopScanning(); $('scanOverlay').classList.add('hidden'); connect('native', d.address);
      };
      list.appendChild(b);
    });
  }

  function init() {
    // 연결 전에 눌러 놓고 '왜 안 가지?' 하는 일이 잦다 — 이유를 바로 말해 준다.
    let noConnWarned = 0;
    const warnIfOffline = () => {
      if (transport && transport.connected) return;
      const now = Date.now();
      if (now - noConnWarned > 2500) { noConnWarned = now; toast('로봇이 연결되어 있지 않아요 — 오른쪽 위 [🔗 연결]'); }
    };
    bindHold($('d-up'),    () => { warnIfOffline(); intent.drive = 1; },  () => intent.drive = 0);
    bindHold($('d-down'),  () => { warnIfOffline(); intent.drive = -1; }, () => intent.drive = 0);
    bindHold($('d-left'),  () => intent.steer = -STEER, () => intent.steer = 0);
    bindHold($('d-right'), () => intent.steer = STEER,  () => intent.steer = 0);
    $('parkBtn').onclick = park;
    $('errOk').onclick = checkErr;
    $('errInput').addEventListener('keydown', e => { if (e.key === 'Enter') checkErr(); });
    $('nextBtn').onclick = newRound;
    $('connBtn').onclick = () => { if (T.AndroidBridgeTransport.supported) pickAndConnect(); else connect('mock'); };
    $('btSettings').onclick = () => { if (T.AndroidBridgeTransport.supported) new T.AndroidBridgeTransport().openSettings(); else toast('실기(APK)에서만 열려요'); };
    $('status').addEventListener('click', () => { if (T.AndroidBridgeTransport.supported) pickAndConnect(); });

    // 틱을 기다리지 않고 지금 정지 프레임을 보낸다. WebView가 백그라운드로 가면
    // 타이머가 멈춰 그 틱이 영영 안 올 수 있고, 로봇은 마지막 프레임을 계속 실행한다.
    const panicStop = () => {
      intent.drive = 0; intent.steer = 0;
      try { state.go(0, 0); state.steer(0); } catch (e) {}
      if (transport && transport.connected) { try { transport.send(P.buildFrame(state)); } catch (e) {} }
    };
    window.addEventListener('blur', panicStop);
    window.addEventListener('pagehide', panicStop);
    document.addEventListener('visibilitychange', () => { if (document.hidden) panicStop(); });

    newRound();
    startStream();
    if (T.AndroidBridgeTransport.supported) { setStatus('🔗 연결 안 됨', 'off'); nativeStart(); } // 연결됨→이어받기 / 바인딩됨→그 로봇 / 없음→스캔
    else setStatus('🔗 연결 안 됨 (데모 가능)', 'off');
  }
  document.addEventListener('DOMContentLoaded', init);
})();
