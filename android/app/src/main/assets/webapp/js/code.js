// Function 1 — "자율주행 코딩" v2 (센서 조건 블록)
// 목표: 블록을 짜서 알티노가 n자 코스를 스스로 주행(벽에 안 부딪힘).
// 핵심: '벽까지 직진' 블록이 전면 센서(ir2)로 벽을 감지해 자동 정지 → 다음 블록(회전).
//       '반복'을 켜면 프로그램을 계속 돌려 코스를 자율 주행.
'use strict';
(function () {
  const P = window.AltinoProtocol;
  const T = window.AltinoTransport;

  const state = new P.AltinoState();
  const assembler = new P.SensorFrameAssembler();
  let transport = null, streamTimer = null, running = false, loopOn = false;
  const STREAM_MS = 50;
  let selectedGrade = 'e3';

  // 최신 센서값(벽 감지에 사용). TOF: 값이 작을수록 벽에 가까움.
  const sensor = { ir1: 999, ir2: 999, ir3: 999, ir4: 999, ir5: 999, ir6: 999 };

  // ---- 보정 상수(현장 조절) ----
  let WALL_THRESH = 130;  // ir2가 이 값보다 작아지면 '벽 도달'로 보고 정지
  let TURN_MS = 700;      // 90° 회전 시간(ms)
  let DRIVE_SPEED = 320;  // 직진 속도
  let TURN_SPEED = 280;   // 회전 시 전진 속도
  const CELL_MS = 500;    // '앞으로 N칸'의 1칸 시간
  const WALL_TIMEOUT = 5000; // 벽을 못 만나도 이 시간이면 멈춤(안전)

  const program = [];     // [{type, n}]

  const $ = (id) => document.getElementById(id);
  const setStatus = (t, c) => { const e = $('status'); if (e) { e.textContent = t; e.className = 'status ' + (c || ''); } };
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  function startStream() { stopStream(); streamTimer = setInterval(() => {
    if (transport && transport.connected) { try { transport.send(P.buildFrame(state)); } catch (e) {} }
  }, STREAM_MS); }
  function stopStream() { if (streamTimer) { clearInterval(streamTimer); streamTimer = null; } }
  function setDrive(motor, steer) { state.go(motor, motor); state.steer(steer); }
  function onSensor(s) { Object.assign(sensor, s); const el = $('ir2now'); if (el) el.textContent = s.ir2; }

  // ---- 블록 편집 ----
  const ICON = { wall: '🧱 벽까지 직진', fwd: '⬆️ 앞으로', left: '↰ 좌회전', right: '↱ 우회전' };
  function addBlock(type) { program.push({ type, n: 1 }); renderProgram(); }
  function renderProgram() {
    const wrap = $('program'); wrap.innerHTML = '';
    if (!program.length) wrap.innerHTML = '<p class="cap">블록을 눌러 순서를 만들어요. 예) 🧱벽까지 직진 → ↱우회전 → 🔁반복 🧩</p>';
    program.forEach((b, i) => {
      const chip = document.createElement('div'); chip.className = 'pblock ' + b.type;
      const label = ICON[b.type] + (b.type === 'fwd' ? ` ${b.n}칸` : '');
      chip.innerHTML = `<span class="idx">${i + 1}</span><span class="lab">${label}</span>`;
      if (b.type === 'fwd') { chip.title = '눌러서 칸 수 바꾸기'; chip.onclick = () => { b.n = b.n % 5 + 1; renderProgram(); }; }
      const x = document.createElement('button'); x.className = 'pdel'; x.textContent = '✕';
      x.onclick = (e) => { e.stopPropagation(); program.splice(i, 1); renderProgram(); };
      chip.appendChild(x); wrap.appendChild(chip);
    });
    $('runBtn').disabled = program.length === 0 || running;
  }

  // ---- 인터프리터(센서 조건) ----
  async function driveToWall() {
    const t0 = Date.now();
    while (running && (Date.now() - t0) < WALL_TIMEOUT) {
      if (sensor.ir2 < WALL_THRESH) break;   // 앞 벽 도달 → 정지
      setDrive(DRIVE_SPEED, 0); await sleep(STREAM_MS);
    }
    setDrive(0, 0);
  }
  async function timedForward(n) {
    const t0 = Date.now();
    while (running && (Date.now() - t0) < CELL_MS * n) {
      if (sensor.ir2 < WALL_THRESH) break;   // 안전: 앞 막히면 정지
      setDrive(DRIVE_SPEED, 0); await sleep(STREAM_MS);
    }
    setDrive(0, 0);
  }
  async function turn(dir) { setDrive(TURN_SPEED, dir * 127); await sleep(TURN_MS); setDrive(0, 0); }

  async function runProgram() {
    if (running || !program.length) return;
    running = true; setRunUI(true);
    do {
      for (let i = 0; i < program.length && running; i++) {
        highlight(i);
        const b = program[i];
        if (b.type === 'wall') await driveToWall();
        else if (b.type === 'fwd') await timedForward(b.n);
        else if (b.type === 'left') await turn(-1);
        else if (b.type === 'right') await turn(1);
        setDrive(0, 0); await sleep(200);
      }
    } while (loopOn && running);
    setDrive(0, 0); highlight(-1); running = false; setRunUI(false);
    if (!loopOn) toast('주행 끝! 🎉');
  }
  function stopRun() { running = false; setDrive(0, 0); setRunUI(false); highlight(-1); }
  function setRunUI(on) {
    $('runBtn').classList.toggle('hidden', on);
    $('stopBtn').classList.toggle('hidden', !on);
    document.querySelectorAll('.palette button,.pblock,#loopBtn,#undoBtn,#clearBtn').forEach(el => el.style.pointerEvents = on ? 'none' : '');
  }
  function highlight(i) { document.querySelectorAll('.pblock').forEach((el, k) => el.classList.toggle('run', k === i)); }

  // ---- 수학 게이트 ----
  let curAnswer = null;
  function openGate() {
    if (!program.length) { toast('블록을 먼저 만들어요!'); return; }
    const pool = window.AltinoProblems.GRADE_POOLS[selectedGrade] || window.AltinoProblems.GRADE_POOLS.e3;
    const p = pool[Math.floor(Math.random() * pool.length)];
    curAnswer = p.a; $('gateQ').textContent = p.q; $('gateInput').value = ''; $('gateFb').textContent = '';
    $('gateModal').classList.remove('hidden'); $('gateInput').focus();
  }
  function checkGate() {
    const v = parseInt($('gateInput').value, 10);
    if (isNaN(v)) { $('gateFb').textContent = '숫자를 입력하세요.'; return; }
    if (v === curAnswer) { $('gateModal').classList.add('hidden'); toast('출발! 🚗'); runProgram(); }
    else $('gateFb').textContent = '다시! 계산을 확인해요.';
  }
  function toast(m) { const t = $('toast'); t.textContent = m; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 1300); }

  // ---- 연결 ----
  async function connect(kind, addr) {
    await disconnect();
    try {
      if (kind === 'native') { transport = new T.AndroidBridgeTransport(); setStatus('🔗 연결 중…', 'pending'); if (addr) await transport.connectTo(addr); else await transport.connect(); }
      else { transport = new T.MockTransport(); await transport.connect({}); }
      transport.on('status', (s) => {
        if (s === 'connected') setStatus('🔗 연결됨 ✓', 'ok');
        else if (s === 'disconnected') setStatus('🔗 연결 끊김', 'off');
        else setStatus('⚠ ' + s.replace('error:', ''), 'err');
      });
      transport.on('data', (bytes) => { for (const f of assembler.push(bytes)) onSensor(f); });
      if (kind !== 'native') setStatus('🔗 연결됨 ✓ (데모)', 'ok');
    } catch (e) { setStatus('⚠ 연결 실패', 'err'); transport = null; }
  }
  async function disconnect() { stopRun(); if (transport) { try { await transport.disconnect(); } catch (e) {} } transport = null; }

  function init() {
    document.querySelectorAll('[data-block]').forEach(b => b.addEventListener('click', () => { if (!running) addBlock(b.dataset.block); }));
    $('undoBtn').addEventListener('click', () => { if (!running) { program.pop(); renderProgram(); } });
    $('clearBtn').addEventListener('click', () => { if (!running) { program.length = 0; renderProgram(); } });
    $('loopBtn').addEventListener('click', () => { loopOn = !loopOn; $('loopBtn').classList.toggle('on', loopOn); $('loopBtn').textContent = loopOn ? '🔁 반복: 켜짐' : '🔁 반복: 꺼짐'; });
    $('runBtn').addEventListener('click', openGate);
    $('stopBtn').addEventListener('click', stopRun);
    $('gateOk').addEventListener('click', checkGate);
    $('gateInput').addEventListener('keydown', e => { if (e.key === 'Enter') checkGate(); });
    $('gateClose').addEventListener('click', () => $('gateModal').classList.add('hidden'));
    $('grade').addEventListener('change', e => selectedGrade = e.target.value); selectedGrade = $('grade').value;

    const bind = (id, set, span) => { const el = $(id); el.addEventListener('input', () => { set(+el.value); $(span).textContent = el.value; }); $(span).textContent = el.value; };
    bind('calWall', v => WALL_THRESH = v, 'calWallV');
    bind('calTurn', v => TURN_MS = v, 'calTurnV');
    bind('calSpeed', v => DRIVE_SPEED = v, 'calSpeedV');

    $('connBtn').addEventListener('click', () => { if (T.AndroidBridgeTransport.supported) connect('native'); else connect('mock'); });
    $('btSettings').addEventListener('click', () => { if (T.AndroidBridgeTransport.supported) new T.AndroidBridgeTransport().openSettings(); else toast('실기(APK)에서만 열려요'); });

    window.addEventListener('blur', stopRun);
    document.addEventListener('visibilitychange', () => { if (document.hidden) stopRun(); });

    renderProgram(); startStream(); setRunUI(false);
    if (T.AndroidBridgeTransport.supported) connect('native'); else setStatus('🔗 연결 안 됨 (데모 가능)', 'off');
  }
  document.addEventListener('DOMContentLoaded', init);
})();
