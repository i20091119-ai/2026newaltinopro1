// Function 1 — "알티노 자율배송" (원본 활동지/인수인계서 흐름 + 블록 코딩 통합)
// 서사 → ①빛(조도)기준 → ②수학 복구코드 → ③배송지 문자 → ④블록으로 주행코드 완성 →
// 출발! 센서 자율주행 → 터널(조도<임계)에서 소리 미션 → 도착 시 배송지 문자 표시 → 정지.
'use strict';
(function () {
  const P = window.AltinoProtocol;
  const T = window.AltinoTransport;

  const state = new P.AltinoState();
  const assembler = new P.SensorFrameAssembler();
  let transport = null, streamTimer = null, running = false;
  const STREAM_MS = 50;
  const sensor = { ir1: 999, ir2: 999, ir3: 999, ir4: 999, ir5: 999, ir6: 999, cds: 999, battery: 0 };

  // 보정 상수
  let WALL_THRESH = 130;   // ir2 < 이 값 → 앞 벽
  let LIGHT_THRESH = 300;  // 조도 < 이 값 → 터널(어두움)
  let TURN_MS = 700, DRIVE_SPEED = 320, TURN_SPEED = 280;
  const CELL_MS = 500, WALL_TIMEOUT = 5000;

  // 진행 상태
  let step = 1;
  let grade = null, recoverCode = null;   // 복구 코드(암호)
  let zone = null;                          // 배송지 {name, code}
  const program = [];

  // ---- 학년별 복구코드 문제 (원본: 초4 각도 / 중1 일차 / 고1 이차) ----
  const PROBLEMS = {
    e4: { label: '초4 · 각도', list: [
      { q: '커브에서 왼쪽으로 20°, 다시 15° 더 꺾었다. 모두 몇 도?', a: 35 },
      { q: '25° + 20° = ?', a: 45 }, { q: '40° + 30° = ?', a: 70 } ] },
    m1: { label: '중1 · 일차방정식', list: [
      { q: '2x − 12 = 84 를 만족하는 x는?', a: 48 },
      { q: '5x = 45 의 x는?', a: 9 }, { q: '3x + 5 = 50 의 x는?', a: 15 } ] },
    h1: { label: '고1 · 이차방정식', list: [
      { q: 'x² − 50x + 624 = 0 의 큰 근은?', a: 26 },
      { q: 'x² − 9x + 20 = 0 의 큰 근은?', a: 5 }, { q: 'x² − 13x + 40 = 0 의 큰 근은?', a: 8 } ] },
  };
  const ZONES = [
    { name: '북부 물류창고', code: 'N' }, { name: '동부 집하장', code: 'E' },
    { name: '중앙 배송센터', code: 'D' }, { name: '서부 터미널', code: 'W' }, { name: '남부 보관소', code: 'S' },
  ];
  // 8x8 도트 글자(윗줄→아랫줄, MSB=왼쪽) — 배송 도착 표시용(방향은 실기에서 조정 가능)
  const FONT = {
    N: [0x00,0x42,0x62,0x52,0x4A,0x46,0x42,0x00],
    E: [0x00,0x7E,0x40,0x7C,0x40,0x40,0x7E,0x00],
    D: [0x00,0x7C,0x42,0x42,0x42,0x42,0x7C,0x00],
    W: [0x00,0x41,0x41,0x49,0x49,0x55,0x22,0x00],
    S: [0x00,0x3E,0x40,0x3C,0x02,0x02,0x7C,0x00],
  };

  const $ = (id) => document.getElementById(id);
  const setStatus = (t, c) => { const e = $('status'); if (e) { e.textContent = t; e.className = 'status ' + (c || ''); } };
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  function toast(m) { const t = $('toast'); t.textContent = m; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 1500); }

  function startStream() { stopStream(); streamTimer = setInterval(() => {
    if (transport && transport.connected) { try { transport.send(P.buildFrame(state)); } catch (e) {} }
  }, STREAM_MS); }
  function stopStream() { if (streamTimer) clearInterval(streamTimer), streamTimer = null; }
  function setDrive(m, s) { state.go(m, m); state.steer(s); }
  const BATT_LOW = 700; let battWarned = false;
  function onSensor(s) {
    Object.assign(sensor, s);
    const a = $('cdsNow'), b = $('ir2Now'); if (a) a.textContent = s.cds; if (b) b.textContent = s.ir2;
    const c = $('battChip');
    if (c && s.battery > 0) {
      c.style.display = ''; c.textContent = '🔋 ' + s.battery;
      const low = s.battery < BATT_LOW; c.classList.toggle('err', low);
      if (low && !battWarned) { battWarned = true; toast('🔋 배터리 낮음! 충전/교체'); }
      if (!low) battWarned = false;
    }
  }

  // ---- 스텝 이동 ----
  function go(n) {
    step = n;
    for (let i = 1; i <= 5; i++) $('step' + i).classList.toggle('hidden', i !== n);
    document.querySelectorAll('.dot-step').forEach((d, i) => { d.classList.toggle('on', i + 1 === n); d.classList.toggle('done', i + 1 < n); });
    if (n === 3) setupZone();
    if (n === 5) renderSummary();
  }

  // ---- ② 복구코드 ----
  let curP = null;
  function pickGrade(g) {
    grade = g;
    const set = PROBLEMS[g]; curP = set.list[Math.floor(Math.random() * set.list.length)];
    $('probText').textContent = curP.q; $('ansInput').value = ''; $('ansFb').textContent = '';
    $('probWrap').classList.remove('hidden'); $('codeReveal').classList.add('hidden'); $('toStep3').classList.add('hidden');
    document.querySelectorAll('.gradebtn').forEach(b => b.classList.toggle('sel', b.dataset.g === g));
    $('ansInput').focus();
  }
  function checkAns() {
    const v = parseInt($('ansInput').value, 10);
    if (isNaN(v)) { $('ansFb').textContent = '숫자를 입력하세요.'; return; }
    if (v === curP.a) {
      recoverCode = curP.a; $('codeVal').textContent = recoverCode;
      $('codeReveal').classList.remove('hidden'); $('toStep3').classList.remove('hidden');
      $('ansFb').textContent = '복구 성공! 🔑';
    } else $('ansFb').textContent = '복구 실패 — 다시 계산해 봐요.';
  }

  // ---- ③ 배송지 ----
  function setupZone() {
    if (!zone) zone = ZONES[Math.floor(Math.random() * ZONES.length)];
    $('destName').textContent = zone.name;
    const t = $('zoneTable'); t.querySelectorAll('.zrow').forEach(r => r.remove());
    ZONES.forEach(z => { const tr = document.createElement('tr'); tr.className = 'zrow' + (z.code === zone.code ? ' hit' : '');
      tr.innerHTML = `<td>${z.name}</td><td>${z.code}</td>`; t.appendChild(tr); });
    $('letterVal').textContent = zone.code;
  }

  // ---- ④ 블록 ----
  const ICON = { wall: '🧱 벽까지 직진', fwd: '⬆️ 앞으로', left: '↰ 좌회전', right: '↱ 우회전' };
  function addBlock(type) { program.push({ type, n: 1 }); renderProgram(); }
  function renderProgram() {
    const w = $('program'); w.innerHTML = '';
    if (!program.length) w.innerHTML = '<p class="cap">「🧱벽까지 직진 → 회전」을 이어 붙여 코스를 완성해요 🧩</p>';
    program.forEach((b, i) => {
      const c = document.createElement('div'); c.className = 'pblock ' + b.type;
      c.innerHTML = `<span class="idx">${i + 1}</span><span class="lab">${ICON[b.type] + (b.type === 'fwd' ? ` ${b.n}칸` : '')}</span>`;
      if (b.type === 'fwd') c.onclick = () => { b.n = b.n % 5 + 1; renderProgram(); };
      const x = document.createElement('button'); x.className = 'pdel'; x.textContent = '✕';
      x.onclick = (e) => { e.stopPropagation(); program.splice(i, 1); renderProgram(); };
      c.appendChild(x); w.appendChild(c);
    });
    $('goRun').disabled = program.length === 0;
  }

  // ---- ⑤ 요약 + 출발(자율주행 + 미션) ----
  function renderSummary() {
    $('sumLight').textContent = LIGHT_THRESH;
    $('sumCode').textContent = recoverCode != null ? recoverCode : '--';
    $('sumLetter').textContent = zone ? zone.code : '--';
  }
  function showLetter(code) {  // 도트매트릭스에 배송지 문자
    const rows = FONT[code] || FONT.D;
    state.displayMode = 0xFF; for (let i = 0; i < 8; i++) state.dot[i] = rows[i];
  }
  function clearLetter() { state.dotClear(); }
  async function soundMission() {  // 터널 미션: 도·미 3회 (부저)
    for (let i = 0; i < 3 && running; i++) {
      state.soundSet(41); await sleep(300); state.soundSet(37); await sleep(300);
    }
    state.soundSet(0);
  }
  async function driveToWall() {
    const t0 = Date.now(); let tunnelFired = false;
    while (running && Date.now() - t0 < WALL_TIMEOUT) {
      if (sensor.ir2 < WALL_THRESH) break;
      if (!tunnelFired && sensor.cds < LIGHT_THRESH) { tunnelFired = true; toast('🕳️ 터널! 소리 미션 🎵'); soundMission(); }
      setDrive(DRIVE_SPEED, 0); await sleep(STREAM_MS);
    }
    setDrive(0, 0);
  }
  async function timedForward(n) { const t0 = Date.now(); while (running && Date.now() - t0 < CELL_MS * n) { if (sensor.ir2 < WALL_THRESH) break; setDrive(DRIVE_SPEED, 0); await sleep(STREAM_MS); } setDrive(0, 0); }
  async function turn(dir) { setDrive(TURN_SPEED, dir * 127); await sleep(TURN_MS); setDrive(0, 0); }

  async function runDelivery() {
    if (running || !program.length) return;
    running = true; setRunUI(true); clearLetter(); toast('배송 시작! 🚚');
    for (let i = 0; i < program.length && running; i++) {
      highlight(i); const b = program[i];
      if (b.type === 'wall') await driveToWall();
      else if (b.type === 'fwd') await timedForward(b.n);
      else if (b.type === 'left') await turn(-1);
      else if (b.type === 'right') await turn(1);
      setDrive(0, 0); await sleep(200);
    }
    highlight(-1);
    if (running && zone) {
      showLetter(zone.code);                 // 도트매트릭스
      $('arriveLetter').textContent = zone.code; $('arriveName').textContent = zone.name;
      $('arrive').classList.remove('hidden'); // 태블릿에 크게
      toast(`📦 배송 완료! [${zone.code}]`);
      await sleep(3000);
      $('arrive').classList.add('hidden');
    }
    setDrive(0, 0); clearLetter(); running = false; setRunUI(false);
  }
  function stopRun() { running = false; setDrive(0, 0); clearLetter(); state.soundSet(0); setRunUI(false); highlight(-1); }
  function setRunUI(on) { $('goRun').classList.toggle('hidden', on); $('stopRun').classList.toggle('hidden', !on);
    document.querySelectorAll('.palette button,.pblock,#undoBtn,#clearBtn,#backStep4').forEach(el => el.style.pointerEvents = on ? 'none' : ''); }
  function highlight(i) { document.querySelectorAll('.pblock').forEach((el, k) => el.classList.toggle('run', k === i)); }

  // ---- 연결 ----
  async function connect(kind, addr) {
    await disconnect();
    try {
      if (kind === 'native') { transport = new T.AndroidBridgeTransport(); setStatus('🔗 연결 중…', 'pending'); if (addr) await transport.connectTo(addr); else await transport.connect(); }
      else { transport = new T.MockTransport(); await transport.connect({}); }
      transport.on('status', s => { if (s === 'connected') setStatus('🔗 연결됨 ✓', 'ok'); else if (s === 'disconnected') setStatus('🔗 연결 끊김', 'off'); else setStatus('⚠ ' + s.replace('error:', ''), 'err'); });
      transport.on('data', bytes => { for (const f of assembler.push(bytes)) onSensor(f); });
      if (kind !== 'native') setStatus('🔗 연결됨 ✓ (데모)', 'ok');
    } catch (e) { setStatus('⚠ 연결 실패', 'err'); transport = null; }
  }
  async function disconnect() { stopRun(); if (transport) { try { await transport.disconnect(); } catch (e) {} } transport = null; }

  function init() {
    // 스텝 네비게이션
    $('toStep2').onclick = () => { LIGHT_THRESH = +$('lightInput').value || 300; go(2); };
    $('toStep3').onclick = () => go(3);
    $('toStep4').onclick = () => go(4);
    $('toStep5').onclick = () => go(5);
    document.querySelectorAll('[data-back]').forEach(b => b.onclick = () => go(+b.dataset.back));
    // 조도 임계 입력 동기화
    $('lightInput').addEventListener('input', () => { LIGHT_THRESH = +$('lightInput').value || 300; });
    // ② 복구코드
    document.querySelectorAll('.gradebtn').forEach(b => b.onclick = () => pickGrade(b.dataset.g));
    $('ansOk').onclick = checkAns; $('ansInput').addEventListener('keydown', e => { if (e.key === 'Enter') checkAns(); });
    // ④ 블록
    document.querySelectorAll('[data-block]').forEach(b => b.onclick = () => { if (!running) addBlock(b.dataset.block); });
    $('undoBtn').onclick = () => { if (!running) { program.pop(); renderProgram(); } };
    $('clearBtn').onclick = () => { if (!running) { program.length = 0; renderProgram(); } };
    // ⑤ 출발
    $('goRun').onclick = runDelivery; $('stopRun').onclick = stopRun;
    // 보정
    const bind = (id, set, span) => { const el = $(id); el.addEventListener('input', () => { set(+el.value); if ($(span)) $(span).textContent = el.value; }); if ($(span)) $(span).textContent = el.value; };
    bind('calWall', v => WALL_THRESH = v, 'calWallV'); bind('calTurn', v => TURN_MS = v, 'calTurnV'); bind('calSpeed', v => DRIVE_SPEED = v, 'calSpeedV');
    // 연결
    $('connBtn').onclick = () => { if (T.AndroidBridgeTransport.supported) connect('native'); else connect('mock'); };
    $('btSettings').onclick = () => { if (T.AndroidBridgeTransport.supported) new T.AndroidBridgeTransport().openSettings(); else toast('실기(APK)에서만 열려요'); };

    window.addEventListener('blur', stopRun);
    document.addEventListener('visibilitychange', () => { if (document.hidden) stopRun(); });

    renderProgram(); startStream(); setRunUI(false); go(1);
    if (T.AndroidBridgeTransport.supported) connect('native'); else setStatus('🔗 연결 안 됨 (데모 가능)', 'off');
  }
  document.addEventListener('DOMContentLoaded', init);
})();
