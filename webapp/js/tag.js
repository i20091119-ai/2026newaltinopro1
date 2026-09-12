// Function 2 — "수학 연료 꼬리잡기"
// 핵심 루프: 문제를 풀면 에너지 충전 → 에너지가 있는 동안만 차가 움직인다.
//           후면(ir6)에 다른 차가 붙으면 삐-+에너지 감소+잡힘 카운트.
// 앱이 모터 명령을 소유하므로 "에너지 0 = 정지 프레임만 전송 = 못 움직임" 이 성립.
'use strict';
(function () {
  const P = window.AltinoProtocol;
  const T = window.AltinoTransport;

  const state = new P.AltinoState();
  const assembler = new P.SensorFrameAssembler();
  let transport = null, streamTimer = null;
  const STREAM_MS = 100;                // 10 tick/s (12대 동시 BT 트래픽 절감). 재연결은 네이티브가 담당

  // ---- 에너지 경제 (모두 현장 조절용 상수) ----
  const SECONDS_PER_SOLVE = 30;        // 문제 1개로 달릴 수 있는 시간(초)
  const GAIN_PER_SOLVE = 500;          // 문제 1개 정답 시 충전
  const DRAIN_PER_SEC = GAIN_PER_SOLVE / SECONDS_PER_SOLVE; // ≈16.7/초 → 1문제 = 30초
  const ENERGY_MAX = 3000;             // 최대 저장 = 문제 6개치(약 180초)
  const CAUGHT_PENALTY = 100;          // 뒤에 붙잡히면 감소(약 6초치)
  let energy = 500;                    // 시작 = 문제 1개치(30초)

  // ---- 코인 경제 (속도업) ----
  let coins = 0;
  let speedTier = 0;        // 현재 속도 단계
  let maxTier = 0;          // 구매한 최고 단계 — 이 범위 안에서는 ± 무료
  const SPEED_TIERS = [330, 360, 390, 420, 450];   // 업그레이드마다 +30, 상한 450(현장 요청)
  const UPGRADE_COST = [2, 3, 4, 5];   // tier 0→1,1→2,2→3,3→4 비용(코인)
  const speedNow = () => SPEED_TIERS[speedTier];

  // ---- 꼬리잡기 판정 ----
  let caught = 0;
  let rearThresh = 50;                  // ir6 < thresh → 붙음 (TOF: 가까울수록 작음). 50↑는 너무 잘 걸림
  const RELEASE_GAP = 60;
  // 재카운트 방지 시간. ⚠ 예전엔 60(프레임)으로 적혀 있었는데 STREAM_MS 가 100ms 라
  //   실제로는 6초였다 — 쫓아오는 차가 연달아 부딪쳐도 첫 번만 세고 나머지를 버렸다.
  //   ms 로 적어 STREAM_MS 가 바뀌어도 뜻이 유지되게 한다.
  const MIN_INTERVAL_TICKS = Math.round(1200 / STREAM_MS);   // 1.2초
  let armed = true, cooldown = 0;
  let soundTicks = 0, ledTicks = 0;

  // 지금 조작을 받으면 안 되는 상태인가.
  // ⚠ 게임화면 여부만 보던 때는, 문제 풀이창·연결창·확인창이 '게임화면 위에' 뜨므로
  //   패드를 누른 채 창이 열리면 차가 계속 달렸다. 실제로 잘 나오는 순서가 있다:
  //   에너지 0 → 차가 안 움직이니 손을 안 뗌 → 충전소를 눌러 문제를 풀고 → 에너지가
  //   채워지는 순간 아이가 화면을 보는 사이 차가 튀어나간다.
  function inputBlocked() {
    if ($('gameScreen').classList.contains('hidden')) return true;
    for (const id of ['repairModal', 'connModal']) {
      const el = $(id); if (el && !el.classList.contains('hidden')) return true;
    }
    const cf = document.getElementById('altinoConfirm');
    if (cf && cf.style.display === 'flex') return true;
    const cal = document.getElementById('dotCalOverlay');
    if (cal && cal.style.display !== 'none' && cal.offsetParent !== null) return true;
    return false;
  }

  // ---- 주행 의도 (에너지로 게이팅) ----
  const intent = { drive: 0, steer: 0 }; // drive: -1/0/1

  // ---- 선택 학년 (시작 화면에서 결정) ----
  let selectedGrade = 'e3';
  // 게임 안 '학년 바꾸기'로 온 것인지 구분 — 그때만 진행(에너지·코인)을 유지한다.
  // 홈에서 새로 들어와 학년을 고르면 '다음 학생'이므로 새 판으로 시작.
  let changingGradeAt = 0;
  const KEEP_TTL_MS = 60 * 1000;     // '학년 바꾸기' 표시 유효시간
  let changingGrade = false;

  // ---- 효과음 (합성 WAV) ----
  const SFX = {};
  ['charge', 'caught', 'upgrade', 'win'].forEach(n => {
    try { SFX[n] = new Audio('sounds/' + n + '.wav'); SFX[n].preload = 'auto'; } catch (e) {}
  });
  let sfxUnlocked = false;
  function sfx(name) {
    const base = SFX[name]; if (!base) return;
    try { const a = base.cloneNode(); a.volume = 0.6; a.play().catch(() => {}); } catch (e) {}
  }
  function unlockAudio() { // 모바일 자동재생 정책: 첫 탭에서 오디오 해금
    if (sfxUnlocked) return; sfxUnlocked = true;
    Object.values(SFX).forEach(a => { try { a.play().then(() => { a.pause(); a.currentTime = 0; }).catch(() => {}); } catch (e) {} });
  }

  const $ = (id) => document.getElementById(id);
  const setStatus = (t, c) => { const e = $('status'); e.textContent = t; e.className = 'status ' + (c || ''); };

  function startStream() {
    stopStream();
    streamTimer = setInterval(tick, STREAM_MS);
  }
  function stopStream() { if (streamTimer) { clearInterval(streamTimer); streamTimer = null; } }

  // 스트림 틱: 에너지 게이팅 + 소모 + 비프/플래시 감쇠 + 전송
  function tick() {
    // 게임화면이 아니면(학년 선택 등) 조작 의도를 비운다.
    // 패드를 누른 채 화면을 바꾸면 touchend가 안 와 intent가 붙잡혀 있었고,
    // 그 상태로 에너지가 계속 닳고 차도 계속 달렸다(학년 바꿀 때마다 에너지가 달라지던 원인).
    if (inputBlocked()) { intent.drive = 0; intent.steer = 0; }
    const wantMove = intent.drive !== 0;
    const canMove = energy > 0 && wantMove;
    // 에너지 소모 (실제로 움직일 때만)
    if (canMove) { energy = Math.max(0, energy - DRAIN_PER_SEC * (STREAM_MS / 1000)); }
    // 모터/조향 반영 (에너지 없으면 구동 0, 조향은 공짜)
    const m = canMove ? intent.drive * speedNow() : 0;
    state.go(m, m);
    state.steer(intent.steer);
    // 비프/플래시 감쇠
    if (soundTicks > 0 && --soundTicks === 0) state.soundSet(0);
    if (ledTicks > 0 && --ledTicks === 0) state.ledSet(0);
    if (cooldown > 0) cooldown--;
    if (oopsTicks > 0) oopsTicks--;
    applyMood();

    updateEnergyUI();
    if (canMove && ++saveTick >= 20) { saveTick = 0; saveState(); } // 주행 중 에너지 소모 ~2초마다 저장
    if (transport && transport.connected) { try { transport.send(P.buildFrame(state)); } catch (e) {} }
  }

  function updateEnergyUI() {
    const pct = Math.round((energy / ENERGY_MAX) * 100);
    $('energyBar').style.width = pct + '%';
    $('energyVal').textContent = Math.round(energy);
    const empty = energy <= 0;
    document.body.classList.toggle('nofuel', empty);
    $('fuelWarn').classList.toggle('hidden', !empty);
    $('energyBar').classList.toggle('low', energy < GAIN_PER_SOLVE * 0.5);
    updateShopUI();
  }

  function updateShopUI() {
    if ($('coinVal')) $('coinVal').textContent = coins;
    if ($('speedNow')) $('speedNow').textContent = speedNow();
    // 속도 ± : 이미 구매한 단계(maxTier) 안에서는 코인 없이 자유롭게 오르내림
    const dn = $('speedDown'), up = $('speedUpBtn');
    if (dn) dn.disabled = speedTier <= 0;
    if (up) up.disabled = speedTier >= maxTier;
    const btn = $('upgradeBtn'), t = $('upgradeText'); if (!btn || !t) return;
    if (maxTier >= SPEED_TIERS.length - 1) {
      t.textContent = '최고 속도 구매완료!'; btn.disabled = true;
    } else {
      const cost = UPGRADE_COST[maxTier];
      t.textContent = `속도업 ${SPEED_TIERS[maxTier + 1]} (코인 ${cost})`;
      btn.disabled = coins < cost;
    }
  }

  // 산 단계 범위에서 속도만 조절(코인 변동 없음) — "너무 빨라서 못 잡겠어요" 대응
  function stepSpeed(d) {
    const next = Math.max(0, Math.min(maxTier, speedTier + d));
    if (next === speedTier) return;
    speedTier = next;
    updateShopUI(); saveState();
    toast(`속도 ${speedNow()}`);
  }

  // 마스코트 표정: 주행=happy, 잡힘 순간=oops, 에너지0=tired
  let oopsTicks = 0, lastMood = '';
  function applyMood() {
    const mood = oopsTicks > 0 ? 'oops' : (energy <= 0 ? 'tired' : 'happy');
    if (mood !== lastMood) {
      lastMood = mood;
      const el = $('gameCar'); if (el) el.src = 'assets/mascot-' + mood + '.png';
    }
  }

  function buyUpgrade() {
    if (maxTier >= SPEED_TIERS.length - 1) return;
    const cost = UPGRADE_COST[maxTier];
    if (coins < cost) { toast('코인이 부족해요! 문제를 더 풀어요'); return; }
    coins -= cost; maxTier++; speedTier = maxTier;   // 사면 그 속도로 바로 올라감
    sfx('upgrade');
    updateShopUI();
    saveState();
    toast(`속도 ${speedNow()}! 🚀`);
  }

  // ---- 센서 프레임마다: 뷰어 + 꼬리잡기 ----
  const BATT_LOW = 700;   // 이 값 미만이면 배터리 낮음(실기에서 관찰 후 조정)
  let battWarned = false;
  function updateBatt(v) {
    const c = $('battChip'); if (!c) return;
    if (v > 0) { c.style.display = ''; c.textContent = '🔋 ' + v; }
    const low = v > 0 && v < BATT_LOW; c.classList.toggle('err', low);
    if (low && !battWarned) { battWarned = true; toast('🔋 배터리 낮음! 충전/교체하세요'); }
    if (!low) battWarned = false;
  }
  let lastUi = 0;
  function onSensor(s) {
    const rear = s.ir6;
    // 화면 숫자는 250ms마다만 갱신(덜덜 떨림 방지). 잡힘 판정은 매 프레임.
    const now = Date.now();
    if (now - lastUi >= 250) {
      lastUi = now;
      for (const k of ['ir1','ir2','ir3','ir4','ir5','ir6']) { const el = $('sv-' + k); if (el) el.textContent = s[k]; }
      if ($('sv-bat')) $('sv-bat').textContent = s.battery;
      updateBatt(s.battery);
      if ($('rearNow')) $('rearNow').textContent = rear;
    }

    // 시작(학년 선택) 화면에서는 세지 않는다 — 아이가 차를 들고 오거나 벽에 붙여 두면
    // 다음 학생의 점수와 에너지가 깎였다. (센서 숫자 갱신은 위에서 계속 하므로 튜닝은 가능)
    if ($('gameScreen').classList.contains('hidden')) return;

    if (armed && rear < rearThresh && cooldown === 0) {
      caught++; $('caughtVal').textContent = caught;
      energy = Math.max(0, energy - CAUGHT_PENALTY);
      sfx('caught');
      beepFlash();
      drawCount(caught);   // 알티노 도트매트릭스에 잡힌 횟수 표시
      saveState();
      oopsTicks = Math.round(800 / STREAM_MS);
      armed = false; cooldown = MIN_INTERVAL_TICKS;
    }
    if (!armed && rear > rearThresh + RELEASE_GAP) armed = true;
  }

  // 즉시 정지 — 틱을 기다리지 않고 지금 프레임을 보낸다.
  function panicStop() {
    intent.drive = 0; intent.steer = 0;
    try { state.go(0, 0); state.steer(0); } catch (e) {}
    if (transport && transport.connected) { try { transport.send(P.buildFrame(state)); } catch (e) {} }
    // 아직 한 판도 안 했다면 빈 기록을 새로 쓰지 않는다(안 한 판이 '이어서 하기'로 뜨던 문제)
    if (!$('gameScreen').classList.contains('hidden')) saveState();
  }

  function beepFlash() {
    state.soundSet(49); state.ledSet(15);
    soundTicks = Math.round(400 / STREAM_MS); ledTicks = Math.round(400 / STREAM_MS);
    document.body.classList.add('hit');
    setTimeout(() => document.body.classList.remove('hit'), 250);
  }

  // ---- 도트매트릭스에 잡힌 횟수 표시 ----
  // 그리기·방향 보정은 js/dotmatrix.js(공용)가 담당.
  // 기존에 숫자가 깨져 보이던 원인: dotOn(col,row)의 축이 실제 하드웨어와 전치돼 있었음.
  // 이제 논리좌표로만 그리므로 자리 뒤바뀜(14→41)도 구조적으로 발생하지 않는다.
  const D = window.AltinoDot;
  function drawCount(n) { D.drawNumber(state, n); }

  // ---- 운전 ----
  function bindHold(el, onDown, onUp) {
    const d = (e) => { e.preventDefault(); onDown(); el.classList.add('pressed'); };
    const u = (e) => { if (e) e.preventDefault(); onUp(); el.classList.remove('pressed'); };
    el.addEventListener('touchstart', d, { passive: false });
    el.addEventListener('touchend', u, { passive: false });
    el.addEventListener('touchcancel', u, { passive: false });
    el.addEventListener('mousedown', d); el.addEventListener('mouseup', u);
    el.addEventListener('mouseleave', (e) => { if (el.classList.contains('pressed')) u(e); });
  }

  // ---- 충전소: 문제 풀면 에너지 +GAIN (학년별 풀에서 랜덤 출제) ----
  let curAnswer = null, lastIdx = -1;
  function genProblem() {
    const pool = window.AltinoProblems.GRADE_POOLS[selectedGrade]
              || window.AltinoProblems.GRADE_POOLS.e3;
    let i;
    do { i = Math.floor(Math.random() * pool.length); } while (pool.length > 1 && i === lastIdx);
    lastIdx = i;
    const p = pool[i];
    curAnswer = p.a;
    $('probText').textContent = p.q;
    $('probInput').value = ''; $('probFb').textContent = '';
    $('repairModal').classList.remove('hidden'); $('probInput').focus();
  }
  function checkProblem() {
    const v = parseInt($('probInput').value, 10);
    if (isNaN(v)) { $('probFb').textContent = '숫자를 입력하세요.'; return; }
    if (v === curAnswer) {
      energy = Math.min(ENERGY_MAX, energy + GAIN_PER_SOLVE);
      coins += 1;
      sfx('charge');
      updateEnergyUI();
      saveState();
      // 연속 풀이: 모달 유지하고 다음 문제 바로 (에너지·코인 몰아 벌기)
      toast(`+${GAIN_PER_SOLVE} 에너지 ⚡  +1 코인 🪙`);
      genProblem();
    } else { $('probFb').textContent = '다시! 계산을 확인해요.'; }
  }
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 1200); }

  // ---- 연결 ----
  // 상단에 현재 짝 로봇의 블루투스 번호(스티커 번호)를 크게 표시
  // 스티커 번호가 BF12·BF14 처럼 숫자로 끝나므로 '과/와'가 번갈아 맞다.
  // 마지막 글자가 영문·숫자여도 한국어 읽기의 받침으로 판단한다.
  function josaWa(word) {
    const ch = String(word || '').trim().slice(-1);
    const DIGIT = { '0': true, '1': true, '2': false, '3': true, '4': false,
                    '5': false, '6': true, '7': true, '8': true, '9': false };
    if (ch in DIGIT) return DIGIT[ch] ? '과' : '와';
    const code = ch.charCodeAt(0);
    if (code >= 0xAC00 && code <= 0xD7A3) return ((code - 0xAC00) % 28) ? '과' : '와';
    // 영문 알파벳: 읽는 소리 기준(L·M·N·R 등은 받침 있음)
    return 'lmnr'.includes(ch.toLowerCase()) ? '과' : '와';
  }

  function updateRobotChip() {
    const el = $('robotNo'); if (!el) return;
    if (!T.AndroidBridgeTransport.supported) { el.textContent = '데모'; return; }
    const st = new T.AndroidBridgeTransport().state();
    el.textContent = st.address ? stickerCode(st.name, st.address) : '—';
  }

  function wireNative(t) {   // 상태는 'base:detail' → base로 판별. 재연결은 네이티브가 자동 수행
    t.on('status', (s) => {
      updateRobotChip();
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
      else if (kind === 'ws') { transport = new T.WebSocketTransport(); wireNative(transport); await transport.connect({ url: $('wsurl').value.trim() }); setStatus('🔗 연결됨 ✓', 'ok'); }
      else { transport = new T.MockTransport(); wireNative(transport); await transport.connect({}); setStatus('🔗 연결됨 ✓', 'ok'); }
    } catch (e) { setStatus('⚠ 연결 실패', 'err'); transport = null; }
  }
  function adoptNative() { transport = new T.AndroidBridgeTransport(); wireNative(transport); transport.adopt(); }   // 살아있는 링크 이어받기(페이지 이동 유지)
  function nativeStart() { const st = new T.AndroidBridgeTransport().state(); if (st.connected) adoptNative(); else if (st.address) connect('native', st.address); else openConn(); }

  // 네이티브 오류 코드 → 사용자 안내
  function connErr(s) {
    const m = {
      'error:no-bluetooth': '블루투스 없음', 'error:bluetooth-off': '블루투스를 켜주세요',
      'error:permission': '블루투스 권한 필요', 'error:no-paired-device': '페어링된 기기 없음',
      'error:connect-failed': '연결 실패(다시 시도)', 'error:bad-address': '잘못된 주소',
      'error:location-off': '태블릿 위치(Location)를 켜주세요 — 스캔에 필요', 'error:give-up': '연결 실패 — 다시 선택',
    };
    return m[s] || s.replace('error:', '');
  }

  // 연결 모달 (BLE 무페어링 실시간 스캔)
  let allDevs = [];
  let scanner = null;
  function addDev(d) {
    if (!d || !d.address) return;
    const i = allDevs.findIndex(x => x.address === d.address);
    if (i >= 0) { if (d.name) allDevs[i].name = d.name; }
    else allDevs.push({ name: d.name || '', address: d.address, rssi: d.rssi || 0 });
    renderDevList();
  }
  function startScanning() {
    if (!T.AndroidBridgeTransport.supported) return;
    stopScanning();
    scanner = new T.AndroidBridgeTransport();
    scanner.on('scan', addDev);
    scanner.startScan();
  }
  // 블루투스/위치 권한을 방금 허용했다면 스캔을 다시 건다.
  // (첫 실행: 권한 없이 스캔 → 0건 → 허용 → 아무도 다시 안 걸어 목록이 계속 비어 있었다)
  window.__altinoOnPermission = function (granted) {
    if (!granted) { toast('블루투스 권한이 없으면 로봇을 찾을 수 없어요'); return; }
    try { if (scanner) startScanning(); } catch (e) {}
  };
  function stopScanning() { if (scanner) { try { scanner.stopScan(); } catch (e) {} try { scanner.detach(); } catch (e) {} scanner = null; } }
  function renderDevList() {
    const list = $('devList'); const q = ($('devSearch').value || '').trim().toLowerCase();
    list.innerHTML = '';
    if (!T.AndroidBridgeTransport.supported) return;
    const devs = allDevs.filter(d => !q
      || (d.name || '').toLowerCase().includes(q)
      || (d.address || '').toLowerCase().replace(/:/g, '').includes(q.replace(/:/g, '')));
    if (!devs.length) { list.innerHTML = '<p class="cap">🔍 주변 알티노를 찾는 중… 차 전원을 켜주세요.</p>'; return; }
    devs.sort((a, b) => (b.rssi || -999) - (a.rssi || -999));
    const boundSt = new T.AndroidBridgeTransport().state();
    const bound = boundSt.address || '';
    devs.forEach((d, i) => {
      const b = document.createElement('button');
      b.className = 'btn ghost'; b.style.textAlign = 'left';
      const bars = d.rssi ? (d.rssi > -60 ? '📶' : d.rssi > -80 ? '📶' : '·') : '';
      const near = i === 0 && d.rssi ? ' <span style="color:#37c9ad;font-size:.8rem">· 가장 가까움</span>' : '';
      const locked = bound && d.address !== bound;
      const isBound = d.address === bound ? ' <span style="color:#ffb23e;font-size:.8rem">· 내 짝 ✓</span>' : (locked ? ' <span style="color:#9b8f86;font-size:.8rem">· 🔒 짝 해제 필요</span>' : '');
      b.innerHTML = `🚗 <b style="font-size:1.5rem;color:#5ea0ff">⟨${stickerCode(d.name, d.address)}⟩</b> ${bars}${near}${isBound}<br><span style="font-size:.75rem;color:#9b8f86">${d.name || ''} · ${d.address}</span>`;
      if (locked) b.style.opacity = '.5';
      b.onclick = () => {
        if (bound && d.address !== bound) { const c = stickerCode(boundSt.name, bound); toast('⟨' + c + '⟩' + josaWa(c) + ' 짝이에요 · [🔓 짝 해제] 먼저'); return; }
        stopScanning(); connect('native', d.address); closeConn();
      };
      list.appendChild(b);
    });
  }
  function mac4(addr) { const h = String(addr || '').replace(/:/g, ''); return h.slice(-4).toUpperCase(); }
  // 로봇 'Bluetooth No.'(예: BF16)는 BLE 이름에 들어있음(ALTINO-NBF16). 모델 접두 제거해 그 번호 추출.
  function stickerCode(name, addr) {
    const up = String(name || '').toUpperCase().trim();
    const PRE = ['ALTINO-NEO-', 'ALTINO-NEO', 'ALTINO-LITE-', 'ALTINO-LITE', 'ALTINO-N', 'ALTINO-L', 'ALTINO-', 'ALTINO', 'SMARTFARM-', 'SMARTFARM', 'REALFARM-', 'REALFARM'];
    let c = up;
    for (const p of PRE) if (up.startsWith(p)) { c = up.slice(p.length); break; }
    c = c.replace(/^[\-\s_]+/, '');
    return /^[A-Z0-9]{2,8}$/.test(c) ? c : mac4(addr);
  }
  function openConn() {
    const hint = $('connHint');
    allDevs = [];
    if (T.AndroidBridgeTransport.supported) {
      hint.innerHTML = '차 바닥 스티커 <b>Bluetooth No.</b>(예: <b>BF16</b>)로 찾아 탭하세요. 한 번 고르면 <b>그 차에만</b> 연결돼요. <b>페어링 필요 없어요!</b>';
      startScanning();
    } else {
      hint.textContent = '브라우저에서는 실제 블루투스가 안 돼요. 데모(목)로 UI를 테스트하세요.';
    }
    renderDevList();
    $('connModal').classList.remove('hidden');
  }
  function closeConn() { stopScanning(); $('connModal').classList.add('hidden'); }
  async function disconnect() {
    state.stopAll();
    if (transport) { try { await transport.send(P.buildFrame(state)); } catch (e) {} try { await transport.disconnect(); } catch (e) {} }
    transport = null; setStatus('🔗 연결 안 됨', 'off');
  }

  // ---- 진행 상태 저장/복원 (연결 끊겨 앱 재시작해도 에너지·코인·속도업 유지) ----
  const SAVE_KEY = 'altinoTagV1';
  // 저장이 이만큼 오래되면 '다음 학생'으로 보고 이어하기를 제안하지 않는다.
  // (앞 학생 기록이 계속 떠 있어 헷갈리는 것 방지)
  const RESUME_TTL_MS = 20 * 60 * 1000;   // 20분
  let saveTick = 0;
  function saveState() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify({ e: Math.round(energy), c: coins, s: speedTier, mx: maxTier, ca: caught, g: selectedGrade, t: Date.now() })); } catch (e) {}
  }
  function clearState() { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} }
  function restoreState() {
    try {
      const o = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
      if (!o || !o.g) return false;
      // 시각이 없거나(구버전 저장) 20분이 지났으면 이어하기 대상이 아니다 → 저장 삭제
      if (!o.t || (Date.now() - o.t) > RESUME_TTL_MS) { clearState(); return false; }
      // ⚠ 저장값을 그대로 믿지 않는다. 값이 망가져 있으면(버전이 바뀌었거나 손으로
      //   고쳤거나) speedTier 가 음수가 되어 SPEED_TIERS[-3] = undefined → 속도 NaN →
      //   차가 아예 안 움직이는데 화면엔 이유가 안 나오는 상태가 된다.
      const num = (v, d, lo, hi) => { const x = Number(v); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d; };
      if (!window.AltinoProblems.GRADE_POOLS[o.g]) { clearState(); return false; }
      energy = num(o.e, 500, 0, ENERGY_MAX);
      coins = num(o.c, 0, 0, 9999);
      speedTier = num(o.s, 0, 0, SPEED_TIERS.length - 1);
      // 구버전 저장본(mx 없음)은 현재 단계까지 구매한 것으로 간주
      maxTier = Math.min(SPEED_TIERS.length - 1, Math.max(num(o.mx, speedTier, 0, SPEED_TIERS.length - 1), speedTier));
      caught = num(o.ca, 0, 0, 999);
      selectedGrade = o.g;
      return true;
    } catch (e) { return false; }
  }

  // 새 판 초기화 — 한 곳에서만. ⚠ armed/cooldown 을 같이 되돌리지 않으면,
  //   쫓던 차가 꽁무니에 붙은 채로 새 판을 누를 때 armed 가 false 로 남아
  //   두 차가 물리적으로 떨어질 때까지 새 판의 잡힘이 0으로만 나온다.
  function newGame() {
    caught = 0; energy = 500; coins = 0; speedTier = 0; maxTier = 0;
    armed = true; cooldown = 0;
    clearState();
  }

  function enterGame() {
    const L = window.AltinoProblems.GRADE_LABELS[selectedGrade] || selectedGrade;
    if ($('gradeLabel')) $('gradeLabel').textContent = L;
    $('startScreen').classList.add('hidden');
    $('gameScreen').classList.remove('hidden');
    $('caughtVal').textContent = caught;
    updateEnergyUI(); updateShopUI();
    drawCount(caught);   // 도트매트릭스에 현재 잡힌 횟수
    saveState();
  }
  function pickGrade(g) {
    unlockAudio();
    selectedGrade = g;
    // ⚠ '학년 바꾸기' 표시는 오래 남겨두면 안 된다. A학생이 누르고 자리를 뜬 뒤
    //   B학생이 앉아 학년을 고르면 A의 코인·속도·잡힌 횟수를 그대로 물려받는다.
    //   눌러 놓고 1분이 지나면 다음 학생으로 본다.
    const keep = changingGrade && (Date.now() - changingGradeAt) < KEEP_TTL_MS;
    if (!keep) newGame();        // 홈에서 새로 들어옴 = 다음 학생 → 새 판
    changingGrade = false;
    if ($('keepNote')) $('keepNote').classList.add('hidden');
    enterGame();
  }

  function init() {
    // 시작 화면 학년 선택
    document.querySelectorAll('[data-grade]').forEach(b => {
      b.addEventListener('click', () => pickGrade(b.dataset.grade));
    });
    $('changeGradeBtn') && $('changeGradeBtn').addEventListener('click', () => {
      panicStop();                               // 손 떼지 않고 눌러도 차가 바로 멈추도록
      changingGrade = true; changingGradeAt = Date.now();   // 같은 학생이 난이도만 바꿈 → 진행 유지
      if ($('keepNote')) $('keepNote').classList.remove('hidden');
      $('gameScreen').classList.add('hidden');
      $('startScreen').classList.remove('hidden');
      // 시작 화면의 '이어서 하기' 안내는 페이지를 열 때 한 번만 쓰여 값이 옛것으로 남았다
      if ($('resumeInfo')) $('resumeInfo').textContent = `(에너지 ${Math.round(energy)} · 코인 ${coins} · 잡힘 ${caught})`;
    });

    bindHold($('d-up'),    () => intent.drive = 1,  () => intent.drive = 0);
    bindHold($('d-down'),  () => intent.drive = -1, () => intent.drive = 0);
    bindHold($('d-left'),  () => intent.steer = -127, () => intent.steer = 0);
    bindHold($('d-right'), () => intent.steer = 127,  () => intent.steer = 0);

    $('upgradeBtn').addEventListener('click', buyUpgrade);
    // 잡힌 횟수만 0으로 — 에너지·코인·속도는 유지(같은 학생이 한 판 더)
    $('caughtReset') && $('caughtReset').addEventListener('click', async () => {
      if (caught === 0) { toast('이미 0이에요'); return; }
      if (!await AltinoUI.confirm({
        title: '잡힌 횟수를 0으로 되돌릴까요?',
        lines: [`지금 잡힌 횟수: ${caught}회`, '에너지·코인·속도는 그대로 유지돼요.'],
        okText: '네, 0으로',
      })) return;
      caught = 0; armed = true; cooldown = 0;
      $('caughtVal').textContent = 0; drawCount(0); saveState();
      toast('잡힘 0으로 초기화');
    });
    $('speedDown').addEventListener('click', () => stepSpeed(-1));
    $('speedUpBtn').addEventListener('click', () => stepSpeed(+1));
    $('dotCalBtn') && $('dotCalBtn').addEventListener('click', () => D.openCalibration({
      state,
      send: () => { if (transport && transport.connected) { try { transport.send(P.buildFrame(state)); } catch (e) {} } },
      onDone: () => { toast('도트 방향 저장됨'); drawCount(caught); },
      onCancel: () => drawCount(caught),
    }));
    $('thresh').addEventListener('input', (e) => { rearThresh = +e.target.value; $('threshval').textContent = rearThresh; });
    $('threshval').textContent = rearThresh; $('thresh').value = rearThresh;

    $('chargeBtn').addEventListener('click', genProblem);
    $('probOk').addEventListener('click', checkProblem);
    $('probInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') checkProblem(); });
    $('probClose').addEventListener('click', () => $('repairModal').classList.add('hidden'));
    // 새 판: 진행이 있으면 반드시 확인 — 게임 중 오터치로 기록이 날아가던 사고 방지
    $('resetBtn').addEventListener('click', async () => {
      if (!await AltinoUI.confirm({
        title: '새 판을 시작할까요?',
        lines: ['지금까지의 기록이 모두 사라져요.',
                `· 잡힌 횟수 ${caught}회   · 코인 ${coins}개   · 속도 ${speedNow()}`],
        okText: '네, 새 판 시작',
      })) return;
      newGame();      // 새 판 = 저장된 진행 삭제(다음 학생은 처음부터)
      $('caughtVal').textContent = 0; updateEnergyUI(); updateShopUI(); drawCount(0); toast('새 판 시작!');
    });

    $('c-ws').addEventListener('click', () => connect('ws'));
    $('c-mock').addEventListener('click', () => connect('mock'));
    $('c-disc').addEventListener('click', () => disconnect());

    // 연결 모달
    $('status').addEventListener('click', openConn);
    $('connClose').addEventListener('click', closeConn);
    $('connRefresh').addEventListener('click', openConn);
    $('connMock').addEventListener('click', () => { connect('mock'); closeConn(); });
    $('connDisc').addEventListener('click', () => { disconnect(); openConn(); });
    $('connUnbind') && $('connUnbind').addEventListener('click', async () => {
      if (!await AltinoUI.confirm({
        title: '이 태블릿의 짝을 해제할까요?',
        lines: ['지금 연결된 로봇과의 짝이 풀리고 연결이 끊겨요.', '다른 로봇을 새로 골라야 해요.'],
        okText: '네, 짝 해제',
      })) return;
      try { new T.AndroidBridgeTransport().unbind(); } catch (e) {}
      disconnect(); toast('짝 해제됨 — 새 로봇을 고르세요'); renderDevList();
    });
    $('devSearch').addEventListener('input', renderDevList);
    $('connSettings').addEventListener('click', () => {
      if (T.AndroidBridgeTransport.supported) new T.AndroidBridgeTransport().openSettings();
      else toast('실기(APK)에서만 블루투스 설정을 열 수 있어요');
    });

    // ⚠ 예전엔 intent 만 0으로 두고 실제 정지 프레임은 '다음 100ms 틱'에 맡겼다.
    //   그런데 홈 버튼·화면 꺼짐·페이지 이동 시 WebView 타이머가 멈춰 그 틱이 영영
    //   안 올 수 있다. 로봇은 마지막으로 받은 프레임을 계속 실행하므로, 패드를 누른 채
    //   ← 홈을 누르면 '멈추라고 말해 줄 화면이 없는 채로' 차가 계속 달린다.
    //   그래서 여기서 동기적으로 정지 프레임을 쏜다. (네이티브 링크는 페이지 이동에도 살아있음)
    window.addEventListener('blur', panicStop);
    window.addEventListener('pagehide', panicStop);
    document.addEventListener('visibilitychange', () => { if (document.hidden) panicStop(); });

    // 저장된 진행이 있어도 '자동으로' 게임화면에 들어가지 않는다.
    // (예전엔 자동 진입이라 홈→꼬리잡기 시 학년 선택이 잠깐 떴다 사라져 오류처럼 보였다)
    // 대신 시작 화면에 '이어서 하기' 버튼을 띄워 운영자가 고르게 한다.
    if (restoreState()) {
      const r = $('resumeBtn');
      if (r) {
        r.classList.remove('hidden');
        $('resumeInfo').textContent = `(에너지 ${Math.round(energy)} · 코인 ${coins} · 잡힘 ${caught})`;
        r.addEventListener('click', () => { unlockAudio(); enterGame(); });
      }
    }

    updateEnergyUI();
    updateRobotChip();
    startStream();                       // 게임 루프는 항상 가동(연결 전에도 UI 동작), 전송은 연결 시에만
    if (T.AndroidBridgeTransport.supported) {
      setStatus('🔗 연결 안 됨', 'off'); nativeStart();   // 연결됨→입양 / 바인딩됨→그 로봇 / 없음→스캔 선택
    } else setStatus('🔗 연결 안 됨', 'off');
  }
  document.addEventListener('DOMContentLoaded', init);
})();
