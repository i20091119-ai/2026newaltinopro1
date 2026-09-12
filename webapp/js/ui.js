// ═══════════════════════════════════════════════════════════════════
// 공용 UI — 확인창(AltinoUI.confirm)
//
// ⚠ 왜 브라우저 기본 confirm()을 쓰지 않는가:
//   안드로이드 WebView는 WebChromeClient 가 설정돼 있지 않으면 window.confirm() 이
//   창을 띄우지 않고 즉시 false 를 반환한다. 그러면 '정말 하시겠습니까?' 를 붙인
//   버튼이 실기에서 아무 반응 없는 먹통 버튼이 된다(실제로 그런 상태였음).
//   그래서 화면 안에 직접 그리는 확인창을 쓴다. 브라우저·실기 모두 동일하게 동작하고
//   디자인도 앱과 맞는다.
//
// 사용:
//   if (await AltinoUI.confirm({ title:'새 판을 시작할까요?', lines:['잡힌 횟수 3회'],
//                                okText:'새 판 시작', danger:true })) { ... }
// ═══════════════════════════════════════════════════════════════════
'use strict';
(function () {
  let ov = null, resolver = null, shownAt = 0;

  function build() {
    ov = document.createElement('div');
    ov.id = 'altinoConfirm';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(20,20,30,.55);display:none;' +
      'align-items:center;justify-content:center;z-index:90;font-family:inherit';
    ov.innerHTML =
      '<div id="acBox" style="background:#fff;border-radius:22px;padding:26px 28px;width:min(460px,92vw);' +
        'box-shadow:0 12px 40px rgba(120,90,50,.25);color:#3a3230;text-align:center">' +
        '<div id="acIcon" style="font-size:2.4rem;line-height:1;margin-bottom:10px">❓</div>' +
        '<h2 id="acTitle" style="margin:0 0 8px;font-size:1.3rem;font-weight:700"></h2>' +
        '<div id="acLines" style="color:#9b8f86;font-size:1rem;line-height:1.7;margin-bottom:18px"></div>' +
        '<div style="display:flex;gap:10px">' +
          '<button id="acNo" style="flex:1;border:2px solid #f0e6d8;background:#fff;color:#3a3230;' +
            'border-radius:16px;padding:15px;font-family:inherit;font-size:1.05rem;cursor:pointer">아니요</button>' +
          '<button id="acYes" style="flex:1;border:0;background:#ff7a86;color:#fff;border-radius:16px;' +
            'padding:15px;font-family:inherit;font-size:1.05rem;font-weight:700;cursor:pointer">네</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);
    ov.querySelector('#acNo').addEventListener('click', () => done(false));
    ov.querySelector('#acYes').addEventListener('click', () => done(true));
    // 바깥을 눌러도 '취소' — 실수로 진행되는 쪽이 없도록.
    // ⚠ 단, 창이 뜬 직후 350ms 는 무시한다. 아이들은 버튼을 습관적으로 두 번 누르는데,
    //   두 번째 탭이 갓 생긴 배경에 떨어져 '아니요'가 되면 버튼이 먹통처럼 보인다.
    ov.addEventListener('click', (e) => {
      if (e.target !== ov) return;
      if (Date.now() - shownAt < 350) return;
      done(false);
    });
  }

  function done(v) {
    if (ov) ov.style.display = 'none';
    const r = resolver; resolver = null;
    if (r) r(v);
  }

  // 항상 Promise<boolean> 을 돌려준다. 취소가 기본값(안전한 쪽).
  function confirmBox(opts) {
    const o = opts || {};
    if (!ov) build();
    if (resolver) done(false);          // 이전 창이 떠 있으면 취소 처리
    ov.querySelector('#acIcon').textContent = o.icon || (o.danger ? '⚠️' : '❓');
    ov.querySelector('#acTitle').textContent = o.title || '정말 진행할까요?';
    const lines = Array.isArray(o.lines) ? o.lines : (o.lines ? [o.lines] : []);
    ov.querySelector('#acLines').innerHTML = lines.map(t =>
      '<div>' + String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</div>').join('');
    const yes = ov.querySelector('#acYes');
    yes.textContent = o.okText || '네, 할게요';
    yes.style.background = (o.danger === false) ? '#37c9ad' : '#ff7a86';
    ov.querySelector('#acNo').textContent = o.cancelText || '아니요';
    ov.style.display = 'flex';
    shownAt = Date.now();
    return new Promise((res) => { resolver = res; });
  }

  window.AltinoUI = { confirm: confirmBox };
})();
