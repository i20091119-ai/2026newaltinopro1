// t00 견본 앱 — kit API 를 한 번씩 다 써 본다. 새 앱은 필요한 것만 남긴다.
'use strict';
(function () {
  const $ = (id) => document.getElementById(id);

  // ★ kit 만들기 — appId 는 파일 번호와 같아야 한다(t07.html ↔ appId:'t07')
  const kit = AltinoKit.create({
    appId: 't00',
    title: '견본 앱',
    onRunEnd: endRun,              // kit.run 이 끝나면(정상·정지·오류 모두) 불린다
    // onSensor: (s) => { ... },   // 센서 프레임마다 (s.ir1~ir6, s.cds, s.battery)
    // onTick:   () => { ... },    // 100ms 마다(전송 직전)
  });

  // ── 조종 패드: kit.hold 는 '누르는 동안만' + 미끄러져도 유지 + 창 뜨면 무시 ──
  let speed = kit.store.num('speed', 300, 0, 500);
  $('spd').value = speed; $('spdVal').textContent = speed;
  $('spd').addEventListener('input', (e) => { speed = +e.target.value; $('spdVal').textContent = speed; kit.store.set('speed', speed); });
  let fwd = 0, turn = 0;
  const apply = () => kit.drive(fwd * speed, turn);
  kit.hold($('d-up'),    () => { fwd = 1; apply(); },   () => { fwd = 0; apply(); });
  kit.hold($('d-down'),  () => { fwd = -1; apply(); },  () => { fwd = 0; apply(); });
  kit.hold($('d-left'),  () => { turn = -100; apply(); }, () => { turn = 0; apply(); });
  kit.hold($('d-right'), () => { turn = 100; apply(); },  () => { turn = 0; apply(); });

  // ── 자율 동작: 반드시 kit.run 안에서. sleep() 이 false 면 바로 return ──
  $('autoRun').onclick = () => {
    const ok = kit.run(async (r) => {
      $('autoRun').classList.add('hidden'); $('autoStop').classList.remove('hidden');
      kit.toast('벽 앞 20cm 쯤에서 멈춰요');
      while (r.alive()) {
        const front = r.sensor.ir2;                // 작을수록 가깝다!
        if (front != null && front < 200) break;
        r.drive(300, 0);
        if (!await r.sleep(100)) return;           // 정지·화면이탈이면 여기서 끝
      }
      r.drive(0, 0); kit.beep(49, 400);
      kit.record.add({ title: '벽 앞에서 스스로 멈췄어요', stars: 2 });
      kit.toast('멈췄어요! 🛑');
    });
    if (!ok) kit.toast('이미 움직이는 중이에요');
  };
  $('autoStop').onclick = () => { kit.stop(); endRun(); };
  function endRun() { $('autoRun').classList.remove('hidden'); $('autoStop').classList.add('hidden'); }

  // ── 소리: 실측된 8음만 (코드 37~49). 끄기는 kit.beep 가 알아서 ──
  const NOTES = [['도', 37], ['레', 39], ['미', 41], ['파', 42], ['솔', 44], ['라', 46], ['시', 48], ['높은도', 49]];
  NOTES.forEach(([n, code]) => {
    const b = document.createElement('button'); b.className = 'btn ghost'; b.textContent = n;
    b.onclick = () => kit.beep(code, 400);
    $('notes').appendChild(b);
  });

  // ── LED: 15 = 전방등(실측). 나머지 비트↔램프는 아직 실측 전 ──
  $('ledOn').onclick = () => kit.led(15);
  $('ledOff').onclick = () => kit.led(0);

  // ── 도트 ──
  let n = kit.store.num('dotN', 7, 0, 99);
  const showN = () => { $('dotN').textContent = n; kit.dot.number(n); kit.store.set('dotN', n); };
  $('dotUp').onclick = () => { n = Math.max(0, n - 1); showN(); };
  $('dotDown').onclick = () => { n = Math.min(99, n + 1); showN(); };
  $('dotCal').onclick = () => kit.dot.calibrate();
  showN();

  // ── 창: 등록해 두면 떠 있는 동안 움직임이 막힌다 ──
  kit.block($('quiz'));
  $('openQuiz').onclick = () => $('quiz').classList.remove('hidden');
  $('quizClose').onclick = () => $('quiz').classList.add('hidden');

  // ── 모둠 이름(공용) ──
  $('teamIn').value = kit.team.get();
  $('teamSet').onclick = () => { kit.team.set($('teamIn').value); kit.toast('👥 ' + (kit.team.get() || '이름 지움')); };

  // ── 성장기록부(공용) ──
  const recN = () => { $('recN').textContent = kit.record.ofApp().length; };
  $('recAdd').onclick = () => { kit.record.add({ title: '견본 앱을 둘러봤어요', detail: '버튼을 하나씩 눌러 봄', stars: 1 }); recN(); kit.toast('⭐ 기록했어요'); };
  recN();

  // ── 저장 + 확인창: confirm() 대신 kit.confirm (태블릿에서 confirm() 은 먹통) ──
  let cnt = kit.store.num('cnt', 0, 0, 9999);
  const showC = () => { $('cnt').textContent = cnt; kit.store.set('cnt', cnt); };
  $('cntUp').onclick = () => { cnt++; showC(); };
  $('cntReset').onclick = async () => {
    if (!await kit.confirm({ title: '0으로 되돌릴까요?', lines: [`지금 ${cnt}번`], okText: '네, 초기화' })) return;
    cnt = 0; showC();
  };
  showC();
})();
