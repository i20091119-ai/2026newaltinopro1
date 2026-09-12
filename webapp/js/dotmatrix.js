// ═══════════════════════════════════════════════════════════════════
// 알티노 8×8 도트매트릭스 — 논리좌표 그리기 + 방향 보정
//
// 【근본 원인 — 현장 확정】
// protocol.js 의 state.dotOn(col,row) 에서
//   col … 실제로 가로(왼→오). 가정대로 정상.
//   row … 실제로는 '아래에서 위로' 세는 번호! (row 1 = 맨 아래줄, row 8 = 맨 윗줄)
// 즉 세로축만 뒤집혀 있었다. 그런데 기존 코드는 여기에 180° 회전까지 얹어서
//   dotOn(9-x, 9-y) 로 찍었고 → 세로는 우연히 맞고 가로만 거울상이 됐다.
//   그래서 "14"가 좌우 거울상이라 "41"처럼 보였고(현장 1차 제보),
//   자리만 바꿔 고쳤더니 글자 자체는 여전히 거울상이라 계속 깨져 보였다(2차 제보).
// 【정답】 논리(x=왼→오, y=위→아래) → dotOn(x, 9-y)  ← 보정화면 '7번', 현장 검증 완료.
//
// 【해결 구조】 논리좌표로만 그리고 마지막에 한 번 변환한다. 기기 차이가 있어도
//   보정화면에서 8방향 중 고르면 저장되므로 코드 수정 없이 현장 대응 가능.
// ===============================================================
'use strict';
(function () {
  // 논리(x,y) → dotOn(col,row) 로 가능한 8가지 변환 전부.
  // 7번이 현장 검증된 기본값. 나머지는 기기 차이 대비 예비.
  const ORIENTS = [
    { label: '1',                f: (x, y) => [9 - y, 9 - x] },
    { label: '2',                f: (x, y) => [9 - y, x] },
    { label: '3',                f: (x, y) => [y, 9 - x] },
    { label: '4',                f: (x, y) => [y, x] },
    { label: '5',                f: (x, y) => [9 - x, 9 - y] },
    { label: '6',                f: (x, y) => [9 - x, y] },
    { label: '7 · 기본 (권장)',  f: (x, y) => [x, 9 - y] },
    { label: '8',                f: (x, y) => [x, y] },
  ];
  const KEY = 'altinoDotOrientV1';   // 전 앱 공용(한 번 맞추면 모든 앱에 적용)
  let orient = 6;   // 현장 검증된 기본값(라벨 '7') = (x,y)→dotOn(x, 9-y)
  try { const v = parseInt(localStorage.getItem(KEY), 10); if (v >= 0 && v < ORIENTS.length) orient = v; } catch (e) {}

  // 3×5 숫자 폰트 (논리좌표: 행=위→아래)
  const DIGITS = {
    0: ['111', '101', '101', '101', '111'], 1: ['010', '110', '010', '010', '111'],
    2: ['111', '001', '111', '100', '111'], 3: ['111', '001', '111', '001', '111'],
    4: ['101', '101', '111', '001', '001'], 5: ['111', '100', '111', '001', '111'],
    6: ['111', '100', '111', '101', '111'], 7: ['111', '001', '010', '100', '100'],
    8: ['111', '101', '111', '101', '111'], 9: ['111', '101', '111', '001', '111'],
  };
  // 보정용 시험 글자 'F' — 상하·좌우 모두 비대칭이라 회전/거울을 즉시 구분할 수 있다.
  const TEST_F = ['11111', '10000', '10000', '11110', '10000', '10000', '10000'];

  function put(state, x, y) {
    if (x < 1 || x > 8 || y < 1 || y > 8) return;
    const [c, r] = ORIENTS[orient].f(x, y);
    state.dotOn(c, r);
  }
  function begin(state) { state.dotClear(); state.displayMode = 0xFF; state.dot.fill(0); }

  // rows: ['101','010',...] 형태의 논리 비트맵을 (baseX, baseY)에 찍는다
  function stamp(state, rows, baseX, baseY) {
    for (let dy = 0; dy < rows.length; dy++)
      for (let dx = 0; dx < rows[dy].length; dx++)
        if (rows[dy][dx] === '1') put(state, baseX + dx, baseY + dy);
  }
  function drawGlyph(state, rows, baseX, baseY) {
    begin(state);
    stamp(state, rows, baseX || 1, baseY || 1);
  }
  // 0~99 숫자. 십의 자리가 왼쪽 — 논리좌표라 자리 뒤바뀜(14→41) 자체가 발생하지 않는다.
  function drawNumber(state, n) {
    begin(state);
    n = Math.max(0, Math.min(99, n | 0));
    if (n < 10) stamp(state, DIGITS[n], 3, 2);
    else { stamp(state, DIGITS[(n / 10) | 0], 1, 2); stamp(state, DIGITS[n % 10], 5, 2); }
  }
  // 8바이트를 '논리 행(위→아래), 비트7=왼쪽'으로 해석해 찍기 (기존 FONT 호환)
  function drawBytes(state, bytes) {
    begin(state);
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++)
        if ((bytes[y] >> (7 - x)) & 1) put(state, x + 1, y + 1);
  }

  // ── 방향 보정 화면 (강사용) ─────────────────────────────
  // 로봇에 'F'를 띄우고, 화면의 F와 같아 보이는 방향을 고르면 저장.
  function openCalibration(opts) {
    const state = opts.state, send = opts.send || function () {};
    let pick = orient;
    let ov = document.getElementById('dotCalOverlay');
    if (!ov) {
      ov = document.createElement('div'); ov.id = 'dotCalOverlay';
      ov.style.cssText = 'position:fixed;inset:0;background:rgba(20,20,30,.6);display:flex;align-items:center;justify-content:center;z-index:70';
      ov.innerHTML = `<div style="background:#fff;border-radius:20px;padding:22px 24px;width:min(620px,94vw);max-height:88vh;overflow:auto;
          box-shadow:0 8px 24px rgba(120,90,50,.12);font-family:inherit;color:#3a3230">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <h2 style="margin:0;font-size:1.2rem">🔢 도트매트릭스 방향 맞추기</h2>
          <button id="dcClose" style="border:0;background:#fff;border:2px solid #f0e6d8;border-radius:12px;padding:6px 14px;font-family:inherit;cursor:pointer">닫기</button>
        </div>
        <p style="margin:4px 0 12px;color:#9b8f86;font-size:.92rem">
          로봇 도트매트릭스에 <b>F</b> 가 켜집니다. 아래 그림과 <b>똑같이 보이는</b> 방향을 찾아 [이걸로 저장]을 누르세요.</p>
        <div style="display:flex;gap:20px;align-items:center;flex-wrap:wrap">
          <div>
            <div style="font-size:.85rem;color:#9b8f86;margin-bottom:6px">이렇게 보여야 정상</div>
            <div id="dcPreview" style="display:grid;grid-template-columns:repeat(8,18px);gap:3px"></div>
          </div>
          <div style="flex:1;min-width:210px">
            <div style="font-size:1.05rem;margin-bottom:10px">현재 방향: <b id="dcName" style="color:#5ea0ff"></b></div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button id="dcPrev" class="btn ghost" style="border:2px solid #f0e6d8;background:#fff;border-radius:14px;padding:12px 16px;font-family:inherit;font-size:1rem;cursor:pointer">◀ 이전</button>
              <button id="dcNext" class="btn" style="border:0;background:#5ea0ff;color:#fff;border-radius:14px;padding:12px 16px;font-family:inherit;font-size:1rem;cursor:pointer">다음 방향 ▶</button>
            </div>
            <button id="dcSave" style="margin-top:12px;width:100%;border:0;background:#37c9ad;color:#fff;border-radius:14px;padding:14px;font-family:inherit;font-size:1.05rem;font-weight:700;cursor:pointer">✅ 이걸로 저장</button>
            <p style="margin:10px 0 0;color:#9b8f86;font-size:.82rem">저장하면 이 태블릿의 모든 활동(꼬리잡기 점수·배송 문자 등)에 함께 적용돼요.</p>
          </div>
        </div>
      </div>`;
      document.body.appendChild(ov);
      // 화면 미리보기(논리좌표 F) — 로봇과 눈으로 대조하는 기준
      const pv = ov.querySelector('#dcPreview');
      for (let y = 1; y <= 8; y++) for (let x = 1; x <= 8; x++) {
        const on = (y >= 1 && y <= 7 && x >= 2 && x <= 6) && TEST_F[y - 1][x - 2] === '1';
        const d = document.createElement('div');
        d.style.cssText = `width:18px;height:18px;border-radius:4px;background:${on ? '#ff3b30' : '#f0e6d8'}`;
        pv.appendChild(d);
      }
    }
    ov.style.display = 'flex';
    const show = () => {
      ov.querySelector('#dcName').textContent = ORIENTS[pick].label;
      const saved = orient; orient = pick;          // 미리보기 동안만 임시 적용
      // finally 로 반드시 되돌린다 — 도중에 예외가 나면 방향이 임시값으로 굳어
      // 이후 모든 숫자가 조용히 틀어진 채로 나온다(저장은 안 됐으니 원인 찾기도 어렵다)
      try { drawGlyph(state, TEST_F, 2, 1); } finally { orient = saved; }
      try { send(); } catch (e) {}
    };
    ov.querySelector('#dcPrev').onclick = () => { pick = (pick + ORIENTS.length - 1) % ORIENTS.length; show(); };
    ov.querySelector('#dcNext').onclick = () => { pick = (pick + 1) % ORIENTS.length; show(); };
    ov.querySelector('#dcSave').onclick = () => {
      orient = pick;
      try { localStorage.setItem(KEY, String(orient)); } catch (e) {}
      ov.style.display = 'none';
      if (opts.onDone) opts.onDone(orient);
    };
    ov.querySelector('#dcClose').onclick = () => {
      ov.style.display = 'none';
      begin(state); try { send(); } catch (e) {}     // 시험 글자 지우기
      if (opts.onCancel) opts.onCancel();
    };
    show();
  }

  window.AltinoDot = {
    ORIENTS, DIGITS, TEST_F,
    getOrient: () => orient,
    setOrient: (i) => { if (i >= 0 && i < ORIENTS.length) { orient = i; try { localStorage.setItem(KEY, String(i)); } catch (e) {} } },
    put, clear: begin, drawGlyph, drawNumber, drawBytes, openCalibration,
  };
})();
