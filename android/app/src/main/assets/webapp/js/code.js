// Function 1 — "자율주행 코딩" (순차 블록 조립)
// 블록(앞으로 N칸 / 좌회전 / 우회전 / 뒤로)을 순서대로 놓고, 수학 문제를 풀어 출발.
// 앱이 각 블록을 정해진 시간만큼 모터/조향 명령으로 실행(데드레커닝, 현장 보정).
'use strict';
(function () {
  const P = window.AltinoProtocol;
  const T = window.AltinoTransport;

  const state = new P.AltinoState();
  let transport = null, streamTimer = null, running = false;
  const STREAM_MS = 50;
  let selectedGrade = 'e3';

  // ---- 주행 보정 상수(현장에서 조절) ----
  let MS_CELL = 600;     // '앞으로 1칸' 지속시간(ms)
  let TURN_MS = 700;     // 90° 회전 지속시간(ms)
  let DRIVE_SPEED = 350; // 직진 속도
  let TURN_SPEED = 300;  // 회전 시 전진 속도

  const program = [];    // [{type:'fwd'|'back'|'left'|'right', n}]

  const $ = (id) => document.getElementById(id);
  const setStatus = (t, c) => { const e = $('status'); if (e) { e.textContent = t; e.className = 'status ' + (c || ''); } };
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // ---- 스트림(상시) : state를 50ms마다 전송 ----
  function startStream() { stopStream(); streamTimer = setInterval(() => {
    if (transport && transport.connected) { try { transport.send(P.buildFrame(state)); } catch (e) {} }
  }, STREAM_MS); }
  function stopStream() { if (streamTimer) { clearInterval(streamTimer); streamTimer = null; } }
  function setDrive(motor, steer) { state.go(motor, motor); state.steer(steer); }

  // ---- 블록 편집 ----
  const ICON = { fwd: '⬆️ 앞으로', back: '⬇️ 뒤로', left: '↰ 좌회전', right: '↱ 우회전' };
  function addBlock(type) { program.push({ type, n: 1 }); renderProgram(); }
  function renderProgram() {
    const wrap = $('program'); wrap.innerHTML = '';
    if (!program.length) { wrap.innerHTML = '<p class="cap">아래 블록을 눌러 순서를 만들어요 🧩</p>'; }
    program.forEach((b, i) => {
      const chip = document.createElement('div'); chip.className = 'pblock ' + b.type;
      const label = ICON[b.type] + ((b.type === 'fwd' || b.type === 'back') ? ` ${b.n}칸` : '');
      chip.innerHTML = `<span class="idx">${i + 1}</span><span class="lab">${label}</span>`;
      if (b.type === 'fwd' || b.type === 'back') {
        chip.title = '눌러서 칸 수 바꾸기';
        chip.onclick = () => { b.n = b.n % 5 + 1; renderProgram(); };
      }
      const x = document.createElement('button'); x.className = 'pdel'; x.textContent = '✕';
      x.onclick = (e) => { e.stopPropagation(); program.splice(i, 1); renderProgram(); };
      chip.appendChild(x); wrap.appendChild(chip);
    });
    $('runBtn').disabled = program.length === 0 || running;
  }

  // ---- 실행(인터프리터) ----
  async function runProgram() {
    if (running || !program.length) return;
    running = true; setRunUI(true);
    for (let i = 0; i < program.length && running; i++) {
      highlight(i);
      const b = program[i];
      if (b.type === 'fwd') { setDrive(DRIVE_SPEED, 0); await sleep(MS_CELL * b.n); }
      else if (b.type === 'back') { setDrive(-DRIVE_SPEED, 0); await sleep(MS_CELL * b.n); }
      else if (b.type === 'left') { setDrive(TURN_SPEED, -127); await sleep(TURN_MS); }
      else if (b.type === 'right') { setDrive(TURN_SPEED, 127); await sleep(TURN_MS); }
      setDrive(0, 0); await sleep(220);   // 블록 사이 잠깐 정지
    }
    setDrive(0, 0); highlight(-1); running = false; setRunUI(false);
    if (program.length) toast('주행 끝! 🎉');
  }
  function stopRun() { running = false; setDrive(0, 0); setRunUI(false); highlight(-1); }
  function setRunUI(on) {
    $('runBtn').classList.toggle('hidden', on);
    $('stopBtn').classList.toggle('hidden', !on);
    document.querySelectorAll('.palette button,.pblock').forEach(el => el.style.pointerEvents = on ? 'none' : '');
  }
  function highlight(i) {
    document.querySelectorAll('.pblock').forEach((el, k) => el.classList.toggle('run', k === i));
  }

  // ---- 수학 게이트(출발 암호) ----
  let curAnswer = null;
  function openGate() {
    if (!program.length) { toast('블록을 먼저 만들어요!'); return; }
    const pool = window.AltinoProblems.GRADE_POOLS[selectedGrade] || window.AltinoProblems.GRADE_POOLS.e3;
    const p = pool[Math.floor(Math.random() * pool.length)];
    curAnswer = p.a; $('gateQ').textContent = p.q;
    $('gateInput').value = ''; $('gateFb').textContent = '';
    $('gateModal').classList.remove('hidden'); $('gateInput').focus();
  }
  function checkGate() {
    const v = parseInt($('gateInput').value, 10);
    if (isNaN(v)) { $('gateFb').textContent = '숫자를 입력하세요.'; return; }
    if (v === curAnswer) { $('gateModal').classList.add('hidden'); toast('출발! 🚗'); runProgram(); }
    else $('gateFb').textContent = '다시! 계산을 확인해요.';
  }
  function toast(m) { const t = $('toast'); t.textContent = m; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 1300); }

  // ---- 연결(간단: 네이티브 자동 / 브라우저 목) ----
  async function connect(kind, addr) {
    await disconnect();
    try {
      if (kind === 'native') { transport = new T.AndroidBridgeTransport(); if (addr) await transport.connectTo(addr); else await transport.connect(); setStatus('🔗 연결 중…', 'pending'); }
      else { transport = new T.MockTransport(); await transport.connect({}); }
      transport.on('status', (s) => {
        if (s === 'connected') setStatus('🔗 연결됨 ✓', 'ok');
        else if (s === 'disconnected') setStatus('🔗 연결 끊김', 'off');
        else setStatus('⚠ ' + s.replace('error:', ''), 'err');
      });
      if (kind !== 'native') setStatus('🔗 연결됨 ✓', 'ok');
    } catch (e) { setStatus('⚠ 연결 실패', 'err'); transport = null; }
  }
  async function disconnect() { stopRun(); if (transport) { try { await transport.disconnect(); } catch (e) {} } transport = null; }
  function openBtSettings() { if (T.AndroidBridgeTransport.supported) new T.AndroidBridgeTransport().openSettings(); else toast('실기(APK)에서만 열려요'); }

  function init() {
    document.querySelectorAll('[data-block]').forEach(b => b.addEventListener('click', () => { if (!running) addBlock(b.dataset.block); }));
    $('clearBtn').addEventListener('click', () => { if (!running) { program.length = 0; renderProgram(); } });
    $('undoBtn').addEventListener('click', () => { if (!running) { program.pop(); renderProgram(); } });
    $('runBtn').addEventListener('click', openGate);
    $('stopBtn').addEventListener('click', stopRun);
    $('gateOk').addEventListener('click', checkGate);
    $('gateInput').addEventListener('keydown', e => { if (e.key === 'Enter') checkGate(); });
    $('gateClose').addEventListener('click', () => $('gateModal').classList.add('hidden'));
    $('grade').addEventListener('change', e => selectedGrade = e.target.value);
    selectedGrade = $('grade').value;

    // 보정 슬라이더
    const bind = (id, set, span) => { const el = $(id); el.addEventListener('input', () => { set(+el.value); $(span).textContent = el.value; }); $(span).textContent = el.value; };
    bind('calCell', v => MS_CELL = v, 'calCellV');
    bind('calTurn', v => TURN_MS = v, 'calTurnV');
    bind('calSpeed', v => DRIVE_SPEED = v, 'calSpeedV');

    $('connBtn').addEventListener('click', () => {
      if (T.AndroidBridgeTransport.supported) connect('native'); else connect('mock');
    });
    $('btSettings').addEventListener('click', openBtSettings);

    window.addEventListener('blur', stopRun);
    document.addEventListener('visibilitychange', () => { if (document.hidden) stopRun(); });

    renderProgram(); startStream(); setRunUI(false);
    if (T.AndroidBridgeTransport.supported) connect('native'); else setStatus('🔗 연결 안 됨 (데모 가능)', 'off');
  }
  document.addEventListener('DOMContentLoaded', init);
})();
