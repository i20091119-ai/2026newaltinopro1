// 알티노 로봇 학교 — 주제 앱 목록(레지스트리)
// ⚠ 통합 담당자만 고친다. 공동저자는 제출할 때 자기 항목의 '바뀐 값'만 알려 준다.
//   (15개 앱이 각자 홈 화면을 고치면 합칠 때마다 충돌난다 — 그래서 목록을 한 파일로 모았다)
// JSON 파일이 아니라 JS 인 이유: 태블릿 앱은 file:// 로 열리는데, 안드로이드 WebView 는
//   file:// 에서 fetch()/XHR 로 JSON 을 못 읽는다. <script> 로 싣는 건 된다.
// ready:false 인 앱은 로봇학교 화면에 '준비 중' 으로 흐리게 나온다.
window.ALTINO_APPS = [
  { id: 't01', title: '로봇학교 입학식',        lessons: '1–2',   band: '입학하기', ready: false },
  { id: 't02', title: '알티노 걸음마 가르치기',  lessons: '3–4',   band: '기초반',   ready: false },
  { id: 't03', title: '표정 만들기',            lessons: '5–6',   band: '기초반',   ready: false },
  { id: 't04', title: '노래 가르치기',          lessons: '7–8',   band: '기초반',   ready: false },
  { id: 't05', title: '비밀 신호 보내기',       lessons: '9–10',  band: '기초반',   ready: false },
  { id: 't06', title: '손길 알아채기',          lessons: '11–12', band: '기초반',   ready: false },
  { id: 't07', title: '수학 시험 보는 날',       lessons: '13–14', band: '교과반',   ready: false },
  { id: 't08', title: '알티노 골든벨',          lessons: '15–16', band: '교과반',   ready: false },
  { id: 't09', title: '어둠 알아채기',          lessons: '17–18', band: '교과반',   ready: false },
  { id: 't10', title: '스스로 멈추는 차의 비밀', lessons: '19–20', band: '교과반',   ready: false },
  { id: 't11', title: '순서대로 기억시키기',     lessons: '21–22', band: '교과반',   ready: false },
  { id: 't12', title: '운동회',                lessons: '23–24', band: '어울림반', ready: false },
  { id: 't13', title: '말 알아듣기',            lessons: '25–26', band: '어울림반', ready: false },
  { id: 't14', title: '보물 지도 탐험',         lessons: '27–28', band: '어울림반', ready: false },
  { id: 't15', title: '학예회·졸업식',          lessons: '29–32', band: '어울림반', ready: false },
];
