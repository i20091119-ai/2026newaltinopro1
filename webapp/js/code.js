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
  // ⚠ 주행 '세대' 번호. 정지를 눌러도 이전 루프는 await sleep() 안에 들어가 있어
  //   곧 깨어난다. 그때 이미 새 주행이 시작돼 있으면 두 루프가 동시에 모터를
  //   지시해 차가 제멋대로 움직인다(정지 직후 다시 출발할 때). 세대가 바뀌면
  //   옛 루프는 스스로 물러난다.
  let runGen = 0;
  // 센서 프레임이 마지막으로 들어온 시각. 이게 멎으면 sensor 는 옛값 그대로라
  // 벽이 앞에 있어도 '뚫려 있다'고 믿고 25초를 직진한다.
  let lastRxAt = 0;
  const STREAM_MS = 100;   // 20Hz→10Hz: 12대 동시운영 시 BT 트래픽 절반(안정성↑)
  const sensor = { ir1: 999, ir2: 999, ir3: 999, ir4: 999, ir5: 999, ir6: 999, cds: 999, battery: 0 };

  // 학생 입력(코딩 빈칸)
  let rawBright = 620, rawDark = 90; // ① 조도 측정 원값
  let brightVal = 620, darkVal = 90; // ① 나누는 수에 맞춰 반올림한 표시값
  let lightDiv = 2;                  // ① 나누는 수(2 또는 4) — 센서가 예민하면 4로 낮춤
  let lightThresh = 355;             // ① 사이값(학생이 계산해 입력)
  let grade = null, recoverCode = null; // ② 암호(수학)
  let note1 = 37, note2 = 41, repeatN = 3; // ③ 미션1 소리(도37·미41 기본, 3회)
  let zone = null;                   // ④ 미션2 배송지 문자

  // 벽추종/주행 보정 — 실측 스케일: 가까울수록 작음(5cm≈60), 벽 없음≈1300.
  // 그래서 '일찍 감지'하려면 임계를 크게(≈250) 잡아야 코앞이 아니라 여유거리에서 반응.
  // 기본값 = 실기(경남수학문화관 n자 코스)에서 검증된 값. 설정에서 바꾸면 자동 저장됨.
  let TOF1 = 130, TOF2 = 160, TOF3 = 130;   // 전면 좌/중앙/우 감지 거리(값 미만이면 벽). 정면 160=현장(n자 코스) 완주 검증값
  let DRIVE = 300, STEER = 30;              // 순항 속도 / 벽 근접 시 살짝 틀기
  let TURN = 127;                           // 정면 벽 회피 회전(강하게 꺾기)
  const WF_BACK = -300, HOLD_MS = 350;      // 아주 가까울 때 후진 / 동작 유지 시간
  // 회피 중인데 앞이 이 시간만큼 안 뚫리면 '끼임'으로 보고 거리와 무관하게 후진시킨다.
  // (코너에 비스듬히 박히면 앞거리가 더 줄지 않아 후진 조건에 영영 안 걸리던 문제)
  const ESC_STALL_MS = 2500;
  const ESC_GAIN = 12;                      // 앞거리가 이만큼 늘면 '진전 있음'으로 보고 타이머 리셋
  const BUMP_SPEED = -350, BUMP_MS = 200;   // 터널 진입 범프
  const PHASE_TIMEOUT = 25000;
  // 측면 센서(ir4 우측면 / ir5 좌측면) 정밀 벽추종 — 복도 가운데 유지
  let SIDE_ON = true, SIDE_KP = 0.12, SIDE_TARGET = 100;
  const SIDE_SMAX = 50, SIDE_VALID = 900;   // 조향 상한↑(더 세게 보정)·측면 벽 더 일찍 감지

  // ② 복구코드 문제 — 초1~고1 각 20문항(정수 정답).
  // 각 학년 1학기 교육과정 범위, 난이도는 가장 쉬운 수준으로만. (독립 검산기 0오류 통과)
  const PROBLEMS = {
    // 초1·초2는 예전엔 없어서 1·2학년 학생이 초3(곱셈·나눗셈)을 골라야 했다.
    e1: { label: '초1 · 덧셈·뺄셈', list: [
      // 1학년 1학기: 9까지의 수 · 덧셈과 뺄셈(합 9 이하)
      { q: '3 + 4 = ?', a: 7 }, { q: '2 + 5 = ?', a: 7 },
      { q: '1 + 6 = ?', a: 7 }, { q: '4 + 4 = ?', a: 8 },
      { q: '5 + 3 = ?', a: 8 }, { q: '2 + 7 = ?', a: 9 },
      { q: '6 + 3 = ?', a: 9 }, { q: '1 + 8 = ?', a: 9 },
      { q: '9 − 4 = ?', a: 5 }, { q: '8 − 3 = ?', a: 5 },
      { q: '7 − 2 = ?', a: 5 }, { q: '9 − 3 = ?', a: 6 },
      { q: '8 − 2 = ?', a: 6 }, { q: '6 − 2 = ?', a: 4 },
      { q: '5 − 1 = ?', a: 4 }, { q: '7 − 4 = ?', a: 3 },
      { q: '4 + 3 = ?', a: 7 }, { q: '3 + 3 = ?', a: 6 },
      { q: '9 − 6 = ?', a: 3 }, { q: '8 − 6 = ?', a: 2 } ] },
    e2: { label: '초2 · 두 자리 계산', list: [
      // 2학년 1학기: 세 자리 수 · 받아올림/내림이 있는 두 자리 덧뺄 · 곱셈의 뜻
      { q: '24 + 13 = ?', a: 37 }, { q: '35 + 22 = ?', a: 57 },
      { q: '46 + 31 = ?', a: 77 }, { q: '28 + 15 = ?', a: 43 },
      { q: '37 + 26 = ?', a: 63 }, { q: '49 + 18 = ?', a: 67 },
      { q: '58 − 23 = ?', a: 35 }, { q: '76 − 41 = ?', a: 35 },
      { q: '64 − 32 = ?', a: 32 }, { q: '52 − 17 = ?', a: 35 },
      { q: '81 − 26 = ?', a: 55 }, { q: '70 − 45 = ?', a: 25 },
      { q: '2씩 4묶음은 모두 몇 개?', a: 8 }, { q: '5씩 3묶음은 모두 몇 개?', a: 15 },
      { q: '3씩 5묶음은 모두 몇 개?', a: 15 }, { q: '4씩 4묶음은 모두 몇 개?', a: 16 },
      { q: '10이 6개인 수는?', a: 60 }, { q: '100이 3개인 수는?', a: 300 },
      { q: '99보다 1 큰 수는?', a: 100 }, { q: '40 + 30 = ?', a: 70 } ] },
    e3: { label: '초3 · 곱셈·나눗셈', list: [
      // 3학년 1학기: 세 자리 덧뺄·나눗셈·곱셈(두자리×한자리)·길이와 시간·평면도형
      { q: '245 + 132 = ?', a: 377 }, { q: '361 + 118 = ?', a: 479 },
      { q: '236 + 145 = ?', a: 381 }, { q: '400 − 150 = ?', a: 250 },
      { q: '523 − 218 = ?', a: 305 }, { q: '12 ÷ 3 = ?', a: 4 },
      { q: '24 ÷ 6 = ?', a: 4 }, { q: '35 ÷ 5 = ?', a: 7 },
      { q: '18 ÷ 2 = ?', a: 9 }, { q: '27 ÷ 3 = ?', a: 9 },
      { q: '12 × 3 = ?', a: 36 }, { q: '21 × 4 = ?', a: 84 },
      { q: '13 × 2 = ?', a: 26 }, { q: '32 × 3 = ?', a: 96 },
      { q: '24 × 2 = ?', a: 48 }, { q: '1cm = ? mm', a: 10 },
      { q: '1km = ? m', a: 1000 }, { q: '1분 = ? 초', a: 60 },
      { q: '1시간 = ? 분', a: 60 }, { q: '직사각형의 변은 모두 몇 개?', a: 4 } ] },
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
  // ④ 배송지: 자동차/배송 소재의 수학 문제를 풀어 '상자 수'를 구하면, 그 개수의 배송지 문자를 획득.
  // box(상자 수)는 5개 구역 모두 서로 다른 값 → 계산 결과가 배송지를 유일하게 결정.
  const ZONES = [
    { name: '북부 물류창고', code: 'N', box: 12, probs: [
      { q: '🚚 배송 상자를 한 줄에 4개씩 3줄로 쌓았어요. 상자는 모두 몇 개?', a: 12 },
      { q: '🚚 배송차 2대에 상자를 6개씩 실었어요. 상자는 모두 몇 개?', a: 12 } ] },
    { name: '서부 터미널', code: 'W', box: 15, probs: [
      { q: '🚚 한 줄에 5개씩 3줄로 쌓은 배송 상자는 모두 몇 개?', a: 15 },
      { q: '🚚 상자 21개 중 6개를 배달했어요. 남은 상자는 몇 개?', a: 15 } ] },
    { name: '동부 집하장', code: 'E', box: 18, probs: [
      { q: '🚚 한 줄에 6개씩 3줄로 쌓은 배송 상자는 모두 몇 개?', a: 18 },
      { q: '🚚 상자 20개 중 2개를 내렸어요. 남은 상자는 몇 개?', a: 18 } ] },
    { name: '남부 보관소', code: 'S', box: 20, probs: [
      { q: '🚚 한 줄에 5개씩 4줄로 쌓은 배송 상자는 모두 몇 개?', a: 20 },
      { q: '🚚 배송차 2대에 상자를 10개씩 실었어요. 상자는 모두 몇 개?', a: 20 } ] },
    { name: '중앙 배송센터', code: 'D', box: 24, probs: [
      { q: '🚚 배송차 3대에 상자를 8개씩 실었어요. 상자는 모두 몇 개?', a: 24 },
      { q: '🚚 배송차 4대에 상자를 6개씩 실었어요. 상자는 모두 몇 개?', a: 24 } ] },
  ];
  const NOTE_NAME = { 37: '도', 39: '레', 41: '미', 42: '파', 44: '솔', 46: '라', 48: '시', 49: '높은도' };
  // 계이름 → 주파수(Hz) — 태블릿 스피커로 미리듣기(로봇 미연결에도 소리 확인 가능)
  const NOTE_FREQ = { 37: 523.25, 39: 587.33, 41: 659.25, 42: 698.46, 44: 783.99, 46: 880.0, 48: 987.77, 49: 1046.5 };
  let audioCtx = null;
  function beep(freq, ms) {  // Web Audio 짧은 '삐' — 부드러운 사인파
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const t = audioCtx.currentTime, osc = audioCtx.createOscillator(), g = audioCtx.createGain();
      osc.type = 'sine'; osc.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
      osc.connect(g); g.connect(audioCtx.destination); osc.start(t); osc.stop(t + ms / 1000 + 0.02);
    } catch (e) {}
  }
  // 미리듣기: 태블릿 스피커 + (연결 시) 로봇 부저로도 실제 음 재생
  async function previewNote(code) {
    beep(NOTE_FREQ[code] || 660, 400);
    if (transport && transport.connected) {
      try { state.soundSet(code); transport.send(P.buildFrame(state)); await sleep(420); state.soundSet(0); transport.send(P.buildFrame(state)); } catch (e) {}
    }
  }
  async function previewBoth() {   // ③ 화면에서 고른 현재 두 음을 이어 재생
    const n1 = +($('note1') && $('note1').value) || note1;
    const n2 = +($('note2') && $('note2').value) || note2;
    await previewNote(n1); await sleep(120); await previewNote(n2);
  }
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
    if (typeof s.cds === 'number') s.cds = Math.max(30, s.cds); // 조도 최소 30 보장(0 표시로 인한 혼란 방지)
    Object.assign(sensor, s);  // 센서 자체는 매 프레임 갱신(주행 판단용)
    lastRxAt = Date.now();     // 수신이 살아 있음을 표시(멎으면 주행을 세운다)
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
  // 조도값이 30 밑으로는 안 내려가게 보정되므로(onSensor), 기준이 40 밑이면 영영 안 걸린다.
  const LIGHT_MIN_USABLE = 40;
  function expectedLight() { return Math.round((brightVal + darkVal) / lightDiv); }
  function updateCalc() {
    // 나누는 수의 배수로 맞춰 둔다 → 두 값의 합이 항상 딱 떨어져 소수점이 안 생김(초등 배려)
    brightVal = snapDiv(rawBright); darkVal = snapDiv(rawDark);
    $('brightVal').textContent = brightVal; $('darkVal').textContent = darkVal;
    $('calcA').textContent = brightVal; $('calcB').textContent = darkVal;
    if ($('calcD')) $('calcD').textContent = lightDiv;
    // ⚠ ÷4 는 '평균'이 아니다. (620+88)÷4 = 177 은 두 값의 평균(354)이 아니라
    //   '평균보다 더 어둡게 잡은 기준'이다. 학생이 평균을 잘못 배우지 않도록 이름을 바꾼다.
    if ($('calcName')) $('calcName').textContent = (lightDiv === 2) ? '사이값(평균)' : '터널 기준';
    const w = $('divWarn');
    if (w) {
      const exp = expectedLight();
      // 기준이 '터널 안에서 잰 값'보다도 낮으면 터널을 영영 못 찾는다.
      const bad = (exp <= darkVal + 10) || (exp < LIGHT_MIN_USABLE);
      w.classList.toggle('hidden', !bad);
      if (bad) w.textContent = `⚠ 이 설정(÷${lightDiv})이면 기준 ${exp} 이 터널 안 조도 ${darkVal} 보다 낮거나 비슷해요 — 터널을 못 찾습니다. ÷2 로 바꾸거나 조도를 다시 재세요.`;
    }
  }
  const snapDiv = (v) => Math.round(v / lightDiv) * lightDiv;
  function setLightDiv(d) {          // 2 ↔ 4 전환: 표시값·정답·입력칸을 함께 초기화
    lightDiv = (d === 4) ? 4 : 2;
    document.querySelectorAll('.divbtn').forEach(b => b.classList.toggle('on', +b.dataset.div === lightDiv));
    updateCalc();
    if ($('lightInput')) $('lightInput').value = '';
    if ($('lightFb')) $('lightFb').textContent = '';
    if ($('toStep2')) $('toStep2').classList.add('hidden');
  }
  function capBright() { if (sensor.cds < 999) { rawBright = sensor.cds; updateCalc(); toast('밝은 곳 조도 = ' + brightVal); } else toast('연결 후 측정돼요(데모: 기본값)'); }
  function capDark() { if (sensor.cds < 999) { rawDark = sensor.cds; updateCalc(); toast('터널 안 조도 = ' + darkVal); } else toast('연결 후 측정돼요(데모: 기본값)'); }
  function checkLight() {
    const v = parseInt($('lightInput').value, 10);
    const exp = expectedLight();
    const fb = $('lightFb');
    if (isNaN(v)) { fb.textContent = '숫자를 넣어요.'; fb.style.color = 'var(--coral)'; return; }
    if (Math.abs(v - exp) <= 1) { // 계산값 ±1 허용 — 좌절 방지
      lightThresh = v; fb.textContent = `정답! 터널 기준 = ${v} 🔆 — ✏️ 활동지에 쓰세요`; fb.style.color = 'var(--mint)';
      $('toStep2').classList.remove('hidden'); toast('🔆 터널 기준 완성!');
    } else { fb.textContent = `다시 계산해 봐요. (두 값을 더해 ${lightDiv}(으)로 나누기)`; fb.style.color = 'var(--coral)'; $('toStep2').classList.add('hidden'); }
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

  // ④ 배송지 — 배송 계산 문제를 풀어야 문자 획득
  let curZoneP = null, zoneSolved = false;
  function setupZone() {
    if (!zone) zone = ZONES[Math.floor(Math.random() * ZONES.length)];
    if (!curZoneP) curZoneP = zone.probs[Math.floor(Math.random() * zone.probs.length)];
    try { window.__f1Zone = { box: zone.box, code: zone.code }; } catch (e) {} // 테스트/검산용
    $('zoneProb').textContent = curZoneP.q;
    // 참고표: 상자 수 | 배송 구역 | 문자 (풀기 전엔 힌트 강조 없음)
    const t = $('zoneTable'); t.querySelectorAll('.zrow').forEach(r => r.remove());
    const rows = ZONES.slice().sort((a, b) => a.box - b.box);
    rows.forEach(z => { const tr = document.createElement('tr'); tr.className = 'zrow' + (zoneSolved && z.code === zone.code ? ' hit' : ''); tr.dataset.code = z.code; tr.innerHTML = `<td>${z.box}개</td><td>${z.name}</td><td>${z.code}</td>`; t.appendChild(tr); });
    if (zoneSolved) revealZone(); else { $('letterReveal').classList.add('hidden'); $('toStep5').classList.add('hidden'); $('destName').textContent = '계산해서 찾기!'; }
  }
  function revealZone() {
    zoneSolved = true;
    $('destName').textContent = zone.name;
    $('letterVal').textContent = zone.code;
    $('letterReveal').classList.remove('hidden');
    $('toStep5').classList.remove('hidden');
    const t = $('zoneTable'); t.querySelectorAll('.zrow').forEach(r => r.classList.toggle('hit', r.dataset.code === zone.code));
  }
  function checkZone() {
    const v = parseInt($('zoneAns').value, 10);
    const fb = $('zoneFb');
    if (isNaN(v)) { fb.textContent = '숫자를 넣어요.'; fb.style.color = 'var(--coral)'; return; }
    if (v === zone.box) {
      fb.textContent = `정답! 상자 ${zone.box}개 → 배송지 문자 ${zone.code} 획득! 📦`; fb.style.color = 'var(--mint)';
      revealZone(); toast(`📦 배송지 문자 [${zone.code}] 획득!`);
    } else { fb.textContent = '다시 계산해 봐요. (상자 수를 세어 표에서 찾기)'; fb.style.color = 'var(--coral)'; }
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
  // 정면 회피 방향 래치(+1=우 / -1=좌). 한 번 정하면 정면이 뚫릴 때까지 유지 → 좌우 뒤집힘(와리가리) 방지.
  let escaping = false, escDir = 1, escStartAt = 0, escBestFront = 0;
  const DIAG_DIFF = 25;   // 앞 대각 좌우 차이가 이만큼이면 '어느 쪽이 열렸는지' 확실하다고 본다
  function pickEscapeDir(ir1, ir3, ir4, ir5) {
    // ⚠ 예전엔 앞 대각과 측면을 min() 으로 섞었다. 그런데 벽을 따라 달리는 중에는
    //   그쪽 측면값이 원래 작다(벽이 옆에 있으니). 그래서 오른쪽 벽을 따라가다
    //   코너에 닿으면 '오른쪽이 막혔다'고 잘못 읽고 왼쪽(=막힌 쪽)으로 틀었다.
    //   해설사들이 보내 준 실제 끼임 값(앞 94/102/157, 옆 89·455)이 정확히 이 경우로,
    //   앞은 오른쪽(157)이 확실히 열려 있는데 옆값 89 때문에 왼쪽을 골랐다.
    // → 1순위는 '앞이 어디로 열려 있나'(ir1 좌 / ir3 우). 측면은 앞이 비슷할 때만.
    if (Math.abs(ir3 - ir1) >= DIAG_DIFF) return ir3 > ir1 ? 1 : -1;
    const r = ir4 < SIDE_VALID ? ir4 : 99999;
    const l = ir5 < SIDE_VALID ? ir5 : 99999;
    if (r !== l) return r > l ? 1 : -1;
    return 1;
  }
  // 이 주행이 아직 유효한가(정지를 눌렀거나 새 주행이 시작되지 않았는가)
  function alive(gen) { return running && gen === runGen; }
  // 대기 중에 정지가 눌리면 그 자리에서 모터를 끈다 — await 뒤에 이어지는
  // setDrive 가 '이미 멈춘 차'에 다시 전진을 지시하던 문제를 막는다.
  async function hold(ms, gen) {
    await sleep(ms);
    if (!alive(gen)) { setDrive(0, 0); return false; }
    return true;
  }

  async function wallFollowStep(gen) {
    if (!alive(gen)) { setDrive(0, 0); return; }
    // 센서가 멎었는데 계속 달리면, 앞의 벽을 못 보고 마지막 값만 믿고 돌진한다.
    if (lastRxAt && Date.now() - lastRxAt > 1200) {
      setDrive(0, 0); hudAct('⚠ 센서 신호 끊김 — 정지');
      return;
    }
    const { ir1, ir2, ir3, ir4, ir5 } = sensor;
    const FULL = 127;
    // 전면 3개(좌·중·우) 중 '가장 가까운' 것으로 판단 → 코너에서 앞 대각만 껴도 회피·후진(끼임 방지)
    const frontMin = Math.min(ir1, ir2, ir3);
    const near = Math.max(45, Math.round(TOF2 * 0.55));  // '코앞' = 반응거리의 약 55%(슬라이더 따라 자동 조정)
    const clear = TOF2 + 40;                             // 이만큼 뚫려야 회피 종료(히스테리시스)
    const DIAG_JAM = 70;                                 // 앞 대각(좌/우)이 이보다 가까우면 코너에 낀 것(벽따라가기는 오작동 방지)
    // ① 정면 벽/코너 — 한 번 정한 방향으로 '끝까지' 회피(중간에 좌우 안 뒤집음)
    if (ir2 < TOF2 || Math.min(ir1, ir3) < DIAG_JAM || (escaping && ir2 < clear)) {
      if (!escaping) { escaping = true; escDir = pickEscapeDir(ir1, ir3, ir4, ir5); escStartAt = Date.now(); escBestFront = frontMin; }
      // 앞이 뚫리는 중이면 '진전 있음' → 끼임 타이머를 다시 센다
      if (frontMin > escBestFront + ESC_GAIN) { escBestFront = frontMin; escStartAt = Date.now(); }
      // 옆벽에 붙어 비스듬히 낀 경우 앞거리가 더 안 줄어 후진 조건에 안 걸린다 → 시간으로 판정
      const stalled = Date.now() - escStartAt > ESC_STALL_MS;
      if (frontMin < near || stalled) {   // 코앞/코너에 낌 → K턴: 열린쪽 '반대로' 후진 → 열린쪽으로 전진
        setDrive(WF_BACK, -escDir * FULL); hudAct(stalled ? '⤿ 끼임! 후진 탈출' : (escDir > 0 ? '⤿ 후진(오른쪽 탈출)' : '⤾ 후진(왼쪽 탈출)'));
        if (!await hold(HOLD_MS, gen)) return;
        setDrive(DRIVE,     escDir * FULL); hudAct(escDir > 0 ? '↱ 전진(오른쪽)'   : '↰ 전진(왼쪽)');
        if (!await hold(HOLD_MS, gen)) return;
        escStartAt = Date.now(); escBestFront = frontMin;   // 탈출 시도했으니 다시 관찰
      } else {                            // 접근 중 → 열린쪽으로 강하게 틀며 전진(후진 없이)
        setDrive(Math.round(DRIVE * 0.7), escDir * TURN); hudAct(escDir > 0 ? '↱ 정면벽 우회피' : '↰ 정면벽 좌회피');
        if (!await hold(HOLD_MS, gen)) return;
      }
      return;
    }
    escaping = false;                     // 정면 뚫림 → 회피 종료
    // ② 안티-스크레이프: 한쪽 벽에 '바짝'(초근접) → 벽 긁기 직전이므로 반대로 강하게(센서 정상 전제)
    const HARD = 75, HARDST = 90;
    if (ir4 < HARD && ir4 <= ir5) { setDrive(DRIVE, -HARDST); hudAct('◀ 우벽 바짝! 좌로'); await hold(HOLD_MS, gen); return; }
    if (ir5 < HARD && ir5 <  ir4) { setDrive(DRIVE,  HARDST); hudAct('▶ 좌벽 바짝! 우로'); await hold(HOLD_MS, gen); return; }
    // ③ 복도 가운데 유지 — 측면(ir4우/ir5좌) 정밀. 한쪽만 보이면 목표거리 유지, 둘 다 안 보이면 전면 대각.
    let st = 0, why = '⬆ 직진';
    const Rok = ir4 < SIDE_VALID, Lok = ir5 < SIDE_VALID;
    if (SIDE_ON && Rok && Lok)      st = SIDE_KP * (ir4 - ir5);           // 양벽: 우가 가까우면(ir4작음) 좌로
    else if (SIDE_ON && Rok)        st = SIDE_KP * (ir4 - SIDE_TARGET);   // 우벽만: 가까우면 좌로
    else if (SIDE_ON && Lok)        st = -SIDE_KP * (ir5 - SIDE_TARGET);  // 좌벽만: 가까우면 우로
    if (st !== 0) {
      st = Math.max(-SIDE_SMAX, Math.min(SIDE_SMAX, Math.round(st)));
      why = st > 0 ? '↗ 가운데보정 우' : '↖ 가운데보정 좌';
    } else if (ir1 < TOF1 || ir3 < TOF3) {                     // 측면 안 보임 → 전면 대각(ir1좌·ir3우) 폴백
      const L = ir1 < TOF1 ? ir1 : TOF1, R = ir3 < TOF3 ? ir3 : TOF3;
      st = Math.round(STEER * (R - L) / Math.max(TOF1, TOF3)); // 좌가 가까우면(L작음) 우로(+)
      if (st === 0 && ir1 < TOF1) st = STEER;
      if (st === 0 && ir3 < TOF3) st = -STEER;
      st = Math.max(-STEER, Math.min(STEER, st));
      why = st > 0 ? '↳ 좌벽→우로' : st < 0 ? '↲ 우벽→좌로' : '⬆ 직진';
    }
    setDrive(DRIVE, st); hudAct(why); await hold(st === 0 ? STREAM_MS : HOLD_MS, gen);
  }
  // 반환값: true=조건 달성. false=중단(정지 누름)이거나 시간초과.
  // ⚠ 예전엔 `!running || cond()` 라 '정지를 눌러 중단된 것'을 성공으로 보고했다.
  //   그러면 정지를 눌렀는데도 다음 단계가 이어져 backBump() 가 −350으로 후진했다.
  //   (정지 직후 차가 뒤로 한 번 튀던 증상) 호출자는 running 을 따로 확인한다.
  async function driveUntil(cond, gen) {
    const t0 = Date.now();
    while (alive(gen) && !cond() && Date.now() - t0 < PHASE_TIMEOUT) { await wallFollowStep(gen); }
    setDrive(0, 0);
    return alive(gen) && cond();
  }
  async function backBump(gen) {
    if (!alive(gen)) return;
    setDrive(BUMP_SPEED, 0);
    if (!await hold(BUMP_MS, gen)) return;
    setDrive(0, 0); state.steer(0);
    await hold(200, gen);
  }
  // 배송 문자 표시 — 방향 보정(js/dotmatrix.js)을 거쳐 찍는다.
  // FONT는 '바이트=행(위→아래), 비트7=맨왼쪽열'로 설계돼 있어 drawBytes가 그대로 해석한다.
  function showLetter(code) { window.AltinoDot.drawBytes(state, FONT[code] || FONT.D); }
  async function soundMission(gen) {  // 차량 부저: 계이름1·계이름2 × 반복N, 0.5초 간격
    // finally 로 반드시 꺼 준다 — 중간에 정지하거나 예외가 나면 부저가 계속 울었다.
    try {
      for (let i = 0; i < repeatN && alive(gen); i++) {
        state.soundSet(note1); await sleep(500);
        if (!alive(gen)) return;
        state.soundSet(note2); await sleep(500);
      }
    } finally { state.soundSet(0); }
  }

  async function runDelivery() {   // 원본 '실행1' 시퀀스 재현
    if (running) return;
    running = true; escaping = false; setRunUI(true); state.dotClear();
    const gen = ++runGen;
    // ⚠ 어떤 경로로 끝나도(정지·시간초과·예외) 모터와 부저는 반드시 끈다.
    try {
      // 원본 도입부: 정지 1초 → GO 표시 1초 → 출발
      setDrive(0, 0); await sleep(1000);
      if (!alive(gen)) return;
      const goEl = $('goFlash');
      if (goEl) { goEl.classList.remove('hidden'); await sleep(1000); goEl.classList.add('hidden'); }
      if (!alive(gen)) return;
      toast('배송 시작! 🚚');

      // 터널1까지 벽추종 → 미션1(소리)
      if (!await driveUntil(() => sensor.cds < lightThresh, gen)) {
        if (alive(gen)) toast('⏱ 터널을 못 찾아 멈췄어요 — 차를 코스에 다시 놓고 다시 출발!');
        return;
      }
      await backBump(gen);
      if (!alive(gen)) return;
      toast('🕳️ 터널! 소리 미션 🎵');
      await soundMission(gen);
      if (!alive(gen)) return;

      // 도착 판정까지 벽추종 → 미션2(배송지 문자)
      // ■ 코스 구조(현장 확인): n자 코스이고 터널은 '끝에 하나'뿐. 재진입은 없다.
      //   그래서 이 활동에서 어두워지는 사건은 딱 한 번이고, 두 미션이 그 한 터널 안에서
      //   연달아 일어난다 — 입구에서 미션1(소리), 2초 뒤 같은 터널 안에서 미션2(도착).
      //   '2초 경과' 는 미션1과 미션2가 같은 순간에 겹쳐 터지지 않게 띄워 두는 간격이다.
      // ⚠ 여기를 '한 번 밝아진 뒤 다시 어두워질 것'으로 바꾸면 안 된다.
      //   터널이 끝이라 그 뒤로 다시 어두워질 일이 없어 25초를 헤매다 실패한다.
      //   (실제로 그렇게 고쳤다가 되돌린 자리다 — 터널을 두 번 지난다고 잘못 알았다)
      const t0 = Date.now();
      if (!await driveUntil(() => sensor.cds < lightThresh && Date.now() - t0 > 2000, gen)) {
        if (alive(gen)) toast('⏱ 도착 지점을 못 찾아 멈췄어요 — 차를 코스에 다시 놓고 다시 출발!');
        return;
      }
      await backBump(gen);
      if (alive(gen) && zone) {
        showLetter(zone.code);
        $('arriveLetter').textContent = zone.code; $('arriveName').textContent = zone.name;
        $('arrive').classList.remove('hidden');
        toast(`📦 배송 완료! [${zone.code}]`);
        await sleep(3000);
        $('arrive').classList.add('hidden');
      }
    } finally {
      // 내가 아직 현재 주행일 때만 정리한다(정지 후 새 주행이 시작됐다면 건드리지 않음)
      if (gen === runGen) {
        setDrive(0, 0); state.dotClear(); state.soundSet(0);
        running = false; setRunUI(false);
      }
    }
  }
  // 계속 주행(튜닝/시연): 미션·정지 없이 벽만 따라 무한 주행 → 정지 누를 때까지
  async function runLoop() {
    if (running) return;
    running = true; escaping = false; setRunUI(true);
    const gen = ++runGen;
    toast('🔁 계속 주행 — 코스를 계속 돌아요 (정지로 멈춤)');
    try {
      setDrive(0, 0); await sleep(400);
      while (alive(gen)) { await wallFollowStep(gen); }
    } finally {
      if (gen === runGen) { setDrive(0, 0); state.soundSet(0); running = false; setRunUI(false); }
    }
  }
  function stopRun() { running = false; runGen++; setDrive(0, 0); state.dotClear(); state.soundSet(0); $('arrive').classList.add('hidden'); const g = $('goFlash'); if (g) g.classList.add('hidden'); setRunUI(false); }
  function setRunUI(on) { $('goRun').classList.toggle('hidden', on); const l = $('loopRun'); if (l) l.classList.toggle('hidden', on); $('stopRun').classList.toggle('hidden', !on); }

  // ---- 연결 ----
  function connErr(s) {
    const m = { 'error:no-bound': '로봇을 먼저 선택', 'error:bad-address': '잘못된 주소', 'error:give-up': '연결 실패 — 다시 선택', 'error:no-uart-char': 'UART 특성 없음', 'error:notify-failed': '알림 설정 실패', 'error:busy': '연결 중(스캔 불가)', 'error:no-bluetooth': '블루투스 없음', 'error:bluetooth-off': '블루투스를 켜세요', 'error:location-off': '태블릿 위치(Location)를 켜주세요 — 스캔에 필요', 'error:scan-failed': '스캔 실패' };
    return m[s] || s.replace('error:', '');
  }
  function wireNative(t) {   // 상태/데이터 핸들러 (상태는 'base:detail' 형식 → base로 판별)
    t.on('status', s => {
      const b = String(s).split(':')[0];
      if (b === 'connected') setStatus('🔗 연결됨 ✓', 'ok');
      else if (b === 'reconnecting') setStatus('🔗 재연결 중…', 'pending');
      else if (b === 'disconnected') setStatus('🔗 연결 끊김', 'off');
      else setStatus('⚠ ' + connErr(s), 'err');
    });
    t.on('data', bytes => { for (const f of assembler.push(bytes)) onSensor(f); });
  }
  async function connect(kind, addr) {
    await disconnect();
    try {
      if (kind === 'native') { transport = new T.AndroidBridgeTransport(); wireNative(transport); setStatus('🔗 연결 중…', 'pending'); if (addr) await transport.connectTo(addr); else await transport.connect(); }
      else { transport = new T.MockTransport(); transport.on('data', bytes => { for (const f of assembler.push(bytes)) onSensor(f); }); await transport.connect({}); setStatus('🔗 연결됨 ✓ (데모)', 'ok'); }
    } catch (e) { setStatus('⚠ 연결 실패', 'err'); transport = null; }
  }
  function adoptNative() { transport = new T.AndroidBridgeTransport(); wireNative(transport); transport.adopt(); } // 살아있는 네이티브 링크 이어받기
  function nativeStart() {   // 페이지 진입: 연결됨→입양 / 바인딩됨→그 로봇만 / 없음→스캔 선택
    const st = new T.AndroidBridgeTransport().state();
    if (st.connected) adoptNative();
    else if (st.address) connect('native', st.address);
    else pickAndConnect();
  }
  async function disconnect() { stopRun(); stopScanning(); if (transport) { try { await transport.disconnect(); } catch (e) {} } transport = null; }

  // ---- BLE 무페어링 스캔 피커 (동적 오버레이) ----
  let scanner = null, scanDevs = [];
  // 블루투스/위치 권한을 방금 허용했다면 스캔을 다시 건다.
  // (첫 실행: 권한 없이 스캔 → 0건 → 허용 → 아무도 다시 안 걸어 목록이 계속 비어 있었다)
  window.__altinoOnPermission = function (granted) {
    if (!granted) { toast('블루투스 권한이 없으면 로봇을 찾을 수 없어요'); return; }
    try { if (scanner) scanner.startScan(); } catch (e) {}
  };
  function stopScanning() { if (scanner) { try { scanner.stopScan(); } catch (e) {} try { scanner.detach(); } catch (e) {} scanner = null; } }
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
        <p class="lead" style="margin:0 0 8px">차 바닥 스티커의 <b>Bluetooth No.</b>(예: <b>BF16</b>)를 찾아 탭하세요. 한 번 고르면 <b>그 차에만</b> 연결/재연결돼요(다른 차에 안 붙음).</p>
        <input id="scanSearch" type="text" placeholder="번호로 검색 (예: BF16)" style="width:100%;margin-bottom:8px">
        <div id="scanList"><p class="lead">🔍 주변 알티노를 찾는 중… 차 전원을 켜주세요.</p></div>
        <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap"><button id="scanSettings" class="btn ghost">📶 블루투스 설정</button><button id="scanUnbind" class="btn ghost">🔓 이 태블릿 짝 해제</button></div></div>`;
      document.body.appendChild(ov);
      ov.querySelector('#scanClose').onclick = () => { stopScanning(); ov.classList.add('hidden'); };
      ov.querySelector('#scanSettings').onclick = () => { try { new T.AndroidBridgeTransport().openSettings(); } catch (e) {} };
      ov.querySelector('#scanUnbind').onclick = async () => {
        if (!await AltinoUI.confirm({ title: '이 태블릿의 짝을 해제할까요?',
          lines: ['지금 연결된 로봇과의 짝이 풀리고 연결이 끊겨요.', '다른 로봇을 새로 골라야 해요.'],
          okText: '네, 짝 해제' })) return;
        try { new T.AndroidBridgeTransport().unbind(); } catch (e) {} toast('짝 해제됨 — 새 로봇을 고르세요'); renderScan(); };
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
    const boundSt = new T.AndroidBridgeTransport().state();
    const bound = boundSt.address || '';
    list.innerHTML = '';
    devs.forEach((d, i) => {
      const b = document.createElement('button'); b.className = 'btn ghost'; b.style.cssText = 'display:block;width:100%;text-align:left;margin-bottom:8px';
      const code = stickerCode(d.name, d.address);
      const near = i === 0 && d.rssi ? ' <span style="color:var(--mint);font-size:.8rem">· 가장 가까움</span>' : '';
      const locked = bound && d.address !== bound;   // 이미 짝이 있는데 다른 로봇 → 잠금
      const isBound = d.address === bound ? ' <span style="color:var(--sun);font-size:.8rem">· 내 짝 ✓</span>' : (locked ? ' <span style="color:var(--mut);font-size:.8rem">· 🔒 짝 해제 필요</span>' : '');
      b.innerHTML = `🚗 <b style="font-size:1.5rem;color:var(--blue)">⟨${code}⟩</b>${near}${isBound}<br><span style="font-size:.75rem;color:var(--mut)">${d.name || ''} · ${d.address}</span>`;
      if (locked) b.style.opacity = '.5';
      b.onclick = () => {
        if (bound && d.address !== bound) {   // 짝 잠금: 다른 로봇에 실수로 안 붙게
          toast('이 태블릿은 ⟨' + stickerCode(boundSt.name, bound) + '⟩과 짝이에요 — 바꾸려면 아래 [🔓 짝 해제]를 먼저 누르세요');
          return;
        }
        stopScanning(); $('scanOverlay').classList.add('hidden'); connect('native', d.address);
      };
      list.appendChild(b);
    });
  }
  function mac4(addr) { const h = String(addr || '').replace(/:/g, ''); return h.slice(-4).toUpperCase(); }
  // 로봇 몸체 'Bluetooth No.'(예: BF16)는 BLE 이름에 들어있음(ALTINO-NBF16). 모델 접두를 떼서 그 번호를 뽑음.
  function stickerCode(name, addr) {
    const up = String(name || '').toUpperCase().trim();
    const PRE = ['ALTINO-NEO-', 'ALTINO-NEO', 'ALTINO-LITE-', 'ALTINO-LITE', 'ALTINO-N', 'ALTINO-L', 'ALTINO-', 'ALTINO', 'SMARTFARM-', 'SMARTFARM', 'REALFARM-', 'REALFARM'];
    let c = up;
    for (const p of PRE) if (up.startsWith(p)) { c = up.slice(p.length); break; }
    c = c.replace(/^[\-\s_]+/, '');
    return /^[A-Z0-9]{2,8}$/.test(c) ? c : mac4(addr);  // 못 뽑으면 MAC 뒤 4자리로 폴백
  }

  // ---- 🔬 센서 점검 오버레이 (측면센서 작동 확인용) ----
  // 각 센서 앞에 손을 대보며 숫자가 변하는지 확인 → '반응함' 뱃지. 측면(ir4/ir5)이 안 변하면 그 로봇은 측면센서 문제.
  let sensorTestTimer = null;
  const ST_ROWS = [
    { k: 'ir1', name: '전면 좌', side: false }, { k: 'ir2', name: '전면 중앙', side: false }, { k: 'ir3', name: '전면 우', side: false },
    { k: 'ir4', name: '우측면 ▶', side: true }, { k: 'ir5', name: '◀ 좌측면', side: true },
    { k: 'ir6', name: '후면', side: false }, { k: 'cds', name: '조도(빛)', side: false },
  ];
  const stSeen = {};
  function openSensorTest() {
    ST_ROWS.forEach(r => stSeen[r.k] = { min: Infinity, max: -Infinity });
    let ov = $('stOverlay');
    if (!ov) {
      ov = document.createElement('div'); ov.id = 'stOverlay';
      ov.style.cssText = 'position:fixed;inset:0;background:rgba(20,20,30,.6);display:flex;align-items:center;justify-content:center;z-index:45';
      ov.innerHTML = `<div style="background:#fff;border-radius:20px;padding:18px 22px;width:min(640px,94vw);max-height:90vh;overflow:auto;box-shadow:var(--shadow)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <h2 style="margin:0">🔬 센서 점검</h2><button id="stClose" class="btn ghost" style="padding:6px 12px">닫기</button></div>
        <p class="lead" style="margin:0 0 10px">각 센서 앞에 <b>손을 가까이 대보세요</b>. 숫자가 변하면 <b>반응함 ✅</b>. <b>측면(우측면/좌측면)</b>이 안 변하면 그 로봇은 측면센서가 없거나 고장이에요 — 그땐 [측면 정밀주행]을 꺼도 전면 대각으로 달립니다. (값: 작을수록 가까움, 벽 없음≈1300)</p>
        <div id="stList"></div></div>`;
      document.body.appendChild(ov);
      ov.querySelector('#stClose').onclick = closeSensorTest;
    }
    const list = ov.querySelector('#stList');
    list.innerHTML = ST_ROWS.map(r => `<div style="display:flex;align-items:center;gap:12px;padding:10px 12px;margin-bottom:6px;border:2px solid ${r.side ? '#ffd08a' : 'var(--line)'};border-radius:14px;background:${r.side ? '#fff8ec' : '#fafafa'}">
        <b style="flex:1;font-size:1.15rem">${r.name}</b>
        <span id="st-${r.k}" style="font-size:1.9rem;font-weight:800;min-width:5ch;text-align:right;font-variant-numeric:tabular-nums">–</span>
        <span id="stb-${r.k}" class="status" style="min-width:9ch;text-align:center">—</span></div>`).join('');
    ov.classList.remove('hidden');
    if (sensorTestTimer) clearInterval(sensorTestTimer);
    sensorTestTimer = setInterval(() => {
      ST_ROWS.forEach(r => {
        const v = sensor[r.k]; if (v == null || v >= 999) return;
        const s = stSeen[r.k]; if (v < s.min) s.min = v; if (v > s.max) s.max = v;
        const el = $('st-' + r.k); if (el) el.textContent = v;
        const b = $('stb-' + r.k); if (b) {
          const react = (s.max - s.min) > 15;
          b.textContent = react ? '반응함 ✅' : '손을 대보세요';
          b.className = 'status ' + (react ? 'ok' : '');
        }
      });
    }, 150);
  }
  function closeSensorTest() { if (sensorTestTimer) { clearInterval(sensorTestTimer); sensorTestTimer = null; } const ov = $('stOverlay'); if (ov) ov.classList.add('hidden'); }

  function noteOptions(sel, def) { Object.keys(NOTE_NAME).forEach(code => { const o = document.createElement('option'); o.value = code; o.textContent = NOTE_NAME[code]; if (+code === def) o.selected = true; sel.appendChild(o); }); }

  function init() {
    updateCalc();
    // ① 센서-수학
    $('capBright').onclick = capBright; $('capDark').onclick = capDark;
    $('lightOk').onclick = checkLight; $('lightInput').addEventListener('keydown', e => { if (e.key === 'Enter') checkLight(); });
    // 스텝 이동
    $('toStep2').onclick = () => go(2);
    $('toStep3').onclick = () => go(3);
    $('toStep4').onclick = () => { note1 = +$('note1').value; note2 = +$('note2').value; repeatN = Math.min(10, Math.max(1, +$('repeatN').value || 1)); $('repeatN').value = repeatN; go(4); };
    $('toStep5').onclick = () => go(5);
    $('toStep6').onclick = () => go(6);
    document.querySelectorAll('[data-back]').forEach(b => b.onclick = () => go(+b.dataset.back));
    // ④ 배송지 문제 확인
    if ($('zoneOk')) $('zoneOk').onclick = checkZone;
    if ($('zoneAns')) $('zoneAns').addEventListener('keydown', e => { if (e.key === 'Enter') checkZone(); });
    // ② 암호
    document.querySelectorAll('.gradebtn').forEach(b => b.onclick = () => pickGrade(b.dataset.g));
    $('ansOk').onclick = checkAns; $('ansInput').addEventListener('keydown', e => { if (e.key === 'Enter') checkAns(); });
    // ③ 소리 선택 + 미리듣기
    noteOptions($('note1'), 37); noteOptions($('note2'), 41);
    if ($('prev1')) $('prev1').onclick = () => previewNote(+$('note1').value);
    if ($('prev2')) $('prev2').onclick = () => previewNote(+$('note2').value);
    if ($('prevBoth')) $('prevBoth').onclick = previewBoth;
    if ($('repeatN')) $('repeatN').addEventListener('input', () => { const el = $('repeatN'); if (+el.value > 10) el.value = 10; });
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
        o.lightDiv = lightDiv;
        localStorage.setItem('altinoCalV1', JSON.stringify(o));
      } catch (e) {}
    }
    function restoreCal() {
      try {
        const o = JSON.parse(localStorage.getItem('altinoCalV1') || 'null'); if (!o) return;
        CAL_IDS.forEach(id => { const el = $(id); if (el && o[id] != null) { el.value = o[id]; el.dispatchEvent(new Event('input')); } });
        const sc = $('sideOn'); if (sc && o.sideOn != null) { sc.checked = o.sideOn; SIDE_ON = o.sideOn; }
        if (o.lightDiv != null) setLightDiv(+o.lightDiv);
      } catch (e) {}
    }
    CAL_IDS.forEach(id => { const el = $(id); if (el) el.addEventListener('input', saveCal); });
    if (sideChk) sideChk.addEventListener('change', saveCal);
    // ① 나누는 수(2/4) — 태블릿에 저장돼 다음 학생에게도 유지
    document.querySelectorAll('.divbtn').forEach(b => b.addEventListener('click', () => {
      setLightDiv(+b.dataset.div); saveCal(); toast(`나누는 수 ÷${lightDiv}`);
    }));
    restoreCal();
    // 센서 점검
    if ($('sensorTest')) $('sensorTest').onclick = openSensorTest;
    // 🔧 관리자 뒷문: 스텝바 끝 빈칸을 1.5초 안에 5번 빠르게 터치 → 바로 ⑥ 주행 테스트로
    const gate = $('adminGate');
    if (gate) {
      let taps = [];
      const hit = (e) => { e.preventDefault(); const now = Date.now(); taps = taps.filter(t => now - t < 1500); taps.push(now);
        if (taps.length >= 5) { taps = []; go(6); toast('🔧 관리자: 주행 테스트'); } };
      gate.addEventListener('click', hit); gate.addEventListener('touchstart', hit, { passive: false });
    }
    // 연결
    $('connBtn').onclick = () => { if (T.AndroidBridgeTransport.supported) pickAndConnect(); else connect('mock'); };
    $('btSettings').onclick = () => { if (T.AndroidBridgeTransport.supported) new T.AndroidBridgeTransport().openSettings(); else toast('실기(APK)에서만 열려요'); };

    window.addEventListener('blur', stopRun);
    document.addEventListener('visibilitychange', () => { if (document.hidden) stopRun(); });

    startStream(); setRunUI(false); go(1);
    if (T.AndroidBridgeTransport.supported) nativeStart(); else setStatus('🔗 연결 안 됨 (데모 가능)', 'off');
  }
  document.addEventListener('DOMContentLoaded', init);
})();
