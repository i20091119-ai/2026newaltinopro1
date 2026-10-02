// ═══════════════════════════════════════════════════════════════════
// AltinoKit — 학교자율시간 주제 앱(t01~t15) 공용 실행 틀
//
// 왜 있나: 2026-09 현장 운영에서 잡은 '로봇이 안 멈추는' 버그들을 15개 앱이
//   각자 다시 만들지 않게 하려고. 안전 규칙은 전부 여기 들어 있고, 주제 앱은
//   kit 을 '쓰기만' 한다. ⚠ 공동저자는 이 파일을 고치지 않는다(통합 담당자만).
//   고쳐야 할 게 있으면 docs/dev-guide/01 의 '공용 파일 변경 요청' 절차로.
//
// 여기서 보장하는 것 (docs/dev-guide/12_안전_규약.md 와 1:1 대응)
//   S1 화면을 벗어나면(blur·pagehide·숨김) 그 자리에서 정지 프레임을 보낸다
//   S2 창(연결창·확인창·앱이 등록한 창)이 떠 있으면 움직임을 받지 않는다
//   S3 '누르는 동안만' 버튼: 포인터 캡처 + touch-action:none (미끄러져도 유지)
//   S4 제자리 출발 킥: 느린 속도로는 모터가 못 출발한다 → 처음 180ms 만 세게
//   S5 자율 동작은 kit.run() 안에서만: 정지/재시작해도 옛 루프가 안 살아난다
//   S6 자율 동작 중 센서가 1.2초 끊기면 정지(옛값을 믿고 돌진하지 않게)
//   S7 정지할 때 부저도 끈다
//   S8 전송은 10Hz 고정(12대 동시 운영)
//
// 사용: const kit = AltinoKit.create({ appId:'t07', title:'수학 시험 보는 날', ... });
//   API 전체는 docs/dev-guide/13_kit_API.md
// ═══════════════════════════════════════════════════════════════════
'use strict';
(function () {
  const P = window.AltinoProtocol, T = window.AltinoTransport;
  const VERSION = '1.0.0';

  const STREAM_MS = 100;                   // S8 — 올리지 말 것
  const KICK = 400, KICK_MS = 180;         // S4
  const KICK_BELOW = 330;                  //    이보다 느린 출발에만 킥
  const FRESH_MS = 1200;                   // S6
  const RECONN_HINT_MS = 12000;            // 이만큼 재연결이 이어지면 원인을 짚어 준다
  const BATT_LOW = 700;
  const RECORD_MAX = 300;

  let created = false;                     // 한 화면에 kit 은 하나만

  // ── 신호 사전 — 15개 앱이 같은 뜻에 같은 소리·같은 도트를 쓴다 ─────────
  // 아이들은 32차시 내내 같은 로봇을 본다. 3번 앱에서 '성공'이던 소리가 9번 앱에서
  // '실패'면 헷갈린다. 그래서 소리 뜻을 여기서 한 번만 정한다(docs/dev-guide/05).
  // 소리 코드는 실측된 8음만: 37도 39레 41미 42파 44솔 46라 48시 49높은도
  const SIGNALS = {
    success: { notes: [[44, 150], [49, 300]], icon: 'ok' },   // 올라가는 두 음
    fail:    { notes: [[41, 150], [37, 300]], icon: 'no' },   // 내려가는 두 음
    notice:  { notes: [[46, 120]] },                          // 짧은 한 음
    start:   { notes: [[37, 100], [41, 100], [44, 200]] },    // 도·미·솔
    caught:  { notes: [[49, 400]] },                          // 꼬리잡기 '잡혔다'와 같은 소리
  };
  // 도트 아이콘 — 바이트=행(위→아래), 비트7=맨 왼쪽 (AltinoDot.drawBytes 형식)
  const ICONS = {
    ok:    [0x00, 0x03, 0x06, 0x0C, 0xD8, 0x70, 0x20, 0x00],   // ✓
    no:    [0x81, 0x42, 0x24, 0x18, 0x18, 0x24, 0x42, 0x81],   // ✗
    ask:   [0x3C, 0x42, 0x02, 0x0C, 0x10, 0x10, 0x00, 0x10],   // ?
    heart: [0x00, 0x66, 0xFF, 0xFF, 0x7E, 0x3C, 0x18, 0x00],   // ♥
    smile: [0x3C, 0x42, 0xA5, 0x81, 0xA5, 0x99, 0x42, 0x3C],   // ☺
  };

  function stickerCode(name, addr) {
    const up = String(name || '').toUpperCase().trim();
    const PRE = ['ALTINO-NEO-', 'ALTINO-NEO', 'ALTINO-LITE-', 'ALTINO-LITE', 'ALTINO-N', 'ALTINO-L',
                 'ALTINO-', 'ALTINO', 'SMARTFARM-', 'SMARTFARM', 'REALFARM-', 'REALFARM'];
    let c = up;
    for (const p of PRE) if (up.startsWith(p)) { c = up.slice(p.length); break; }
    c = c.replace(/^[\-\s_]+/, '');
    if (/^[A-Z0-9]{2,8}$/.test(c)) return c;
    return String(addr || '').replace(/:/g, '').slice(-4).toUpperCase();
  }

  // 받침이 있으면 true — 로봇 번호·이름 뒤 조사(과/와, 이/가, 은/는, 을/를)용
  function hasFinal(word) {
    const ch = String(word || '').trim().slice(-1);
    const DIGIT = { '0': 1, '1': 1, '2': 0, '3': 1, '4': 0, '5': 0, '6': 1, '7': 1, '8': 1, '9': 0 };
    if (ch in DIGIT) return !!DIGIT[ch];
    const code = ch.charCodeAt(0);
    if (code >= 0xAC00 && code <= 0xD7A3) return ((code - 0xAC00) % 28) !== 0;
    return 'lmnr'.includes(ch.toLowerCase());
  }
  function josa(word, pair) {          // pair: '과와' '이가' '은는' '을를'
    return word + (hasFinal(word) ? pair[0] : pair[1]);
  }

  function create(opts) {
    const o = opts || {};
    if (!/^t\d{2}$/.test(o.appId || '')) throw new Error('AltinoKit: appId 는 t00~t15 형식이어야 합니다');
    if (created) throw new Error('AltinoKit: 한 화면에 kit 은 하나만 만들 수 있습니다');
    created = true;

    const appId = o.appId;
    const state = new P.AltinoState();
    const assembler = new P.SensorFrameAssembler();
    const sensor = { ir1: null, ir2: null, ir3: null, ir4: null, ir5: null, ir6: null, cds: null, battery: null };
    let lastRxAt = 0;
    let transport = null, scanner = null, scanDevs = [];
    const motion = { m: 0, steer: 0 };
    let lastM = 0, kickUntil = 0;
    const blockers = new Set();
    const holds = new Set();
    let runGen = 0, running = false, staleTold = false;
    let soundTimer = null;
    let sigTimers = [];
    let reconnSince = 0, reconnTold = false;
    const $ = (id) => document.getElementById(id);

    // ── 저장 (앱마다 이름 공간을 나눈다: altino.t07.xxx) ────────────────
    const NS = 'altino.' + appId + '.';
    const raw = {
      get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
      set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
      del(k) { try { localStorage.removeItem(k); } catch (e) {} },
    };
    const store = {
      get(key, def) { const v = raw.get(NS + key); if (v == null) return def; try { return JSON.parse(v); } catch (e) { return def; } },
      set(key, val) { raw.set(NS + key, JSON.stringify(val)); },
      remove(key) { raw.del(NS + key); },
      // 숫자는 범위로 잘라서 읽는다 — 망가진 저장값이 차를 멈춰 세우던 사고 방지
      num(key, def, lo, hi) { const x = Number(store.get(key, def)); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : def; },
    };

    // ── 모둠 이름 (t01 입학식에서 지음 · 모든 앱이 읽음) ──────────────────
    const team = {
      get() { const v = raw.get('altino.team.name'); return v ? String(v).slice(0, 12) : ''; },
      set(name) { const n = String(name || '').trim().slice(0, 12); if (n) raw.set('altino.team.name', n); else raw.del('altino.team.name'); renderBar(); },
    };

    // ── 성장기록부 (모든 앱이 쓰고 t15 졸업식이 모음) ────────────────────
    const record = {
      list() { try { const a = JSON.parse(raw.get('altino.record') || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } },
      add(entry) {
        const e = entry || {};
        const item = {
          app: appId,
          title: String(e.title || '').slice(0, 40),
          detail: String(e.detail || '').slice(0, 120),
          stars: Math.max(0, Math.min(3, Number(e.stars) | 0)),
          at: Date.now(),
        };
        if (!item.title) return null;
        const a = record.list(); a.push(item);
        while (a.length > RECORD_MAX) a.shift();
        raw.set('altino.record', JSON.stringify(a));
        return item;
      },
      ofApp(id) { return record.list().filter(x => x.app === (id || appId)); },
    };

    // ── 화면 공통 요소 ─────────────────────────────────────────────────
    function toast(msg, ms) {
      let t = $('kitToast');
      if (!t) {
        t = document.createElement('div'); t.id = 'kitToast';
        t.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#3a3230;color:#fff;' +
          'padding:12px 22px;border-radius:999px;opacity:0;transition:opacity .25s;pointer-events:none;z-index:120;' +
          'font-size:1rem;max-width:92vw;text-align:center;font-family:inherit';
        document.body.appendChild(t);
      }
      t.textContent = msg; t.style.opacity = '1';
      clearTimeout(t._h); t._h = setTimeout(() => { t.style.opacity = '0'; }, ms || 1800);
    }

    // 상단 공통 칩: 모둠 이름 · 내 로봇 번호 · 배터리 · 연결 상태(누르면 연결창)
    function renderBar() {
      const bar = $('kitBar'); if (!bar) return;
      if (!bar.dataset.ready) {
        bar.dataset.ready = '1';
        bar.style.cssText += ';display:flex;gap:8px;align-items:center;flex-wrap:wrap';
        bar.innerHTML =
          '<span class="kit-chip" id="kitTeam" style="display:none"></span>' +
          '<span class="kit-chip">🚗 <b id="kitRobot">–</b></span>' +
          '<span class="kit-chip" id="kitBatt" style="display:none">🔋 –</span>' +
          '<button class="kit-chip" id="kitStatus" type="button">🔗 연결 안 됨</button>';
        const css = document.createElement('style');
        css.textContent = '.kit-chip{background:#fff;border:2px solid #f0e6d8;border-radius:999px;padding:6px 12px;' +
          'font-size:.9rem;white-space:nowrap;font-family:inherit;color:#3a3230}' +
          '.kit-chip b{color:#5ea0ff}' +
          '#kitStatus{cursor:pointer}#kitStatus.ok{color:#1b8f6a;border-color:#b9ecdc}' +
          '#kitStatus.pending{color:#a86400;border-color:#ffe0a3}#kitStatus.err{color:#c0392b;border-color:#f6c9c4}' +
          '#kitBatt.low{color:#c0392b;border-color:#f6c9c4}';
        document.head.appendChild(css);
        $('kitStatus').addEventListener('click', openConnect);
      }
      const tn = team.get(), te = $('kitTeam');
      if (te) { te.style.display = tn ? '' : 'none'; te.textContent = '👥 ' + tn; }
      const r = $('kitRobot');
      if (r) {
        if (!T.AndroidBridgeTransport.supported) r.textContent = '데모';
        else { try { const st = new T.AndroidBridgeTransport().state(); r.textContent = st.address ? stickerCode(st.name, st.address) : '–'; } catch (e) { r.textContent = '–'; } }
      }
    }
    function setStatus(text, cls) { const s = $('kitStatus'); if (s) { s.textContent = text; s.className = 'kit-chip ' + (cls || ''); } }

    // ── S2: 움직임을 막아야 하는 순간 ──────────────────────────────────
    function visible(el) {
      if (!el || !el.isConnected) return false;
      const cs = getComputedStyle(el);
      return cs.display !== 'none' && cs.visibility !== 'hidden' && el.getClientRects().length > 0;
    }
    function isBlocked() {
      if (document.hidden) return true;
      for (const el of blockers) if (visible(el)) return true;
      if (visible($('altinoConfirm'))) return true;       // AltinoUI.confirm
      if (visible($('kitScan'))) return true;             // 연결창
      if (visible($('dotCalOverlay'))) return true;       // 도트 방향 맞추기
      return false;
    }

    // ── 전송 루프 (S2·S4·S6·S8) ───────────────────────────────────────
    function tick() {
      if (typeof o.onTick === 'function') { try { o.onTick(api); } catch (e) { console.error(e); } }
      let m = motion.m, st = motion.steer;
      if (isBlocked()) { motion.m = 0; motion.steer = 0; m = 0; st = 0; }
      // S6 — 자율 동작 중에만: 센서가 끊겼는데 움직이면 멈춘다
      if (running && m !== 0 && transport && transport.connected && Date.now() - lastRxAt > FRESH_MS) {
        m = 0; st = 0;
        if (!staleTold) { staleTold = true; toast('⚠ 센서 신호가 끊겨 멈췄어요'); }
      }
      // S4 — 멈춰 있다가 느리게 출발할 때만 잠깐 세게
      if (o.kick !== false && m !== 0 && lastM === 0 && Math.abs(m) < KICK_BELOW) kickUntil = Date.now() + KICK_MS;
      lastM = m;
      const out = (m !== 0 && Date.now() < kickUntil) ? Math.sign(m) * KICK : m;
      state.go(out, out); state.steer(st);
      send();
    }
    function send() { if (transport && transport.connected) { try { transport.send(P.buildFrame(state)); } catch (e) {} } }
    setInterval(tick, STREAM_MS);

    // ── S1·S7: 즉시 정지 ──────────────────────────────────────────────
    function stop() {
      runGen++; running = false;
      motion.m = 0; motion.steer = 0; lastM = 0;
      clearTimeout(soundTimer);
      sigTimers.forEach(clearTimeout); sigTimers = [];     // 재생 중인 신호도 끊는다
      state.go(0, 0); state.steer(0); state.soundSet(0);
      send();
    }
    function panic() {
      holds.forEach(h => h.release());
      stop();
    }
    window.addEventListener('blur', panic);
    window.addEventListener('pagehide', panic);
    document.addEventListener('visibilitychange', () => { if (document.hidden) panic(); });

    // ── S3: 누르는 동안만 ─────────────────────────────────────────────
    function hold(el, onDown, onUp) {
      if (!el) return;
      el.style.touchAction = 'none'; el.style.userSelect = 'none'; el.style.webkitUserSelect = 'none';
      let held = false;
      const h = {
        release() { if (!held) return; held = false; el.classList.remove('pressed'); try { onUp && onUp(); } catch (e) {} },
      };
      const down = (e) => {
        if (held) return;
        if (e && e.cancelable) e.preventDefault();
        if (isBlocked()) return;
        held = true;
        try { if (e && e.pointerId != null) el.setPointerCapture(e.pointerId); } catch (err) {}
        el.classList.add('pressed');
        try { onDown && onDown(); } catch (err) { console.error(err); }
      };
      const up = (e) => { if (e && e.cancelable) e.preventDefault(); h.release(); };
      if (window.PointerEvent) {
        el.addEventListener('pointerdown', down);
        el.addEventListener('pointerup', up);
        el.addEventListener('pointercancel', up);
      } else {
        el.addEventListener('touchstart', down, { passive: false });
        el.addEventListener('touchend', up, { passive: false });
        el.addEventListener('touchcancel', up, { passive: false });
        el.addEventListener('mousedown', down); el.addEventListener('mouseup', up);
      }
      holds.add(h);
      return h;
    }

    // ── 움직임 지시 ───────────────────────────────────────────────────
    function drive(speed, steer) {
      motion.m = Math.max(-1000, Math.min(1000, Math.round(Number(speed) || 0)));
      motion.steer = Math.max(-127, Math.min(127, Math.round(Number(steer) || 0)));
    }
    function beep(code, ms) {
      clearTimeout(soundTimer);
      state.soundSet(code | 0);
      soundTimer = setTimeout(() => state.soundSet(0), ms || 400);   // S7 — 끄는 걸 잊지 않게
    }
    function led(mask) { state.ledSet(mask | 0); }
    // 통일 신호 — kit.signal('success') 처럼. 이름이 없으면 아무것도 안 한다.
    function signal(name) {
      const sg = SIGNALS[name]; if (!sg) { console.warn('알 수 없는 신호:', name); return; }
      sigTimers.forEach(clearTimeout); sigTimers = []; clearTimeout(soundTimer);
      if (sg.icon) dot.icon(sg.icon);
      let t = 0;
      sg.notes.forEach(([code, ms]) => {
        sigTimers.push(setTimeout(() => state.soundSet(code), t));
        t += ms;
        sigTimers.push(setTimeout(() => state.soundSet(0), t));   // 음 사이 짧은 쉼
        t += 40;
      });
    }
    const dot = {
      number(n) { window.AltinoDot.drawNumber(state, n); },
      bytes(rows) { window.AltinoDot.drawBytes(state, rows); },
      clear() { state.dotClear(); },
      calibrate() { window.AltinoDot.openCalibration({ state, send, onDone: () => toast('도트 방향 저장됨'), onCancel: () => {} }); },
      icon(name) { if (ICONS[name]) window.AltinoDot.drawBytes(state, ICONS[name]); },
    };

    // ── S5: 자율 동작은 run() 안에서만 ───────────────────────────────
    function run(fn) {
      if (running) return false;
      running = true; staleTold = false;
      const gen = ++runGen;
      const r = {
        alive: () => running && gen === runGen,
        drive: (s, st) => { if (r.alive()) drive(s, st); },
        // 기다리는 동안 정지가 눌리면 false — 그 뒤 동작은 하지 말고 return 할 것
        sleep: (ms) => new Promise(res => setTimeout(() => { if (!r.alive()) { drive(0, 0); res(false); } else res(true); }, ms)),
        sensor,
        fresh: () => Date.now() - lastRxAt <= FRESH_MS,
      };
      Promise.resolve().then(() => fn(r)).catch(e => { console.error(e); toast('⚠ 동작 중 오류가 나서 멈췄어요'); })
        .finally(() => { if (gen === runGen) { running = false; drive(0, 0); state.soundSet(0); if (typeof o.onRunEnd === 'function') o.onRunEnd(); } });
      return true;
    }

    // ── 센서 수신 ─────────────────────────────────────────────────────
    function onFrame(f) {
      Object.assign(sensor, f);
      lastRxAt = Date.now();
      const b = $('kitBatt');
      if (b && f.battery > 0) { b.style.display = ''; b.textContent = '🔋 ' + f.battery; b.classList.toggle('low', f.battery < BATT_LOW); }
      if (typeof o.onSensor === 'function') { try { o.onSensor(sensor, api); } catch (e) { console.error(e); } }
    }

    // ── 연결 ─────────────────────────────────────────────────────────
    function wire(t) {
      t.on('status', (s) => {
        const base = String(s).split(':')[0];
        noteReconnect(base);
        renderBar();
        if (base === 'connected') { setStatus('🔗 연결됨 ✓', 'ok'); toast('로봇 연결됨'); }
        else if (base === 'connecting') setStatus('🔗 연결 중…', 'pending');
        else if (base === 'reconnecting') setStatus('🔗 재연결 중…', 'pending');
        else if (base === 'disconnected') setStatus('🔗 연결 끊김', 'err');
        else if (base === 'scanning') { /* 진행 알림 — 표시만 */ }
        else setStatus('⚠ ' + String(s).replace('error:', ''), 'err');
        if (typeof o.onStatus === 'function') { try { o.onStatus(base, s); } catch (e) {} }
      });
      t.on('data', (bytes) => { for (const f of assembler.push(bytes)) onFrame(f); });
    }
    function noteReconnect(base) {
      if (base === 'connected') { reconnSince = 0; reconnTold = false; return; }
      if (base !== 'reconnecting' && base !== 'disconnected') return;
      const now = Date.now();
      if (!reconnSince) { reconnSince = now; return; }
      if (reconnTold || now - reconnSince < RECONN_HINT_MS) return;
      reconnTold = true;
      let code = '';
      try { const st = new T.AndroidBridgeTransport().state(); code = st.address ? stickerCode(st.name, st.address) : ''; } catch (e) {}
      toast(code ? `⚠ 이 태블릿은 ⟨${josa(code, '과와')}⟩ 짝이에요. 그 차가 꺼져 있거나 멀리 있으면 연결되지 않아요 — 상단 🔗 → 🔓 짝 해제`
                 : '⚠ 짝지은 로봇이 없어요 — 상단 🔗 을 눌러 차를 고르세요', 5000);
    }
    function start() {
      renderBar();
      if (T.AndroidBridgeTransport.supported) {
        transport = new T.AndroidBridgeTransport(); wire(transport);
        const st = transport.state();
        if (st.connected) transport.adopt();
        else if (st.address) { setStatus('🔗 연결 중…', 'pending'); transport.connectTo(st.address); }
        else openConnect();
      } else {
        // 브라우저(개발용): 가짜 로봇으로 바로 동작
        transport = new T.MockTransport(); wire(transport); transport.connect();
      }
    }

    // ── 연결창 (1:1 짝 잠금) ──────────────────────────────────────────
    function openConnect() {
      if (!T.AndroidBridgeTransport.supported) { toast('브라우저에서는 가짜 로봇(데모)으로 동작해요'); return; }
      let ov = $('kitScan');
      if (!ov) {
        ov = document.createElement('div'); ov.id = 'kitScan';
        ov.style.cssText = 'position:fixed;inset:0;background:rgba(20,20,30,.55);display:flex;align-items:center;justify-content:center;z-index:100;font-family:inherit';
        ov.innerHTML =
          '<div style="background:#fff;border-radius:20px;padding:20px 22px;width:min(560px,92vw);max-height:82vh;overflow:auto">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
              '<b style="font-size:1.25rem">🔗 알티노 연결 <span style="font-size:.85rem;color:#9b8f86">(페어링 필요 없어요)</span></b>' +
              '<button id="kitScanClose" class="kit-chip" type="button">닫기</button></div>' +
            '<p style="color:#9b8f86;margin:0 0 8px">차 바닥 스티커 번호(예: <b>BF16</b>)를 찾아 누르세요.</p>' +
            '<input id="kitScanSearch" type="text" placeholder="번호로 검색" style="width:100%;margin-bottom:8px;font-size:1.05rem;padding:10px 12px;border-radius:12px;border:2px solid #f0e6d8;text-align:center;font-family:inherit">' +
            '<div id="kitScanList"></div>' +
            '<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">' +
              '<button id="kitScanSettings" class="kit-chip" type="button">📶 블루투스 설정</button>' +
              '<button id="kitScanUnbind" class="kit-chip" type="button">🔓 이 태블릿 짝 해제</button></div></div>';
        document.body.appendChild(ov);
        $('kitScanClose').onclick = closeConnect;
        $('kitScanSettings').onclick = () => { try { new T.AndroidBridgeTransport().openSettings(); } catch (e) {} };
        $('kitScanUnbind').onclick = async () => {
          if (!await window.AltinoUI.confirm({ title: '이 태블릿의 짝을 해제할까요?',
            lines: ['지금 연결된 로봇과의 짝이 풀리고 연결이 끊겨요.', '다른 로봇을 새로 골라야 해요.'], okText: '네, 짝 해제' })) return;
          try { new T.AndroidBridgeTransport().unbind(); } catch (e) {}
          try { if (transport) await transport.disconnect(); } catch (e) {}
          transport = new T.AndroidBridgeTransport(); wire(transport);
          renderBar(); toast('짝 해제됨 — 새 로봇을 고르세요'); renderScan();
        };
        $('kitScanSearch').addEventListener('input', renderScan);
      }
      ov.style.display = 'flex';
      stopScanning(); scanDevs = [];
      scanner = new T.AndroidBridgeTransport();
      scanner.on('scan', (d) => {
        if (!d || !d.address) return;
        const i = scanDevs.findIndex(x => x.address === d.address);
        if (i >= 0) { if (d.name) scanDevs[i].name = d.name; scanDevs[i].rssi = d.rssi || scanDevs[i].rssi; }
        else scanDevs.push({ name: d.name || '', address: d.address, rssi: d.rssi || 0 });
        renderScan();
      });
      scanner.startScan(); renderScan();
    }
    function stopScanning() { if (scanner) { try { scanner.stopScan(); } catch (e) {} try { scanner.detach(); } catch (e) {} scanner = null; } }
    function closeConnect() { stopScanning(); const ov = $('kitScan'); if (ov) ov.style.display = 'none'; }
    function renderScan() {
      const list = $('kitScanList'); if (!list) return;
      const q = (($('kitScanSearch') || {}).value || '').trim().toLowerCase();
      const devs = scanDevs.filter(d => !q || (d.name || '').toLowerCase().includes(q) || stickerCode(d.name, d.address).toLowerCase().includes(q));
      if (!devs.length) { list.innerHTML = '<p style="color:#9b8f86">🔍 주변 알티노를 찾는 중… 차 전원을 켜 주세요.</p>'; return; }
      devs.sort((a, b) => (b.rssi || -999) - (a.rssi || -999));
      let bound = '', boundName = '';
      try { const st = new T.AndroidBridgeTransport().state(); bound = st.address || ''; boundName = st.name || ''; } catch (e) {}
      list.innerHTML = '';
      devs.forEach((d, i) => {
        const code = stickerCode(d.name, d.address);
        const locked = bound && d.address !== bound;
        const b = document.createElement('button'); b.type = 'button'; b.className = 'kit-chip';
        b.style.cssText = 'display:block;width:100%;text-align:left;margin-bottom:8px;border-radius:14px;padding:10px 14px' + (locked ? ';opacity:.5' : '');
        b.innerHTML = '🚗 <b style="font-size:1.4rem">⟨' + code + '⟩</b>' +
          (i === 0 && d.rssi ? ' <span style="color:#37c9ad;font-size:.8rem">· 가장 가까움</span>' : '') +
          (d.address === bound ? ' <span style="color:#ffb23e;font-size:.8rem">· 내 짝 ✓</span>' : (locked ? ' <span style="color:#9b8f86;font-size:.8rem">· 🔒 짝 해제 필요</span>' : ''));
        b.onclick = () => {
          if (locked) { toast('이 태블릿은 ⟨' + josa(stickerCode(boundName, bound), '과와') + '⟩ 짝이에요 — 바꾸려면 [🔓 짝 해제] 먼저'); return; }
          closeConnect(); setStatus('🔗 연결 중…', 'pending');
          if (!transport) { transport = new T.AndroidBridgeTransport(); wire(transport); }
          transport.connectTo(d.address);
        };
        list.appendChild(b);
      });
    }

    const api = {
      VERSION, appId, state, sensor,
      get connected() { return !!(transport && transport.connected); },
      get running() { return running; },
      sensorAge: () => (lastRxAt ? Date.now() - lastRxAt : Infinity),
      drive, stop, hold, beep, led, dot, run, abortRun: stop, signal,
      block: (el) => { if (el) blockers.add(el); },
      isBlocked,
      store, team, record,
      toast, confirm: (opts2) => window.AltinoUI.confirm(opts2),
      openConnect, stickerCode, josa,
    };
    window.__altinoKit = api;          // 시험 도구가 들여다보는 창구(앱에서 쓰지 말 것)
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
    return api;
  }

  window.AltinoKit = { VERSION, create, stickerCode, josa, SIGNALS, ICONS };
})();
