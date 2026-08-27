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
  const STREAM_MS = 50;
  // (재연결은 네이티브가 담당 — JS 타이머 불필요)

  const DRIVE = 250;          // 정밀 조작을 위해 순항보다 느리게
  const STEER = 100;
  const intent = { drive: 0, steer: 0 };

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
    $('scoreArea').classList.add('hidden');
    $('preMeasure').classList.remove('hidden');
    $('resultBox').classList.add('hidden');
    $('errInput').value = ''; $('errFb').textContent = '';
    intent.drive = 0;
  }

  function startStream() { stopStream(); streamTimer = setInterval(tick, STREAM_MS); }
  function stopStream() { if (streamTimer) { clearInterval(streamTimer); streamTimer = null; } }
  function tick() {
    const m = intent.drive * DRIVE;
    state.go(m, m); state.steer(intent.steer);
    if (transport && transport.connected) { try { transport.send(P.buildFrame(state)); } catch (e) {} }
  }

  const BATT_LOW = 700; let battWarned = false, lastUi = 0;
  function onSensor(s) {
    front = s.ir2;
    const now = Date.now(); if (now - lastUi < 200) return; lastUi = now;
    if ($('frontNow')) $('frontNow').textContent = front;
    if ($('frontChip')) $('frontChip').textContent = front;
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
  function bindHold(el, onDown, onUp) {
    const d = (e) => { e.preventDefault(); onDown(); el.classList.add('pressed'); };
    const u = (e) => { if (e) e.preventDefault(); onUp(); el.classList.remove('pressed'); };
    el.addEventListener('touchstart', d, { passive: false });
    el.addEventListener('touchend', u, { passive: false });
    el.addEventListener('touchcancel', u, { passive: false });
    el.addEventListener('mousedown', d); el.addEventListener('mouseup', u);
    el.addEventListener('mouseleave', (e) => { if (el.classList.contains('pressed')) u(e); });
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
        <p class="lead" style="margin:0 0 8px">차 바닥 스티커 번호(예: <b>BD77</b>)를 찾아 탭하세요.</p>
        <input id="scanSearch" type="text" placeholder="번호로 검색 (예: BD77)" style="width:100%;margin-bottom:8px;font-size:1.1rem;padding:10px 12px;border-radius:12px;border:2px solid var(--line);text-align:center">
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
    bindHold($('d-up'),    () => intent.drive = 1,  () => intent.drive = 0);
    bindHold($('d-down'),  () => intent.drive = -1, () => intent.drive = 0);
    bindHold($('d-left'),  () => intent.steer = -STEER, () => intent.steer = 0);
    bindHold($('d-right'), () => intent.steer = STEER,  () => intent.steer = 0);
    $('parkBtn').onclick = park;
    $('errOk').onclick = checkErr;
    $('errInput').addEventListener('keydown', e => { if (e.key === 'Enter') checkErr(); });
    $('nextBtn').onclick = newRound;
    $('connBtn').onclick = () => { if (T.AndroidBridgeTransport.supported) pickAndConnect(); else connect('mock'); };
    $('btSettings').onclick = () => { if (T.AndroidBridgeTransport.supported) new T.AndroidBridgeTransport().openSettings(); else toast('실기(APK)에서만 열려요'); };
    $('status').addEventListener('click', () => { if (T.AndroidBridgeTransport.supported) pickAndConnect(); });

    window.addEventListener('blur', () => intent.drive = 0);
    document.addEventListener('visibilitychange', () => { if (document.hidden) intent.drive = 0; });

    newRound();
    startStream();
    if (T.AndroidBridgeTransport.supported) { setStatus('🔗 연결 안 됨', 'off'); nativeStart(); } // 연결됨→이어받기 / 바인딩됨→그 로봇 / 없음→스캔
    else setStatus('🔗 연결 안 됨 (데모 가능)', 'off');
  }
  document.addEventListener('DOMContentLoaded', init);
})();
