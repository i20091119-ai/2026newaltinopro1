// Function 1 — "알티노 자율배송" (원본 오케스트라 프로그램의 흐름 재현 + 두 배움 기둥 강화)
// 배움 기둥 ①: 센서 숫자를 매개로 한 수학 — 밝은 곳/터널 조도 2값을 측정해 사이값(평균) 계산.
//              그 계산값이 곧 로봇의 '터널 감지 기준'이 됨(의미 있는 수학).
// 배움 기둥 ②: 아주 약간의 코딩 — 값이 담긴 블록 4개를 실행 순서대로 배치해 프로그램 완성.
// 학생 입력 = 원본 프로그램의 빈칸: ①조도값 ②암호(수학) ③미션1 소리 ④미션2 배송지 문자.
// 주행은 앱이 자동으로 TOF 벽추종(오른쪽_자율주행)을 수행. 조도<조도값=터널 → 미션.
'use strict';
(function () {
  const P = window.AltinoProtocol;
  const T = window.AltinoTransport;

  const state = new P.AltinoState();
  const assembler = new P.SensorFrameAssembler();
  let transport = null, streamTimer = null, running = false;
  const STREAM_MS = 50;
  const sensor = { ir1: 999, ir2: 999, ir3: 999, ir4: 999, ir5: 999, ir6: 999, cds: 999, battery: 0 };

  // 학생 입력(코딩 빈칸)
  let brightVal = 620, darkVal = 90; // ① 조도 측정 두 값
  let lightThresh = 355;             // ① 사이값(학생이 계산해 입력)
  let grade = null, recoverCode = null; // ② 암호(수학)
  let note1 = 37, note2 = 41, repeatN = 3; // ③ 미션1 소리(도37·미41 기본, 3회)
  let zone = null;                   // ④ 미션2 배송지 문자

  // 벽추종/주행 보정 (원본 기본값: tof1=90, tof2=100, tof3=90)
  let TOF1 = 90, TOF2 = 100, TOF3 = 90;
  let DRIVE = 350, BACK = -320, STEER = 20;
  const PHASE_TIMEOUT = 25000;

  // ② 복구코드 문제(원본 유형 유지: 초4 각도 / 중1 일차방정식 / 고1 이차방정식)
  // 학년별 20문항, 정수 정답. 난이도는 각 유형에서 가장 쉬운 수준으로만.
  const PROBLEMS = {
    e4: { label: '초4 · 각도', list: [
      { q: '왼쪽으로 20°, 다시 15° 더 꺾었다. 모두 몇 도?', a: 35 },
      { q: '25° + 20° = ?', a: 45 }, { q: '40° + 30° = ?', a: 70 },
      { q: '직각(90°)에서 30°를 빼면?', a: 60 }, { q: '35° + 25° = ?', a: 60 },
      { q: '50° + 45° = ?', a: 95 }, { q: '180° − 100° = ?', a: 80 },
      { q: '직각은 몇 도?', a: 90 }, { q: '15° + 30° = ?', a: 45 },
      { q: '90° − 25° = ?', a: 65 }, { q: '20° + 20° + 20° = ?', a: 60 },
      { q: '45° + 45° = ?', a: 90 }, { q: '180° − 90° = ?', a: 90 },
      { q: '30° + 55° = ?', a: 85 }, { q: '75° − 15° = ?', a: 60 },
      { q: '10° + 25° = ?', a: 35 }, { q: '60° + 30° = ?', a: 90 },
      { q: '90° − 45° = ?', a: 45 }, { q: '120° − 40° = ?', a: 80 },
      { q: '25° + 35° = ?', a: 60 } ] },
    m1: { label: '중1 · 일차방정식', list: [
      { q: '2x − 12 = 84 의 x는?', a: 48 }, { q: '5x = 45 의 x는?', a: 9 },
      { q: '3x + 5 = 50 의 x는?', a: 15 }, { q: 'x + 7 = 20 의 x는?', a: 13 },
      { q: '2x = 34 의 x는?', a: 17 }, { q: '4x = 48 의 x는?', a: 12 },
      { q: 'x − 9 = 21 의 x는?', a: 30 }, { q: '2x + 6 = 30 의 x는?', a: 12 },
      { q: '3x − 6 = 24 의 x는?', a: 10 }, { q: '6x = 42 의 x는?', a: 7 },
      { q: 'x + 15 = 40 의 x는?', a: 25 }, { q: '5x − 5 = 45 의 x는?', a: 10 },
      { q: '2x + 10 = 50 의 x는?', a: 20 }, { q: '7x = 56 의 x는?', a: 8 },
      { q: 'x − 13 = 7 의 x는?', a: 20 }, { q: '4x + 4 = 40 의 x는?', a: 9 },
      { q: '3x = 51 의 x는?', a: 17 }, { q: '2x − 8 = 32 의 x는?', a: 20 },
      { q: '8x = 72 의 x는?', a: 9 }, { q: 'x + 24 = 60 의 x는?', a: 36 } ] },
    h1: { label: '고1 · 이차방정식', list: [
      { q: 'x² − 50x + 624 = 0 의 큰 근은?', a: 26 }, { q: 'x² − 9x + 20 = 0 의 큰 근은?', a: 5 },
      { q: 'x² − 13x + 40 = 0 의 큰 근은?', a: 8 }, { q: 'x² − 7x + 12 = 0 의 큰 근은?', a: 4 },
      { q: 'x² − 5x + 6 = 0 의 큰 근은?', a: 3 }, { q: 'x² − 10x + 21 = 0 의 큰 근은?', a: 7 },
      { q: 'x² − 11x + 30 = 0 의 큰 근은?', a: 6 }, { q: 'x² − 8x + 15 = 0 의 큰 근은?', a: 5 },
      { q: 'x² − 12x + 35 = 0 의 큰 근은?', a: 7 }, { q: 'x² − 6x + 8 = 0 의 큰 근은?', a: 4 },
      { q: 'x² − 14x + 45 = 0 의 큰 근은?', a: 9 }, { q: 'x² − 15x + 56 = 0 의 큰 근은?', a: 8 },
      { q: 'x² − 9x + 18 = 0 의 큰 근은?', a: 6 }, { q: 'x² − 16x + 63 = 0 의 큰 근은?', a: 9 },
      { q: 'x² − 10x + 24 = 0 의 큰 근은?', a: 6 }, { q: 'x² − 11x + 24 = 0 의 큰 근은?', a: 8 },
      { q: 'x² − 13x + 42 = 0 의 큰 근은?', a: 7 }, { q: 'x² − 12x + 32 = 0 의 큰 근은?', a: 8 },
      { q: 'x² − 17x + 72 = 0 의 큰 근은?', a: 9 }, { q: 'x² − 7x + 10 = 0 의 큰 근은?', a: 5 } ] },
  };
  try { window.__f1Problems = PROBLEMS; } catch (e) {} // 테스트/검산용 노출
  const ZONES = [
    { name: '북부 물류창고', code: 'N' }, { name: '동부 집하장', code: 'E' },
    { name: '중앙 배송센터', code: 'D' }, { name: '서부 터미널', code: 'W' }, { name: '남부 보관소', code: 'S' },
  ];
  const NOTE_NAME = { 37: '도', 39: '레', 41: '미', 42: '파', 44: '솔', 46: '라', 48: '시', 49: '높은도' };
  const FONT = { // 8x8 배송지 글자
    N: [0x00,0x42,0x62,0x52,0x4A,0x46,0x42,0x00], E: [0x00,0x7E,0x40,0x7C,0x40,0x40,0x7E,0x00],
    D: [0x00,0x7C,0x42,0x42,0x42,0x42,0x7C,0x00], W: [0x00,0x41,0x41,0x49,0x49,0x55,0x22,0x00],
    S: [0x00,0x3E,0x40,0x3C,0x02,0x02,0x7C,0x00],
  };

  const $ = (id) => document.getElementById(id);
  const setStatus = (t, c) => { const e = $('status'); if (e) { e.textContent = t; e.className = 'status ' + (c || ''); } };
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  function toast(m) { const t = $('toast'); t.textContent = m; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 1500); }

  function startStream() { stopStream(); streamTimer = setInterval(() => { if (transport && transport.connected) { try { transport.send(P.buildFrame(state)); } catch (e) {} } }, STREAM_MS); }
  function stopStream() { if (streamTimer) clearInterval(streamTimer), streamTimer = null; }
  function setDrive(m, s) { state.go(m, m); state.steer(s); }

  const BATT_LOW = 700; let battWarned = false;
  function onSensor(s) {
    Object.assign(sensor, s);
    if ($('cdsNow')) $('cdsNow').textContent = s.cds;
    if ($('tofNow')) $('tofNow').textContent = `${s.ir1}/${s.ir2}/${s.ir3}`;
    const c = $('battChip');
    if (c && s.battery > 0) { c.style.display = ''; c.textContent = '🔋 ' + s.battery; const low = s.battery < BATT_LOW; c.classList.toggle('err', low); if (low && !battWarned) { battWarned = true; toast('🔋 배터리 낮음! 충전/교체'); } if (!low) battWarned = false; }
  }

  // ---- 스텝 (1빛 2암호 3소리 4배송지 5조립 6실행) ----
  function go(n) {
    for (let i = 1; i <= 6; i++) $('step' + i).classList.toggle('hidden', i !== n);
    document.querySelectorAll('.dot-step').forEach((d, i) => { d.classList.toggle('on', i + 1 === n); d.classList.toggle('done', i + 1 < n); });
    if (n === 4) setupZone();
    if (n === 5) setupBlocks();
    if (n === 6) renderSummary();
  }

  // ① 센서 숫자로 수학 — 사이값(평균) 계산
  function updateCalc() { $('brightVal').textContent = brightVal; $('darkVal').textContent = darkVal; $('calcA').textContent = brightVal; $('calcB').textContent = darkVal; }
  function capBright() { if (sensor.cds < 999) { brightVal = sensor.cds; updateCalc(); toast('밝은 곳 조도 = ' + brightVal); } else toast('연결 후 측정돼요(데모: 기본값)'); }
  function capDark() { if (sensor.cds < 999) { darkVal = sensor.cds; updateCalc(); toast('터널 안 조도 = ' + darkVal); } else toast('연결 후 측정돼요(데모: 기본값)'); }
  function checkLight() {
    const v = parseInt($('lightInput').value, 10);
    const exp = Math.round((brightVal + darkVal) / 2);
    const fb = $('lightFb');
    if (isNaN(v)) { fb.textContent = '숫자를 넣어요.'; fb.style.color = 'var(--coral)'; return; }
    if (Math.abs(v - exp) <= 1) { // 두 값의 평균(±1 허용) — 좌절 방지
      lightThresh = v; fb.textContent = `정답! 터널 기준 = ${v} 🔆 — ✏️ 활동지에 쓰세요`; fb.style.color = 'var(--mint)';
      $('toStep2').classList.remove('hidden'); toast('🔆 터널 기준 완성!');
    } else { fb.textContent = '다시 계산해 봐요. (사이값 = 두 값을 더해 2로 나누기)'; fb.style.color = 'var(--coral)'; $('toStep2').classList.add('hidden'); }
  }

  // ② 암호
  let curP = null;
  function pickGrade(g) {
    grade = g; const set = PROBLEMS[g];
    let next; do { next = set.list[Math.floor(Math.random() * set.list.length)]; } while (set.list.length > 1 && next === curP);
    curP = next;
    $('probText').textContent = curP.q; $('ansInput').value = ''; $('ansFb').textContent = '';
    $('probWrap').classList.remove('hidden'); $('codeReveal').classList.add('hidden'); $('toStep3').classList.add('hidden');
    document.querySelectorAll('.gradebtn').forEach(b => b.classList.toggle('sel', b.dataset.g === g)); $('ansInput').focus();
  }
  function checkAns() {
    const v = parseInt($('ansInput').value, 10);
    if (isNaN(v)) { $('ansFb').textContent = '숫자를 입력하세요.'; return; }
    if (v === curP.a) { recoverCode = v; $('codeVal').textContent = v; $('codeReveal').classList.remove('hidden'); $('toStep3').classList.remove('hidden'); $('ansFb').textContent = '주행 코드 복구 완료! 🔑'; }
    else $('ansFb').textContent = '복구 실패 — 다시 계산해 봐요.';
  }

  // ④ 배송지
  function setupZone() {
    if (!zone) zone = ZONES[Math.floor(Math.random() * ZONES.length)];
    $('destName').textContent = zone.name;
    const t = $('zoneTable'); t.querySelectorAll('.zrow').forEach(r => r.remove());
    ZONES.forEach(z => { const tr = document.createElement('tr'); tr.className = 'zrow' + (z.code === zone.code ? ' hit' : ''); tr.innerHTML = `<td>${z.name}</td><td>${z.code}</td>`; t.appendChild(tr); });
    $('letterVal').textContent = zone.code;
  }

  // ⑤ 블록 조립 (아주 약간의 코딩)
  // 학생이 활동지에 쓴 숫자를 각 블록의 빈칸에 직접 넣고, 실행 순서대로 배치한다.
  // [조립 확인]에서 값(활동 결과와 일치)과 순서를 함께 검증.
  const BLOCKS = [
    { id: 'light',  ic: '🔆', cls: 'blue',  pre: () => '조도값 = ',  post: ' — 터널 기준 세우기', type: 'number' },
    { id: 'drive',  ic: '🚗', cls: 'mint',  pre: () => '앞으로 간다 · 주행 코드 ', post: '', type: 'number' },
    { id: 'avoid',  ic: '↩️', cls: 'grape', pre: () => '앞에 장애물이 있으면 → 방향을 틀어 피해서 간다', post: '', type: 'none' },
    { id: 'sound',  ic: '🎵', cls: 'sun',   pre: () => `터널이면 → 소리 ${NOTE_NAME[note1]}·${NOTE_NAME[note2]} × `, post: '번', type: 'number' },
    { id: 'letter', ic: '📦', cls: 'coral', pre: () => '도착하면 → 문자 ', post: ' 표시', type: 'text' },
  ];
  const BLOCK_ORDER = ['light', 'drive', 'avoid', 'sound', 'letter'];
  const blockVals = { light: '', drive: '', avoid: '', sound: '', letter: '' };
  let placed = [], paletteIds = [];
  function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  function blkEl(id, where) {
    const b = BLOCKS.find(x => x.id === id);
    const d = document.createElement('button'); d.className = 'blk ' + b.cls; d.dataset.id = id;
    const bic = document.createElement('span'); bic.className = 'bic'; bic.textContent = b.ic; d.appendChild(bic);
    const pre = document.createElement('span'); pre.textContent = b.pre(); d.appendChild(pre);
    if (b.type !== 'none') {
      const inp = document.createElement('input');
      inp.className = 'blkin'; inp.placeholder = '?'; inp.value = blockVals[id];
      if (b.type === 'number') { inp.type = 'number'; inp.inputMode = 'numeric'; }
      else { inp.type = 'text'; inp.maxLength = 1; inp.style.width = '64px'; }
      ['click', 'pointerdown', 'touchstart'].forEach(ev => inp.addEventListener(ev, e => e.stopPropagation()));
      inp.addEventListener('input', () => { blockVals[id] = inp.value; });
      d.appendChild(inp);
      if (b.post) { const po = document.createElement('span'); po.textContent = b.post; d.appendChild(po); }
    }
    d.onclick = where === 'palette' ? () => placeBlock(id) : () => removeBlock(id);
    return d;
  }
  function setupBlocks() {
    placed = []; $('blockFb').textContent = ''; $('toStep6').classList.add('hidden');
    renderBlocks(shuffle(BLOCK_ORDER));
  }
  function renderBlocks(pool) {
    paletteIds = pool.filter(id => !placed.includes(id));
    const slots = $('slots'); slots.innerHTML = '';
    for (let i = 0; i < BLOCK_ORDER.length; i++) {
      const s = document.createElement('div'); s.className = 'slot';
      if (placed[i]) { s.appendChild(blkEl(placed[i], 'slot')); s.classList.add('filled'); }
      else s.textContent = i === 0 ? '1번째 실행 · 💡 힌트: 달리기 전에 터널 기준부터!' : `${i + 1}번째 실행`;
      slots.appendChild(s);
    }
    const pal = $('palette'); pal.innerHTML = '';
    paletteIds.forEach(id => pal.appendChild(blkEl(id, 'palette')));
  }
  function placeBlock(id) { if (placed.includes(id) || placed.length >= BLOCK_ORDER.length) return; placed.push(id); renderBlocks(paletteIds); }
  function removeBlock(id) { placed = placed.filter(x => x !== id); $('toStep6').classList.add('hidden'); $('blockFb').textContent = ''; renderBlocks([...paletteIds, id]); }
  function checkBlocks() {
    const fb = $('blockFb');
    if (placed.length < BLOCK_ORDER.length) { fb.textContent = `블록 ${BLOCK_ORDER.length}개를 모두 위 칸에 놓아요.`; fb.style.color = 'var(--coral)'; return; }
    const valOk = {
      light: parseInt(blockVals.light, 10) === lightThresh,
      drive: recoverCode != null && parseInt(blockVals.drive, 10) === recoverCode,
      avoid: true, // 입력 없는 순서 블록
      sound: parseInt(blockVals.sound, 10) === repeatN,
      letter: !!zone && String(blockVals.letter).trim().toUpperCase() === zone.code,
    };
    const orderOk = placed.every((id, i) => id === BLOCK_ORDER[i]);
    const slots = $('slots').children;
    for (let i = 0; i < slots.length; i++) {
      const id = placed[i];
      slots[i].classList.toggle('ok', id === BLOCK_ORDER[i] && valOk[id]);
      slots[i].classList.toggle('bad', !valOk[id]);
    }
    const allVals = Object.values(valOk).every(Boolean);
    if (orderOk && allVals) {
      fb.textContent = '프로그램 완성! 🧩 출발할 수 있어요.'; fb.style.color = 'var(--mint)';
      $('toStep6').classList.remove('hidden'); toast('🧩 조립 완성!');
    } else if (!allVals) {
      fb.textContent = '숫자가 틀린 블록이 있어요(빨간 칸). ✏️ 활동지를 다시 봐요.'; fb.style.color = 'var(--coral)'; $('toStep6').classList.add('hidden');
    } else {
      fb.textContent = '숫자는 맞아요! 그런데 실행 순서가 달라요. 다시 놓아 봐요.'; fb.style.color = 'var(--coral)'; $('toStep6').classList.add('hidden');
    }
  }

  // ⑥ 요약
  function renderSummary() {
    $('sumLight').textContent = lightThresh;
    $('sumCode').textContent = recoverCode != null ? recoverCode : '--';
    $('sumSound').textContent = `${NOTE_NAME[note1]}·${NOTE_NAME[note2]} × ${repeatN}회`;
    $('sumLetter').textContent = zone ? zone.code : '--';
  }

  // ---- 주행: TOF 벽추종(오른쪽_자율주행) ----
  function wallFollowTick() {
    if (sensor.ir2 < TOF2) {              // 앞(TOF-2) 막힘 → 후진하며 회피
      if (sensor.ir1 < TOF1) setDrive(BACK, -STEER); else setDrive(BACK, STEER);
    } else if (sensor.ir1 < TOF1) {       // 좌 벽 가까움 → 오른쪽으로 틀며 전진
      setDrive(DRIVE, STEER);
    } else if (sensor.ir3 < TOF3) {       // 우 벽 가까움 → 왼쪽으로 틀며 전진
      setDrive(DRIVE, -STEER);
    } else {                              // 뚫림 → 직진
      setDrive(DRIVE, 0);
    }
  }
  async function driveUntil(cond) {
    const t0 = Date.now();
    while (running && !cond() && Date.now() - t0 < PHASE_TIMEOUT) { wallFollowTick(); await sleep(STREAM_MS); }
    setDrive(0, 0);
  }
  async function backBump() { setDrive(BACK, 0); await sleep(300); setDrive(0, 0); state.steer(0); await sleep(200); }
  function showLetter(code) { const r = FONT[code] || FONT.D; state.displayMode = 0xFF; for (let i = 0; i < 8; i++) state.dot[i] = r[i]; }
  async function soundMission() {  // 차량 부저: 계이름1·계이름2 × 반복N, 0.5초 간격
    for (let i = 0; i < repeatN && running; i++) { state.soundSet(note1); await sleep(500); state.soundSet(note2); await sleep(500); }
    state.soundSet(0);
  }

  async function runDelivery() {   // 원본 '실행1' 시퀀스 재현
    if (running) return; running = true; setRunUI(true); toast('배송 시작! 🚚'); state.dotClear();
    // 터널1까지 벽추종 → 미션1(소리)
    await driveUntil(() => sensor.cds < lightThresh);
    await backBump();
    if (running) { toast('🕳️ 터널! 소리 미션 🎵'); await soundMission(); }
    // 터널2까지(조도<조도값 & 2초 경과) 벽추종 → 미션2(문자)
    const t0 = Date.now();
    await driveUntil(() => sensor.cds < lightThresh && Date.now() - t0 > 2000);
    await backBump();
    if (running && zone) {
      showLetter(zone.code);
      $('arriveLetter').textContent = zone.code; $('arriveName').textContent = zone.name; $('arrive').classList.remove('hidden');
      toast(`📦 배송 완료! [${zone.code}]`); await sleep(3000); $('arrive').classList.add('hidden');
    }
    setDrive(0, 0); state.dotClear(); running = false; setRunUI(false);
  }
  function stopRun() { running = false; setDrive(0, 0); state.dotClear(); state.soundSet(0); $('arrive').classList.add('hidden'); setRunUI(false); }
  function setRunUI(on) { $('goRun').classList.toggle('hidden', on); $('stopRun').classList.toggle('hidden', !on); }

  // ---- 연결 ----
  async function connect(kind) {
    await disconnect();
    try {
      if (kind === 'native') { transport = new T.AndroidBridgeTransport(); setStatus('🔗 연결 중…', 'pending'); await transport.connect(); }
      else { transport = new T.MockTransport(); await transport.connect({}); }
      transport.on('status', s => { if (s === 'connected') setStatus('🔗 연결됨 ✓', 'ok'); else if (s === 'disconnected') setStatus('🔗 연결 끊김', 'off'); else setStatus('⚠ ' + s.replace('error:', ''), 'err'); });
      transport.on('data', bytes => { for (const f of assembler.push(bytes)) onSensor(f); });
      if (kind !== 'native') setStatus('🔗 연결됨 ✓ (데모)', 'ok');
    } catch (e) { setStatus('⚠ 연결 실패', 'err'); transport = null; }
  }
  async function disconnect() { stopRun(); if (transport) { try { await transport.disconnect(); } catch (e) {} } transport = null; }

  function noteOptions(sel, def) { Object.keys(NOTE_NAME).forEach(code => { const o = document.createElement('option'); o.value = code; o.textContent = NOTE_NAME[code]; if (+code === def) o.selected = true; sel.appendChild(o); }); }

  function init() {
    updateCalc();
    // ① 센서-수학
    $('capBright').onclick = capBright; $('capDark').onclick = capDark;
    $('lightOk').onclick = checkLight; $('lightInput').addEventListener('keydown', e => { if (e.key === 'Enter') checkLight(); });
    // 스텝 이동
    $('toStep2').onclick = () => go(2);
    $('toStep3').onclick = () => go(3);
    $('toStep4').onclick = () => { note1 = +$('note1').value; note2 = +$('note2').value; repeatN = Math.max(1, +$('repeatN').value || 1); go(4); };
    $('toStep5').onclick = () => go(5);
    $('toStep6').onclick = () => go(6);
    document.querySelectorAll('[data-back]').forEach(b => b.onclick = () => go(+b.dataset.back));
    // ② 암호
    document.querySelectorAll('.gradebtn').forEach(b => b.onclick = () => pickGrade(b.dataset.g));
    $('ansOk').onclick = checkAns; $('ansInput').addEventListener('keydown', e => { if (e.key === 'Enter') checkAns(); });
    // ③ 소리 선택
    noteOptions($('note1'), 37); noteOptions($('note2'), 41);
    // ⑤ 조립 확인
    $('blockCheck').onclick = checkBlocks;
    // ⑥ 실행
    $('goRun').onclick = runDelivery; $('stopRun').onclick = stopRun;
    // 보정
    const bind = (id, set, span) => { const el = $(id); el.addEventListener('input', () => { set(+el.value); if ($(span)) $(span).textContent = el.value; }); if ($(span)) $(span).textContent = el.value; };
    bind('calTof1', v => TOF1 = v, 'calTof1V'); bind('calTof2', v => TOF2 = v, 'calTof2V'); bind('calTof3', v => TOF3 = v, 'calTof3V');
    bind('calDrive', v => DRIVE = v, 'calDriveV'); bind('calSteer', v => STEER = v, 'calSteerV');
    // 연결
    $('connBtn').onclick = () => { if (T.AndroidBridgeTransport.supported) connect('native'); else connect('mock'); };
    $('btSettings').onclick = () => { if (T.AndroidBridgeTransport.supported) new T.AndroidBridgeTransport().openSettings(); else toast('실기(APK)에서만 열려요'); };

    window.addEventListener('blur', stopRun);
    document.addEventListener('visibilitychange', () => { if (document.hidden) stopRun(); });

    startStream(); setRunUI(false); go(1);
    if (T.AndroidBridgeTransport.supported) connect('native'); else setStatus('🔗 연결 안 됨 (데모 가능)', 'off');
  }
  document.addEventListener('DOMContentLoaded', init);
})();
