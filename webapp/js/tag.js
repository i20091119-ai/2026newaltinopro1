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
  const STREAM_MS = 50;                 // 20 tick/s

  // ---- 에너지 경제 (모두 현장 조절용 상수) ----
  const ENERGY_MAX = 2000;             // 최대 저장 = 문제 4개치(40초)
  const DRAIN_PER_SEC = 50;            // 주행 중 초당 소모
  const GAIN_PER_SOLVE = 500;          // 문제 1개 정답 시 충전 → 1문제 = 500/50 = 10초
  const CAUGHT_PENALTY = 250;          // 뒤에 붙잡히면 감소(5초치)
  let energy = 500;                    // 시작 = 문제 1개치

  // ---- 코인 경제 (속도업) ----
  let coins = 0;
  let speedTier = 0;
  const SPEED_TIERS = [350, 450, 550, 650];
  const UPGRADE_COST = [3, 5, 8];      // tier 0→1, 1→2, 2→3 비용(코인)
  const speedNow = () => SPEED_TIERS[speedTier];

  // ---- 꼬리잡기 판정 ----
  let caught = 0;
  let rearThresh = 120;                 // ir6 < thresh → 붙음 (TOF: 가까울수록 작음)
  const RELEASE_GAP = 60;
  const MIN_INTERVAL_TICKS = 60;        // ~1.2s 재카운트 방지 (50ms*24=1.2s → 여기선 프레임 기준 보수적)
  let armed = true, cooldown = 0;
  let soundTicks = 0, ledTicks = 0;

  // ---- 주행 의도 (에너지로 게이팅) ----
  const intent = { drive: 0, steer: 0 }; // drive: -1/0/1

  const $ = (id) => document.getElementById(id);
  const setStatus = (t, c) => { const e = $('status'); e.textContent = t; e.className = 'status ' + (c || ''); };

  function startStream() {
    stopStream();
    streamTimer = setInterval(tick, STREAM_MS);
  }
  function stopStream() { if (streamTimer) { clearInterval(streamTimer); streamTimer = null; } }

  // 스트림 틱: 에너지 게이팅 + 소모 + 비프/플래시 감쇠 + 전송
  function tick() {
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

    updateEnergyUI();
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
    const btn = $('upgradeBtn'); if (!btn) return;
    if (speedTier >= SPEED_TIERS.length - 1) {
      btn.textContent = '🏁 최고 속도!'; btn.disabled = true;
    } else {
      const cost = UPGRADE_COST[speedTier];
      btn.textContent = `🛒 속도업 ${SPEED_TIERS[speedTier + 1]} (코인 ${cost})`;
      btn.disabled = coins < cost;
    }
  }

  function buyUpgrade() {
    if (speedTier >= SPEED_TIERS.length - 1) return;
    const cost = UPGRADE_COST[speedTier];
    if (coins < cost) { toast('코인이 부족해요! 문제를 더 풀어요'); return; }
    coins -= cost; speedTier++;
    updateShopUI();
    toast(`속도 ${speedNow()}! 🚀`);
  }

  // ---- 센서 프레임마다: 뷰어 + 꼬리잡기 ----
  function onSensor(s) {
    for (const k of ['ir1','ir2','ir3','ir4','ir5','ir6']) { const el = $('sv-' + k); if (el) el.textContent = s[k]; }
    if ($('sv-bat')) $('sv-bat').textContent = s.battery;
    const rear = s.ir6;
    if ($('rearNow')) $('rearNow').textContent = rear;

    if (armed && rear < rearThresh && cooldown === 0) {
      caught++; $('caughtVal').textContent = caught;
      energy = Math.max(0, energy - CAUGHT_PENALTY);
      beepFlash();
      armed = false; cooldown = MIN_INTERVAL_TICKS;
    }
    if (!armed && rear > rearThresh + RELEASE_GAP) armed = true;
  }

  function beepFlash() {
    state.soundSet(49); state.ledSet(15);
    soundTicks = Math.round(400 / STREAM_MS); ledTicks = Math.round(400 / STREAM_MS);
    document.body.classList.add('hit');
    setTimeout(() => document.body.classList.remove('hit'), 250);
  }

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

  // ---- 충전소: 문제 풀면 에너지 +GAIN ----
  let curAnswer = null;
  function genProblem() {
    const grade = $('grade').value;
    const r = (n) => 1 + Math.floor(Math.random() * n);
    let text, ans;
    if (grade === 'lo') { const a = r(9), b = r(9); text = `${a} + ${b} = ?`; ans = a + b; }
    else if (grade === 'mid') {
      if (Math.random() < 0.5) { const a = 10 + r(80), b = 10 + r(80); text = `${a} + ${b} = ?`; ans = a + b; }
      else { const a = r(9), b = r(9); text = `${a} × ${b} = ?`; ans = a * b; }
    } else {
      if (Math.random() < 0.5) { const a = 11 + r(30), b = r(9); text = `${a} × ${b} = ?`; ans = a * b; }
      else { const b = r(9), q = r(12); text = `${b * q} ÷ ${b} = ?`; ans = q; }
    }
    curAnswer = ans;
    $('probText').textContent = text;
    $('probInput').value = ''; $('probFb').textContent = '';
    $('repairModal').classList.remove('hidden'); $('probInput').focus();
  }
  function checkProblem() {
    const v = parseInt($('probInput').value, 10);
    if (isNaN(v)) { $('probFb').textContent = '숫자를 입력하세요.'; return; }
    if (v === curAnswer) {
      energy = Math.min(ENERGY_MAX, energy + GAIN_PER_SOLVE);
      coins += 1;
      updateEnergyUI();
      // 연속 풀이: 모달 유지하고 다음 문제 바로 (에너지·코인 몰아 벌기)
      toast(`+${GAIN_PER_SOLVE} 에너지 ⚡  +1 코인 🪙`);
      genProblem();
    } else { $('probFb').textContent = '다시! 계산을 확인해요.'; }
  }
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 1200); }

  // ---- 연결 ----
  async function connect(kind) {
    await disconnect();
    try {
      if (kind === 'native') { transport = new T.AndroidBridgeTransport(); await transport.connect({}); }
      else if (kind === 'ws') { transport = new T.WebSocketTransport(); await transport.connect({ url: $('wsurl').value.trim() }); }
      else { transport = new T.MockTransport(); await transport.connect({}); }
      transport.on('status', (s) => {
        if (s === 'connected') setStatus('연결됨 ✓', 'ok');
        else if (s === 'disconnected') setStatus('연결 끊김', 'off');
        else setStatus('오류: ' + s, 'err');
      });
      transport.on('data', (bytes) => { for (const f of assembler.push(bytes)) onSensor(f); });
      setStatus('연결됨 ✓', 'ok'); startStream();
    } catch (e) { setStatus('연결 실패: ' + e.message, 'err'); transport = null; }
  }
  async function disconnect() {
    stopStream(); state.stopAll();
    if (transport) { try { await transport.send(P.buildFrame(state)); } catch (e) {} try { await transport.disconnect(); } catch (e) {} }
    transport = null; setStatus('연결 안 됨', 'off');
  }

  function init() {
    bindHold($('d-up'),    () => intent.drive = 1,  () => intent.drive = 0);
    bindHold($('d-down'),  () => intent.drive = -1, () => intent.drive = 0);
    bindHold($('d-left'),  () => intent.steer = -127, () => intent.steer = 0);
    bindHold($('d-right'), () => intent.steer = 127,  () => intent.steer = 0);

    $('upgradeBtn').addEventListener('click', buyUpgrade);
    $('thresh').addEventListener('input', (e) => { rearThresh = +e.target.value; $('threshval').textContent = rearThresh; });
    $('threshval').textContent = rearThresh; $('thresh').value = rearThresh;

    $('chargeBtn').addEventListener('click', genProblem);
    $('probOk').addEventListener('click', checkProblem);
    $('probInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') checkProblem(); });
    $('probClose').addEventListener('click', () => $('repairModal').classList.add('hidden'));
    $('resetBtn').addEventListener('click', () => {
      caught = 0; energy = 500; coins = 0; speedTier = 0;
      $('caughtVal').textContent = 0; updateEnergyUI(); toast('새 판 시작!');
    });

    $('c-ws').addEventListener('click', () => connect('ws'));
    $('c-mock').addEventListener('click', () => connect('mock'));
    $('c-disc').addEventListener('click', () => disconnect());

    window.addEventListener('blur', () => intent.drive = 0);
    document.addEventListener('visibilitychange', () => { if (document.hidden) intent.drive = 0; });

    updateEnergyUI();
    if (T.AndroidBridgeTransport.supported) connect('native');
    else setStatus('연결 안 됨', 'off');
  }
  document.addEventListener('DOMContentLoaded', init);
})();
