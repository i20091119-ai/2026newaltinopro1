// 제출물 검사기 — 공동저자는 제출 전에, 통합 담당자는 합치기 전에 돌린다.
//   node tools/check_contribution.mjs t07            ← 검사
//   node tools/check_contribution.mjs --snapshot     ← (통합 담당자만) 공용 파일 지문 다시 찍기
// 하는 일
//   1) 이 앱 파일이 다 있는가 (tNN.html · js/tNN.js · docs/topics/tNN.md)
//   2) 공용 파일을 건드리지 않았는가 (tools/shared-files.json 의 지문과 비교)
//   3) 규칙 위반이 없는가 (localStorage 직접 사용, confirm(), 프레임 직접 전송 등)
//   4) playwright 가 있으면 공통 안전 시험(tests/smoke.mjs)과 앱 시험(tests/tNN.mjs)까지
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SNAP = path.join(ROOT, 'tools', 'shared-files.json');

// 공용 파일 — 통합 담당자만 바꾼다
const SHARED_GLOBS = [
  'webapp/js/protocol.js', 'webapp/js/ui.js', 'webapp/js/dotmatrix.js', 'webapp/js/transport.js',
  'webapp/js/kit.js', 'webapp/js/problems.js', 'webapp/js/apps.js', 'webapp/school.html',
  'webapp/t00.html', 'webapp/js/t00.js',
  'tests/stub.js', 'tests/smoke.mjs', 'tests/pages.mjs', 'tests/t00.mjs', 'tests/mutation.mjs',
  'tools/check_contribution.mjs', 'tools/serve.mjs', 'tools/make_pdf.mjs', 'tools/make_worksheet_pptx.py', 'package.json',
  // 체험관 현장 앱(검증 끝난 코드) — 주제 앱 작업에서 건드리지 않는다
  'webapp/home.html', 'webapp/mode1.html', 'webapp/tag.html', 'webapp/park.html', 'webapp/index.html',
  'webapp/js/code.js', 'webapp/js/tag.js', 'webapp/js/park.js', 'webapp/js/update.js',
];
const SHARED_DIRS = ['android', '.github', 'webapp/fonts', 'webapp/sounds'];
const SOUND_OK = new Set([37, 39, 41, 42, 44, 46, 48, 49]);   // 실측된 8음

// 글 파일은 줄바꿈을 LF 로 맞춰서 지문을 낸다 — 윈도우 git(autocrlf)이 CRLF 로 바꿔 받아도 '바뀜'으로 잡지 않게
const TEXT_EXT = /\.(js|mjs|html|css|json|md|kt|kts|gradle|xml|yml|yaml|pro|properties|txt|gitignore)$/i;
const sha = (p) => {
  let b = fs.readFileSync(p);
  if (TEXT_EXT.test(p) || path.basename(p) === 'gradlew') b = Buffer.from(b.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');
  return crypto.createHash('sha256').update(b).digest('hex');
};
function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!['build', '.gradle', 'node_modules', 'assets'].includes(e.name) || !p.includes('android')) walk(p, out); }
    else out.push(p);
  }
  return out;
}
function sharedList() {
  const files = SHARED_GLOBS.map(f => path.join(ROOT, f)).filter(fs.existsSync);
  for (const d of SHARED_DIRS) files.push(...walk(path.join(ROOT, d)).filter(p => !/[\\/](build|\.gradle)[\\/]/.test(p) && !p.includes(path.join('src', 'main', 'assets'))));
  return files.map(p => path.relative(ROOT, p).split(path.sep).join('/')).sort();
}

if (process.argv[2] === '--snapshot') {
  const snap = {}; for (const f of sharedList()) snap[f] = sha(path.join(ROOT, f));
  fs.writeFileSync(SNAP, JSON.stringify({ made: new Date().toISOString().slice(0, 10), files: snap }, null, 1));
  console.log(`공용 파일 ${Object.keys(snap).length}개의 지문을 ${path.relative(ROOT, SNAP)} 에 저장했습니다.`);
  process.exit(0);
}

const app = process.argv[2];
if (!/^t(0[1-9]|1[0-5])$/.test(app || '')) { console.error('사용법: node tools/check_contribution.mjs t07   (t01~t15)'); process.exit(2); }

const errors = [], warns = [], infos = [];
const E = (m) => errors.push(m), W = (m) => warns.push(m), I = (m) => infos.push(m);
const rd = (rel) => { const p = path.join(ROOT, rel); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null; };

// 1) 필수 파일
const html = rd(`webapp/${app}.html`), js = rd(`webapp/js/${app}.js`), plan = rd(`docs/topics/${app}.md`);
if (!html) E(`webapp/${app}.html 이 없습니다 (t00.html 을 복사해 시작하세요)`);
if (!js) E(`webapp/js/${app}.js 가 없습니다`);
if (!plan) E(`docs/topics/${app}.md (앱 기획서)가 없습니다 — docs/dev-guide/11 양식`);
else {
  const blanks = (plan.match(/✎/g) || []).length;
  if (blanks) W(`기획서 docs/topics/${app}.md 에 아직 안 채운 칸(✎)이 ${blanks}개 있습니다`);
  if (!/상태:\s*\**확정/.test(plan)) W('기획서 상태가 아직 \'확정\'이 아닙니다 (다른 저자 검토 후 확정)');
}
if (!fs.existsSync(path.join(ROOT, `tests/${app}.mjs`))) W(`tests/${app}.mjs 가 없습니다 — 조종 패드가 있으면 tests/t00.mjs 를 복사해 꼭 만드세요`);

// 2) 공용 파일 지문
if (!fs.existsSync(SNAP)) W('tools/shared-files.json 이 없어 공용 파일 변경 여부를 못 봤습니다');
else {
  const snap = JSON.parse(fs.readFileSync(SNAP, 'utf8')).files;
  for (const [f, h] of Object.entries(snap)) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) E(`공용 파일이 지워졌습니다: ${f}`);
    else if (sha(p) !== h) E(`공용 파일이 바뀌었습니다: ${f}  → 되돌리고, 필요하면 '공용 파일 변경 요청'으로 (dev-guide/01)`);
  }
}

// 3) 규칙
const code = (js || '').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');   // 주석 제외
if (js) {
  const m = code.match(/AltinoKit\.create\(\s*\{[\s\S]*?appId\s*:\s*['"](t\d{2})['"]/);
  if (!m) E(`${app}.js 에서 AltinoKit.create({ appId: '${app}' }) 를 찾지 못했습니다`);
  else if (m[1] !== app) E(`appId 가 '${m[1]}' 입니다 — 파일 번호와 같은 '${app}' 이어야 합니다`);
  const RULES = [
    [/\blocalStorage\b/, 'localStorage 직접 사용 금지 → kit.store / kit.team / kit.record'],
    [/(^|[^.\w])(confirm|alert|prompt)\s*\(/m, '기본 confirm()/alert() 금지 — 태블릿에서 먹통 → kit.confirm / kit.toast'],
    [/\bbuildFrame\b|\bAltinoNative\b|AndroidBridgeTransport|new\s+AltinoTransport|\.connectTo\s*\(/, '프레임 직접 전송·연결 직접 제어 금지 → kit 이 한다'],
    [/__altinoKit/, 'window.__altinoKit 은 시험 도구 전용 — 앱에서 쓰지 마세요'],
    [/addEventListener\(\s*['"](touchstart|mousedown|pointerdown)['"]/, '누르는 동안 동작은 kit.hold 로 — 직접 붙이면 미끄러짐·창 차단이 빠집니다'],
  ];
  for (const [re, msg] of RULES) if (re.test(code)) E(msg);
  if (/\.soundSet\s*\(/.test(code)) W('state.soundSet 직접 사용 — 끄는 걸 잊기 쉬움. kit.beep(코드, ms) 권장');
  for (const mm of code.matchAll(/kit\.beep\(\s*(\d+)/g)) if (!SOUND_OK.has(+mm[1])) W(`소리 코드 ${mm[1]} 은 실측 안 된 값 — 37·39·41·42·44·46·48·49 만 (dev-guide/03)`);
  if (/while\s*\(\s*true\s*\)/.test(code)) W('while(true) — 자율 동작은 kit.run 안에서 while (r.alive()) 로');
  if (/await\s+new\s+Promise\([^)]*setTimeout/.test(code)) W('직접 만든 sleep — kit.run 의 r.sleep 을 쓰고 false 면 return');
}
if (html) {
  const order = ['js/protocol.js', 'js/ui.js', 'js/dotmatrix.js', 'js/transport.js', 'js/kit.js', `js/${app}.js`];
  const pos = order.map(s => html.indexOf(`src="${s}"`));
  if (pos.some(x => x < 0)) E(`${app}.html 의 <script> 가 빠졌습니다: ` + order.filter((s, i) => pos[i] < 0).join(', '));
  else if (pos.some((x, i) => i && x < pos[i - 1])) E(`${app}.html 의 <script> 순서가 다릅니다 → ` + order.join(' → '));
  if (!/id=["']kitBar["']/.test(html)) E(`${app}.html 에 상단 공통 칩 자리 <div id="kitBar"></div> 가 없습니다`);
  if (!/href=["']school\.html["']/.test(html)) W('로봇학교(school.html)로 돌아가는 링크가 없습니다');
  if (/overflow\s*:\s*(auto|scroll)/.test(html)) W('overflow:auto/scroll 이 있습니다 — 조종 패드가 그 안에 있으면 터치가 끊깁니다(S3)');
}

// 4) 바뀐 파일 목록(git 이 있으면) — 허용 범위 밖이면 경고
const allowed = (f) => f === `webapp/${app}.html` || f === `webapp/js/${app}.js` || f.startsWith(`webapp/assets/${app}/`) ||
  f.startsWith(`docs/topics/${app}`) || f === `tests/${app}.mjs`;
const g = spawnSync('git', ['-c', 'core.quotepath=false', 'status', '--porcelain', '-uall'], { cwd: ROOT, encoding: 'utf8' });
if (g.status === 0) {
  const changed = g.stdout.split('\n').filter(Boolean).map(l => l.slice(3).replace(/^"|"$/g, ''));
  const outside = changed.filter(f => !allowed(f));
  if (outside.length) W('이 앱 범위 밖의 파일이 바뀌어 있습니다(제출물에 넣지 마세요):\n      ' + outside.join('\n      '));
  else if (changed.length) I(`바뀐 파일 ${changed.length}개 — 모두 이 앱 범위 안`);
}

// 5) 시험 실행
let tested = false;
if (!errors.length) {
  for (const t of [['tests/smoke.mjs', app], [`tests/${app}.mjs`]]) {
    if (!fs.existsSync(path.join(ROOT, t[0]))) continue;
    const r = spawnSync(process.execPath, t, { cwd: ROOT, encoding: 'utf8', env: process.env });
    const last = (r.stdout || '').trim().split('\n').pop() || '';
    if (/playwright 가 없습니다/.test(r.stderr || '')) { W('playwright 가 없어 시험을 못 돌렸습니다: npm install && npx playwright install chromium'); break; }
    tested = true;
    if (r.status !== 0) E(`${t[0]} 실패 — ${last}\n` + (r.stdout || '').split('\n').filter(l => l.startsWith('✗')).map(l => '      ' + l).join('\n'));
    else I(`${t[0]} 통과 — ${last}`);
  }
}

console.log(`\n══ ${app} 제출물 검사 ══`);
for (const m of errors) console.log('❌ ' + m);
for (const m of warns) console.log('⚠️  ' + m);
for (const m of infos) console.log('ℹ️  ' + m);
console.log(errors.length ? `\n결과: 고칠 것 ${errors.length}개 — 제출 전에 고쳐 주세요` :
  `\n결과: 통과${tested ? '' : ' (시험은 못 돌림)'}${warns.length ? ` · 확인할 것 ${warns.length}개` : ''}`);
process.exit(errors.length ? 1 : 0);
