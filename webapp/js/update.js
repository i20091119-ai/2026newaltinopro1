// ═══════════════════════════════════════════════════════════════════
// 앱 안에서 업데이트 — 홈 화면 '업데이트 확인' 버튼
//
// 흐름: AltinoUpdate.check() → __altinoOnUpdate(결과) → 사용자가 '지금 업데이트'
//       → AltinoUpdate.download(url) → __altinoOnUpdateProgress(%) → 설치 화면
//
// 실기(APK)에서만 동작한다. 브라우저에서는 버튼이 숨겨진다.
// 기기당 최초 1회는 '출처를 알 수 없는 앱 설치 허용'을 켜 줘야 한다(안내 문구가 뜬다).
// ═══════════════════════════════════════════════════════════════════
'use strict';
(function () {
  const U = window.AltinoUpdate;
  const btn = document.getElementById('updBtn');
  const verEl = document.getElementById('appVer');
  if (!btn) return;
  if (!U || !U.info) { btn.style.display = 'none'; return; }   // 브라우저: 숨김

  let info = {};
  try { info = JSON.parse(U.info() || '{}'); } catch (e) {}
  if (verEl && info.name) verEl.textContent = 'v' + info.name;

  let box = null, latest = null, phase = 'idle';

  function ui() {
    if (!box) {
      box = document.createElement('div');
      box.id = 'updOv';
      box.style.cssText = 'position:fixed;inset:0;background:rgba(20,20,30,.55);display:flex;' +
        'align-items:center;justify-content:center;z-index:95;font-family:inherit';
      box.innerHTML =
        '<div style="background:#fff;border-radius:22px;padding:26px 28px;width:min(480px,92vw);' +
          'box-shadow:0 12px 40px rgba(120,90,50,.25);color:#3a3230;text-align:center">' +
          '<div id="uIco" style="font-size:2.4rem;margin-bottom:8px">🔄</div>' +
          '<h2 id="uTitle" style="margin:0 0 6px;font-size:1.3rem;font-weight:700">업데이트 확인 중…</h2>' +
          '<div id="uMsg" style="color:#9b8f86;font-size:1rem;line-height:1.6;margin-bottom:14px"></div>' +
          '<div id="uBarWrap" style="display:none;height:12px;background:#f0e6d8;border-radius:999px;' +
            'overflow:hidden;margin-bottom:16px"><div id="uBar" style="height:100%;width:0%;' +
            'background:#37c9ad;transition:width .15s"></div></div>' +
          '<div style="display:flex;gap:10px">' +
            '<button id="uNo" style="flex:1;border:2px solid #f0e6d8;background:#fff;color:#3a3230;' +
              'border-radius:16px;padding:14px;font-family:inherit;font-size:1.05rem;cursor:pointer">닫기</button>' +
            '<button id="uYes" style="flex:1;border:0;background:#37c9ad;color:#fff;border-radius:16px;' +
              'padding:14px;font-family:inherit;font-size:1.05rem;font-weight:700;cursor:pointer;display:none">확인</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(box);
      box.querySelector('#uNo').onclick = () => { if (phase !== 'downloading') box.style.display = 'none'; };
    }
    box.style.display = 'flex';
    return box;
  }
  const set = (ico, title, msg) => {
    const b = ui();
    b.querySelector('#uIco').textContent = ico;
    b.querySelector('#uTitle').textContent = title;
    b.querySelector('#uMsg').innerHTML = msg || '';
  };
  const yes = (label, fn) => {
    const y = ui().querySelector('#uYes');
    if (!label) { y.style.display = 'none'; return; }
    y.style.display = ''; y.textContent = label; y.onclick = fn;
  };
  const bar = (pct) => {
    const b = ui();
    b.querySelector('#uBarWrap').style.display = (pct == null) ? 'none' : '';
    if (pct != null) b.querySelector('#uBar').style.width = pct + '%';
  };
  const mb = (n) => (n > 0 ? (n / 1048576).toFixed(1) + 'MB' : '');

  // ── 네이티브 콜백 ───────────────────────────────────────────────
  window.__altinoOnUpdate = function (json) {
    let r = {}; try { r = JSON.parse(json); } catch (e) {}
    if (!r.ok) {
      phase = 'idle'; bar(null);
      set('😢', '확인하지 못했어요', (r.error || '알 수 없는 오류') +
        '<br><br><b>태블릿이 와이파이에 연결돼 있는지</b> 확인해 주세요.');
      yes('릴리스 페이지 열기', () => { try { U.openReleasePage(); } catch (e) {} });
      return;
    }
    latest = r;
    if (!r.newer) {
      bar(null);
      set('✅', '이미 최신 버전이에요', '설치된 버전 <b>v' + (info.name || '?') + '</b>');
      yes(null);
      return;
    }
    bar(null);
    set('🎁', '새 버전이 있어요!',
      '<b>v' + (info.name || '?') + '</b> → <b style="color:#1b8f6a">v' + r.name + '</b> ' +
      (mb(r.size) ? '(' + mb(r.size) + ')' : '') +
      (r.notes ? '<div style="margin-top:10px;font-size:.9rem;text-align:left;background:#fff7ea;' +
        'border-radius:12px;padding:10px 12px;max-height:130px;overflow:auto">' +
        String(r.notes).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>') + '</div>' : ''));
    yes('지금 업데이트', () => {
      if (info.canInstall === false) {
        set('🔐', '한 번만 허용이 필요해요',
          '안드로이드 보안 정책상 <b>이 앱이 앱을 설치</b>하도록 한 번 허용해야 해요.<br>' +
          '허용 화면에서 스위치를 켠 뒤 <b>뒤로</b> 눌러 돌아와서 다시 눌러 주세요.');
        yes('허용 화면 열기', () => { try { U.openInstallPermission(); } catch (e) {} });
        return;
      }
      phase = 'downloading';
      set('⬇️', '내려받는 중…', '다 받으면 설치 화면이 떠요. <b>기존 자료는 지워지지 않아요.</b>');
      yes(null); bar(0);
      try { U.download(r.url, String(r.size || 0)); } catch (e) { phase = 'idle'; }
    });
  };

  window.__altinoOnUpdateProgress = function (pct) {
    bar(pct);
    if (pct >= 100) {
      phase = 'installing';
      set('📦', '설치 화면을 여는 중…', '“업데이트” 를 눌러 주세요. 설치가 끝나면 앱이 다시 열려요.');
    }
  };

  // ── 버튼 ────────────────────────────────────────────────────────
  btn.addEventListener('click', () => {
    if (phase === 'downloading') { ui(); return; }
    phase = 'checking';
    bar(null); yes(null);
    set('🔄', '업데이트 확인 중…', '잠시만 기다려 주세요');
    try { U.check(); } catch (e) { window.__altinoOnUpdate('{"ok":false,"error":"' + e + '"}'); }
  });
})();
