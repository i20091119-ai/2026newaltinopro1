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

  // 벽추종/주행 보정 — 실측 스케일: 가까울수록 작음(5cm≈60), 벽 없음≈1300.
  // 그래서 '일찍 감지'하려면 임계를 크게(≈250) 잡아야 코앞이 아니라 여유거리에서 반응.
  // 기본값 = 실기(경남수학문화관 n자 코스)에서 검증된 값. 설정에서 바꾸면 자동 저장됨.
  let TOF1 = 130, TOF2 = 100, TOF3 = 130;   // 전면 좌/중앙/우 감지 거리(값 미만이면 벽)
  let DRIVE = 300, STEER = 30;              // 순항 속도 / 벽 근접 시 살짝 틀기
  let TURN = 127;                           // 정면 벽 회피 회전(강하게 꺾기)
  const WF_BACK = -300, HOLD_MS = 350;      // 아주 가까울 때 후진 / 동작 유지 시간
  const NEAR2 = 130;                        // 이 값 미만이면 '코앞' → 후진하며 회피
  const BUMP_SPEED = -350, BUMP_MS = 200;   // 터널 진입 범프
  const PHASE_TIMEOUT = 25000;
  // 측면 센서(ir4 우측면 / ir5 좌측면) 정밀 벽추종 — 복도 가운데 유지
  let SIDE_ON = true, SIDE_KP = 0.12, SIDE_TARGET = 100;
  const SIDE_SMAX = 35, SIDE_VALID = 700;   // 이 값보다 멀면 '벽 없음'으로 간주

  // ② 복구코드 문제 — 초4·초5·초6·중1·중2·중3·고1 각 20문항(정수 정답).
  // 각 학년 1학기 교육과정 범위, 난이도는 가장 쉬운 수준으로만. (독립 검산기 0오류 통과)
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
    e5: { label: '초5 · 혼합계산/약수배수', list: [
      { q: '8 + 3 × 4 = ?', a: 20 }, { q: '20 − 12 ÷ 4 = ?', a: 17 },
      { q: '(6 + 4) × 3 = ?', a: 30 }, { q: '5 × 4 − 8 = ?', a: 12 },
      { q: '24 ÷ 6 + 9 = ?', a: 13 }, { q: '30 − (7 + 8) = ?', a: 15 },
      { q: '(15 − 9) × 5 = ?', a: 30 }, { q: '36 ÷ (2 + 4) = ?', a: 6 },
      { q: '7 + 2 × 6 = ?', a: 19 }, { q: '40 − 5 × 6 = ?', a: 10 },
      { q: '18 ÷ 2 + 3 × 4 = ?', a: 21 }, { q: '(8 + 7) ÷ 3 = ?', a: 5 },
      { q: '12와 18의 최대공약수는?', a: 6 }, { q: '8과 12의 최대공약수는?', a: 4 },
      { q: '10과 15의 최대공약수는?', a: 5 }, { q: '16과 24의 최대공약수는?', a: 8 },
      { q: '4와 6의 최소공배수는?', a: 12 }, { q: '3과 5의 최소공배수는?', a: 15 },
      { q: '6과 8의 최소공배수는?', a: 24 }, { q: '12의 약수는 모두 몇 개?', a: 6 } ] },
    e6: { label: '초6 · 비율/입체도형', list: [
      { q: '비율 0.2를 백분율로 나타내면 몇 %?', a: 20 },
      { q: '비율 0.45를 백분율로 나타내면 몇 %?', a: 45 },
      { q: '비율 0.07을 백분율로 나타내면 몇 %?', a: 7 },
      { q: '분수 1/4 을 백분율로 나타내면 몇 %?', a: 25 },
      { q: '분수 3/5 을 백분율로 나타내면 몇 %?', a: 60 },
      { q: '분수 1/2 을 백분율로 나타내면 몇 %?', a: 50 },
      { q: '전체 50개 중 30개는 몇 %?', a: 60 },
      { q: '전체 20개 중 5개는 몇 %?', a: 25 },
      { q: '전체 25개 중 20개는 몇 %?', a: 80 },
      { q: '삼각기둥의 면은 모두 몇 개?', a: 5 },
      { q: '삼각기둥의 모서리는 모두 몇 개?', a: 9 },
      { q: '사각기둥의 꼭짓점은 모두 몇 개?', a: 8 },
      { q: '오각기둥의 면은 모두 몇 개?', a: 7 },
      { q: '사각뿔의 면은 모두 몇 개?', a: 5 },
      { q: '사각뿔의 모서리는 모두 몇 개?', a: 8 },
      { q: '삼각뿔의 꼭짓점은 모두 몇 개?', a: 4 },
      { q: '가로 2cm, 세로 3cm, 높이 4cm 직육면체의 부피는 몇 cm³?', a: 24 },
      { q: '가로 5cm, 세로 2cm, 높이 3cm 직육면체의 부피는 몇 cm³?', a: 30 },
      { q: '가로 4cm, 세로 4cm, 높이 2cm 직육면체의 부피는 몇 cm³?', a: 32 },
      { q: '한 모서리가 3cm인 정육면체의 부피는 몇 cm³?', a: 27 } ] },
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
    m2: { label: '중2 · 지수/부등식/연립', list: [
      { q: 'a³ × a⁴ = aⁿ 일 때 n은?', a: 7 }, { q: 'a² × a⁵ = aⁿ 일 때 n은?', a: 7 },
      { q: 'a⁶ × a² = aⁿ 일 때 n은?', a: 8 }, { q: '(a²)³ = aⁿ 일 때 n은?', a: 6 },
      { q: '(a³)³ = aⁿ 일 때 n은?', a: 9 }, { q: '(a⁴)² = aⁿ 일 때 n은?', a: 8 },
      { q: 'a⁸ ÷ a³ = aⁿ 일 때 n은?', a: 5 }, { q: 'a⁹ ÷ a⁴ = aⁿ 일 때 n은?', a: 5 },
      { q: 'x + 3 < 10 을 만족하는 가장 큰 자연수 x는?', a: 6 },
      { q: 'x + 5 < 12 를 만족하는 가장 큰 자연수 x는?', a: 6 },
      { q: '2x < 14 를 만족하는 가장 큰 자연수 x는?', a: 6 },
      { q: '3x < 20 을 만족하는 가장 큰 자연수 x는?', a: 6 },
      { q: '2x ≤ 16 을 만족하는 가장 큰 자연수 x는?', a: 8 },
      { q: 'x − 2 ≤ 7 을 만족하는 가장 큰 자연수 x는?', a: 9 },
      { q: 'x+y=10, x−y=4 일 때 x는?', a: 7 }, { q: 'x+y=8, x−y=2 일 때 x는?', a: 5 },
      { q: 'x+y=12, x−y=6 일 때 x는?', a: 9 }, { q: 'x+y=9, x−y=1 일 때 y는?', a: 4 },
      { q: 'x+y=15, x−y=5 일 때 y는?', a: 5 }, { q: 'x+y=20, x−y=10 일 때 x는?', a: 15 } ] },
    m3: { label: '중3 · 제곱근/인수분해', list: [
      { q: '√49 = ?', a: 7 }, { q: '√81 = ?', a: 9 }, { q: '√121 = ?', a: 11 },
      { q: '√144 = ?', a: 12 }, { q: '√100 = ?', a: 10 }, { q: '√36 = ?', a: 6 },
      { q: '제곱해서 64가 되는 양수는?', a: 8 }, { q: '제곱해서 225가 되는 양수는?', a: 15 },
      { q: 'x² + 5x + 6 = (x+2)(x+n) 일 때 n은?', a: 3 },
      { q: 'x² + 7x + 12 = (x+3)(x+n) 일 때 n은?', a: 4 },
      { q: 'x² + 6x + 8 = (x+2)(x+n) 일 때 n은?', a: 4 },
      { q: 'x² + 9x + 20 = (x+4)(x+n) 일 때 n은?', a: 5 },
      { q: 'x² − 16 = (x+4)(x−n) 일 때 n은?', a: 4 },
      { q: 'x² − 25 = (x+5)(x−n) 일 때 n은?', a: 5 },
      { q: 'x² = 49 의 양수인 해는?', a: 7 }, { q: 'x² = 100 의 양수인 해는?', a: 10 },
      { q: '(x−3)² = 0 의 해는?', a: 3 }, { q: '(x−8)² = 0 의 해는?', a: 8 },
      { q: 'x² − 6x = 0 의 0이 아닌 해는?', a: 6 }, { q: 'x² − 9x = 0 의 0이 아닌 해는?', a: 9 } ] },
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

  const BATT_LOW = 700; let battWarned = false, lastUi = 0;
  function onSensor(s) {
    Object.assign(sensor, s);  // 센서 자체는 매 프레임 갱신(주행 판단용)
    // 화면 숫자는 250ms마다만 갱신(초당 4회) — 덜덜 떨림 방지. 폭은 CSS 고정 박스로.
    const now = Date.now(); if (now - lastUi < 250) return; lastUi = now;
    const tof = `${s.ir1}/${s.ir2}/${s.ir3}`;
    const side = `${s.ir5}·${s.ir4}`;
    if ($('cdsNow')) $('cdsNow').textContent = s.cds;
    if ($('tofNow')) $('tofNow').textContent = tof;
    if ($('sideNow')) $('sideNow').textContent = side;
    if ($('hudTof')) $('hudTof').textContent = tof;
    if ($('hudSide')) $('hudSide').textContent = side;
    if ($('hudCds')) $('hudCds').textContent = s.cds;
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
  const toEven = (v) => Math.round(v / 2) * 2; // 항상 짝수로 → 사이값 나눗셈이 딱 떨어짐(초등 배려)
  function capBright() { if (sensor.cds < 999) { brightVal = toEven(sensor.cds); updateCalc(); toast('밝은 곳 조도 = ' + brightVal); } else toast('연결 후 측정돼요(데모: 기본값)'); }
  function capDark() { if (sensor.cds < 999) { darkVal = toEven(sensor.cds); updateCalc(); toast('터널 안 조도 = ' + darkVal); } else toast('연결 후 측정돼요(데모: 기본값)'); }
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

  // ---- 주행: TOF 벽추종 (실측 스케일: 작을수록 가까움) ----
  // 조향 부호: +STEER=우회전, -STEER=좌회전.
  function hudAct(t) { const e = $('hudAct'); if (e) e.textContent = t; }
  async function wallFollowStep() {
    const { ir1, ir2, ir3, ir4, ir5 } = sensor;
    if (ir2 < TOF2) {                     // ① 정면 벽 → 열린 쪽 판단 후 K턴 탈출
      // 오른쪽 열림 = 전면우(ir3)+우측면(ir4) / 왼쪽 열림 = 전면좌(ir1)+좌측면(ir5)
      const openR = Math.min(ir3, ir4), openL = Math.min(ir1, ir5);
      const rightOpen = openR >= openL;
      const FULL = 127;                   // 핸들 풀락
      if (ir2 < NEAR2) {                  // 코앞 → K턴: 열린쪽 '반대로' 풀락 후진 → 열린쪽으로 풀락 전진
        if (rightOpen) {
          setDrive(WF_BACK, -FULL); hudAct('⤿ 후진(핸들 좌·오른쪽 탈출)'); await sleep(HOLD_MS);
          setDrive(DRIVE, FULL);   hudAct('↱ 전진(오른쪽으로)');        await sleep(HOLD_MS);
        } else {
          setDrive(WF_BACK, FULL); hudAct('⤾ 후진(핸들 우·왼쪽 탈출)'); await sleep(HOLD_MS);
          setDrive(DRIVE, -FULL);  hudAct('↰ 전진(왼쪽으로)');          await sleep(HOLD_MS);
        }
      } else {                           // 접근 중 → 열린쪽으로 강하게 틀며 전진
        setDrive(Math.round(DRIVE * 0.6), rightOpen ? TURN : -TURN);
        hudAct(rightOpen ? '↱ 정면벽 우회피' : '↰ 정면벽 좌회피'); await sleep(HOLD_MS);
      }
    } else if (ir1 < TOF1) {              // ② 좌 벽 근접 → 오른쪽으로 살짝
      setDrive(DRIVE, STEER); hudAct('↳ 좌벽→우로'); await sleep(HOLD_MS);
    } else if (ir3 < TOF3) {              // ③ 우 벽 근접 → 왼쪽으로 살짝
      setDrive(DRIVE, -STEER); hudAct('↲ 우벽→좌로'); await sleep(HOLD_MS);
    } else if (SIDE_ON && (ir4 < SIDE_VALID || ir5 < SIDE_VALID)) {
      // ④ 측면 정밀 보정: 양쪽=가운데 / 한쪽=목표거리 유지 (50ms 연속 미세조정)
      const R = ir4, L = ir5; let st;   // +st=우회전, -st=좌회전
      if (R < SIDE_VALID && L < SIDE_VALID) st = SIDE_KP * (R - L);          // 우가 가까우면(R작음) 좌로
      else if (R < SIDE_VALID)              st = SIDE_KP * (R - SIDE_TARGET); // 우벽: 가까우면(R<목표) 좌로
      else                                  st = -SIDE_KP * (L - SIDE_TARGET); // 좌벽: 가까우면(L<목표) 우로
      st = Math.max(-SIDE_SMAX, Math.min(SIDE_SMAX, Math.round(st)));
      setDrive(DRIVE, st); hudAct(st === 0 ? '↑ 가운데 직진' : (st > 0 ? '↗ 가운데보정 우' : '↖ 가운데보정 좌'));
      await sleep(STREAM_MS);
    } else {                              // ⑤ 뚫림 → 직진(즉시 재판단)
      setDrive(DRIVE, 0); hudAct('⬆ 직진'); await sleep(STREAM_MS);
    }
  }
  async function driveUntil(cond) {
    const t0 = Date.now();
    while (running && !cond() && Date.now() - t0 < PHASE_TIMEOUT) { await wallFollowStep(); }
    setDrive(0, 0);
  }
  async function backBump() { setDrive(BUMP_SPEED, 0); await sleep(BUMP_MS); setDrive(0, 0); state.steer(0); await sleep(200); }
  function showLetter(code) { const r = FONT[code] || FONT.D; state.displayMode = 0xFF; for (let i = 0; i < 8; i++) state.dot[i] = r[i]; }
  async function soundMission() {  // 차량 부저: 계이름1·계이름2 × 반복N, 0.5초 간격
    for (let i = 0; i < repeatN && running; i++) { state.soundSet(note1); await sleep(500); state.soundSet(note2); await sleep(500); }
    state.soundSet(0);
  }

  async function runDelivery() {   // 원본 '실행1' 시퀀스 재현
    if (running) return; running = true; setRunUI(true); state.dotClear();
    // 원본 도입부: 정지 1초 → GO 표시 1초 → 출발
    setDrive(0, 0); await sleep(1000);
    const goEl = $('goFlash'); if (goEl) { goEl.classList.remove('hidden'); await sleep(1000); goEl.classList.add('hidden'); }
    if (!running) return; toast('배송 시작! 🚚');
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
  // 계속 주행(튜닝/시연): 미션·정지 없이 벽만 따라 무한 주행 → 정지 누를 때까지
  async function runLoop() {
    if (running) return; running = true; setRunUI(true); toast('🔁 계속 주행 — 코스를 계속 돌아요 (정지로 멈춤)');
    setDrive(0, 0); await sleep(400);
    while (running) { await wallFollowStep(); }
    setDrive(0, 0);
  }
  function stopRun() { running = false; setDrive(0, 0); state.dotClear(); state.soundSet(0); $('arrive').classList.add('hidden'); const g = $('goFlash'); if (g) g.classList.add('hidden'); setRunUI(false); }
  function setRunUI(on) { $('goRun').classList.toggle('hidden', on); const l = $('loopRun'); if (l) l.classList.toggle('hidden', on); $('stopRun').classList.toggle('hidden', !on); }

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
  async function disconnect() { stopRun(); stopScanning(); if (transport) { try { await transport.disconnect(); } catch (e) {} } transport = null; }

  // ---- BLE 무페어링 스캔 피커 (동적 오버레이) ----
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
        <input id="scanSearch" type="text" placeholder="번호로 검색 (예: BD77)" style="width:100%;margin-bottom:8px">
        <div id="scanList"><p class="lead">🔍 주변 알티노를 찾는 중… 차 전원을 켜주세요.</p></div>
        <div style="margin-top:10px;display:flex;gap:8px"><button id="scanSettings" class="btn ghost">📶 블루투스 설정</button></div></div>`;
      document.body.appendChild(ov);
      ov.querySelector('#scanClose').onclick = () => { stopScanning(); ov.classList.add('hidden'); };
      ov.querySelector('#scanSettings').onclick = () => { try { new T.AndroidBridgeTransport().openSettings(); } catch (e) {} };
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
    list.innerHTML = '';
    devs.forEach(d => {
      const b = document.createElement('button'); b.className = 'btn ghost'; b.style.cssText = 'display:block;width:100%;text-align:left;margin-bottom:8px';
      b.innerHTML = `🚗 <b style="font-size:1.15rem">${d.name || '(이름없음)'}</b><br><span style="font-size:.85rem;color:var(--mut)">${d.address}</span>`;
      b.onclick = () => { stopScanning(); $('scanOverlay').classList.add('hidden'); connect('native', d.address); };
      list.appendChild(b);
    });
  }

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
    if ($('loopRun')) $('loopRun').onclick = runLoop;
    // 보정
    const bind = (id, set, span) => { const el = $(id); el.addEventListener('input', () => { set(+el.value); if ($(span)) $(span).textContent = el.value; }); if ($(span)) $(span).textContent = el.value; };
    bind('calTof1', v => TOF1 = v, 'calTof1V'); bind('calTof2', v => TOF2 = v, 'calTof2V'); bind('calTof3', v => TOF3 = v, 'calTof3V');
    bind('calTurn', v => TURN = v, 'calTurnV');
    bind('calDrive', v => DRIVE = v, 'calDriveV'); bind('calSteer', v => STEER = v, 'calSteerV');
    // 측면 정밀주행
    const sideChk = $('sideOn');
    if (sideChk) sideChk.addEventListener('change', () => { SIDE_ON = sideChk.checked; toast(SIDE_ON ? '측면 정밀주행 ON' : '측면 정밀주행 OFF'); });
    bind('calSideKp', v => SIDE_KP = v / 100, 'calSideKpV');
    bind('calSideTarget', v => SIDE_TARGET = v, 'calSideTargetV');
    // 보정값 자동 저장/복원 (앱 재시작·재접속해도 유지) — 부스 운영 필수
    const CAL_IDS = ['calTof1', 'calTof2', 'calTof3', 'calTurn', 'calDrive', 'calSteer', 'calSideKp', 'calSideTarget'];
    function saveCal() {
      try {
        const o = {}; CAL_IDS.forEach(id => { const el = $(id); if (el) o[id] = el.value; });
        const sc = $('sideOn'); if (sc) o.sideOn = sc.checked;
        localStorage.setItem('altinoCalV1', JSON.stringify(o));
      } catch (e) {}
    }
    function restoreCal() {
      try {
        const o = JSON.parse(localStorage.getItem('altinoCalV1') || 'null'); if (!o) return;
        CAL_IDS.forEach(id => { const el = $(id); if (el && o[id] != null) { el.value = o[id]; el.dispatchEvent(new Event('input')); } });
        const sc = $('sideOn'); if (sc && o.sideOn != null) { sc.checked = o.sideOn; SIDE_ON = o.sideOn; }
      } catch (e) {}
    }
    CAL_IDS.forEach(id => { const el = $(id); if (el) el.addEventListener('input', saveCal); });
    if (sideChk) sideChk.addEventListener('change', saveCal);
    restoreCal();
    // 연결
    $('connBtn').onclick = () => { if (T.AndroidBridgeTransport.supported) pickAndConnect(); else connect('mock'); };
    $('btSettings').onclick = () => { if (T.AndroidBridgeTransport.supported) new T.AndroidBridgeTransport().openSettings(); else toast('실기(APK)에서만 열려요'); };

    window.addEventListener('blur', stopRun);
    document.addEventListener('visibilitychange', () => { if (document.hidden) stopRun(); });

    startStream(); setRunUI(false); go(1);
    if (T.AndroidBridgeTransport.supported) connect('native'); else setStatus('🔗 연결 안 됨 (데모 가능)', 'off');
  }
  document.addEventListener('DOMContentLoaded', init);
})();
