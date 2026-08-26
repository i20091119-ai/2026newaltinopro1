// UI 배선 + 50ms 상태 스트리밍 루프.
// 앱과 동일하게: 조작은 상태만 바꾸고, 타이머가 매 주기 프레임을 전송한다.
'use strict';
(function () {
  const P = window.AltinoProtocol;
  const T = window.AltinoTransport;

  const state = new P.AltinoState();
  const assembler = new P.SensorFrameAssembler();
  let transport = null;
  let streamTimer = null;
  const STREAM_MS = 100;
  let speed = 300;          // 기본 속도 (앱 기본값과 동일)

  const $ = (id) => document.getElementById(id);
  const setStatus = (txt, cls) => { const el = $('status'); el.textContent = txt; el.className = 'status ' + (cls || ''); };

  // ---- 스트리밍 ----
  function startStream() {
    stopStream();
    streamTimer = setInterval(() => {
      if (transport && transport.connected) {
        try { transport.send(P.buildFrame(state)); } catch (e) {}
      }
    }, STREAM_MS);
  }
  function stopStream() { if (streamTimer) { clearInterval(streamTimer); streamTimer = null; } }

  // ---- 연결 ----
  async function connect(kind) {
    await disconnect();
    try {
      if (kind === 'ws') {
        transport = new T.WebSocketTransport();
        const url = $('wsurl').value.trim();
        setStatus('연결 중… ' + url, 'pending');
        await transport.connect({ url });
      } else if (kind === 'serial') {
        transport = new T.WebSerialTransport();
        setStatus('시리얼 포트 선택…', 'pending');
        await transport.connect({ baudRate: parseInt($('baud').value, 10) || 9600 });
      } else if (kind === 'native') {
        transport = new T.AndroidBridgeTransport();
        setStatus('네이티브 브리지 연결…', 'pending');
        await transport.connect({});
      } else {
        transport = new T.MockTransport();
        setStatus('목(mock) 연결', 'pending');
        await transport.connect({});
      }
      transport.on('status', (s) => {
        const b = String(s).split(':')[0];
        if (b === 'connected') setStatus('연결됨 ✓', 'ok');
        else if (b === 'reconnecting') setStatus('재연결 중…', 'pending');
        else if (b === 'disconnected') setStatus('연결 끊김', 'off');
        else setStatus('오류: ' + s.replace('error:', ''), 'err');
      });
      transport.on('data', (bytes) => {
        const frames = assembler.push(bytes);
        if (frames.length) updateSensors(frames[frames.length - 1]);
      });
      setStatus('연결됨 ✓', 'ok');
      startStream();
    } catch (e) {
      setStatus('연결 실패: ' + e.message, 'err');
      transport = null;
    }
  }
  async function disconnect() {
    stopStream();
    state.stopAll();
    if (transport) { try { await transport.send(P.buildFrame(state)); } catch (e) {} try { await transport.disconnect(); } catch (e) {} }
    transport = null;
    setStatus('연결 안 됨', 'off');
  }

  // ---- 센서 표시 ----
  function updateSensors(s) {
    $('sv-bat').textContent = s.battery;
    $('sv-cds').textContent = s.cds;
    for (let i = 1; i <= 6; i++) $('sv-ir' + i).textContent = s['ir' + i];
  }

  // ---- 주행 버튼 (누르는 동안만 동작 = 앱과 동일) ----
  function bindHold(el, onDown, onUp) {
    const down = (e) => { e.preventDefault(); onDown(); el.classList.add('pressed'); };
    const up = (e) => { if (e) e.preventDefault(); onUp(); el.classList.remove('pressed'); };
    el.addEventListener('touchstart', down, { passive: false });
    el.addEventListener('touchend', up, { passive: false });
    el.addEventListener('touchcancel', up, { passive: false });
    el.addEventListener('mousedown', down);
    el.addEventListener('mouseup', up);
    el.addEventListener('mouseleave', (e) => { if (el.classList.contains('pressed')) up(e); });
  }

  function init() {
    // 주행 D-pad — 앱의 DirectionButtonctrl 동작 재현
    bindHold($('btn-up'),    () => { state.go(speed, speed);  state.ledSet(3); },    () => { state.go(0, 0); state.ledSet(0); });
    bindHold($('btn-down'),  () => { state.go(-speed, -speed); state.ledSet(780); }, () => { state.go(0, 0); state.ledSet(0); });
    bindHold($('btn-left'),  () => { state.steer(-127); state.ledSet(160); },        () => { state.steer(0); state.ledSet(0); });
    bindHold($('btn-right'), () => { state.steer(127);  state.ledSet(80); },         () => { state.steer(0); state.ledSet(0); });

    $('btn-stop').addEventListener('click', () => { state.stopAll(); });

    // 속도 슬라이더
    const sp = $('speed'); const spv = $('speedval');
    sp.addEventListener('input', () => { speed = parseInt(sp.value, 10); spv.textContent = speed; });
    spv.textContent = speed; sp.value = speed;

    // 조향 슬라이더 (연속 조향)
    const st = $('steer'); const stv = $('steerval');
    st.addEventListener('input', () => { const v = parseInt(st.value, 10); state.steer(v); stv.textContent = v; });
    st.addEventListener('change', () => { st.value = 0; state.steer(0); stv.textContent = 0; });

    // LED 토글 버튼들
    document.querySelectorAll('[data-led]').forEach(b => {
      b.addEventListener('click', () => {
        const v = parseInt(b.dataset.led, 10);
        state.ledSet(state.led === v ? 0 : v);
        document.querySelectorAll('[data-led]').forEach(x => x.classList.toggle('active', parseInt(x.dataset.led,10)===state.led && state.led!==0));
      });
    });

    // 부저: 누르는 동안 소리
    document.querySelectorAll('[data-sound]').forEach(b => {
      const v = parseInt(b.dataset.sound, 10);
      bindHold(b, () => state.soundSet(v), () => state.soundSet(0));
    });

    // 도트매트릭스 8x8 그리기
    const grid = $('dotgrid');
    for (let row = 1; row <= 8; row++) {
      for (let col = 1; col <= 8; col++) {
        const c = document.createElement('div');
        c.className = 'dot'; c.dataset.col = col; c.dataset.row = row;
        c.addEventListener('click', () => {
          const on = c.classList.toggle('on');
          if (on) state.dotOn(col, row); else state.dotOff(col, row);
        });
        grid.appendChild(c);
      }
    }
    $('dot-clear').addEventListener('click', () => {
      state.dotClear();
      grid.querySelectorAll('.dot').forEach(d => d.classList.remove('on'));
    });

    // 연결 버튼
    $('c-ws').addEventListener('click', () => connect('ws'));
    $('c-serial').addEventListener('click', () => connect('serial'));
    $('c-mock').addEventListener('click', () => connect('mock'));
    $('c-disc').addEventListener('click', () => disconnect());
    if (!T.WebSerialTransport.supported) { $('c-serial').disabled = true; $('c-serial').title = '이 브라우저 미지원'; }
    // WebView 래퍼 앱: 살아있는 연결이면 이어받기, 바인딩된 로봇이 있으면 그 로봇만(자동 임의연결 안 함)
    if (T.AndroidBridgeTransport.supported) {
      $('wsurl').value = '(WebView 네이티브 브리지)';
      const st = new T.AndroidBridgeTransport().state();
      if (st.connected || st.address) connect('native');
      else setStatus('로봇 미선택 — 코딩/술래잡기 화면에서 로봇을 먼저 고르세요', 'off');
    }

    // 안전: 화면 이탈/숨김 시 정지
    window.addEventListener('blur', () => state.stopAll());
    document.addEventListener('visibilitychange', () => { if (document.hidden) state.stopAll(); });

    setStatus('연결 안 됨', 'off');
  }

  document.addEventListener('DOMContentLoaded', init);
})();
