// t00 견본 앱 전용 시험 — 조종 패드(S3)와 공용 데이터.
// 새 앱에 패드가 있으면 이 파일을 tests/tNN.mjs 로 복사해 아래 APP 과 버튼 id 를 바꿔 쓴다.
// (견본 기능 — 음표·카운터 등 — 을 지웠으면 그 시험도 지운다)
//   node tests/t00.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const APP = 't00';                       // ← 내 앱 번호로
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = path.join(ROOT, 'webapp');
const STUB = fs.readFileSync(path.join(ROOT, 'tests', 'stub.js'), 'utf8');
let chromium;
try { ({ chromium } = await import('playwright')); }
catch (e) { ({ chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs')); }
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const p = path.join(WEB, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(WEB) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, r));
const BASE = 'http://localhost:' + server.address().port;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('✓ ' + n); } else { fail++; console.log('✗ ' + n + (x ? '  → ' + x : '')); } };
const br = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await br.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: true });
await ctx.addInitScript(STUB);
const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(BASE + `/${APP}.html`); await p.waitForTimeout(600);
await p.evaluate(() => window.__feed({}));
const tail = (n) => p.evaluate((k) => window.__tx.slice(-k), n);
const press = async (sel) => { const b = await p.locator(sel).boundingBox(); await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await p.mouse.down(); return b; };

// S3 — 누르는 동안만, 미끄러져도 유지, 떼면 정지
const ub = await p.locator('#d-up').boundingBox();
ok('S3 패드 버튼이 충분히 큼(가로 80·세로 60 이상)', ub.width >= 80 && ub.height >= 60, `${Math.round(ub.width)}x${Math.round(ub.height)}`);
ok('S3 패드에 touch-action:none', await p.evaluate(() => getComputedStyle(document.getElementById('d-up')).touchAction === 'none'));
ok('S3 패드가 스크롤 상자 안에 있지 않음', await p.evaluate(() => {
  for (let e = document.getElementById('d-up').parentElement; e; e = e.parentElement) {
    const ov = getComputedStyle(e).overflowY; if (ov === 'auto' || ov === 'scroll') return false;
  } return true; }));
await press('#d-up'); await p.waitForTimeout(400);
ok('S3 누르는 동안 전진', (await tail(2)).every(v => v > 0), JSON.stringify(await tail(2)));
await p.mouse.move(ub.x + ub.width / 2 + 90, ub.y + ub.height / 2 + 50); await p.waitForTimeout(300);
ok('S3 손가락이 버튼 밖으로 미끄러져도 유지', (await tail(2)).every(v => v > 0), JSON.stringify(await tail(2)));
await p.mouse.up(); await p.waitForTimeout(350);
ok('S3 떼면 정지', (await tail(2)).every(v => v === 0), JSON.stringify(await tail(2)));

// S2 — 앱이 등록한 창(문제창)이 떠 있으면 패드를 눌러도 안 움직임
await p.click('#openQuiz'); await p.waitForTimeout(200);
await p.evaluate(() => { window.__tx.length = 0; window.__altinoKit.drive(300, 0); });
await p.waitForTimeout(350);
ok('S2 kit.block 으로 등록한 창이 떠 있으면 정지', (await tail(3)).every(v => v === 0), JSON.stringify(await tail(3)));
await p.click('#quizClose');

// 공용 데이터 — 모둠 이름·성장기록부·저장 이름공간
await p.fill('#teamIn', '번개호'); await p.click('#teamSet'); await p.waitForTimeout(150);
ok('모둠 이름이 공용 키에 저장', await p.evaluate(() => localStorage.getItem('altino.team.name') === '번개호'));
ok('모둠 이름이 상단 칩에 표시', (await p.textContent('#kitTeam')).includes('번개호'));
await p.click('#recAdd'); await p.waitForTimeout(150);
const rec = await p.evaluate(() => JSON.parse(localStorage.getItem('altino.record') || '[]'));
ok('성장기록부에 앱 번호와 함께 기록', rec.length === 1 && rec[0].app === APP && rec[0].title.length > 0, JSON.stringify(rec));
await p.click('#cntUp'); await p.click('#cntUp'); await p.waitForTimeout(100);
ok(`앱 저장값은 altino.${APP}.* 에`, await p.evaluate((a) => localStorage.getItem(`altino.${a}.cnt`) === '2', APP));
await p.click('#cntReset'); await p.waitForTimeout(200);
ok('초기화는 확인창을 거친다(kit.confirm)', await p.isVisible('#altinoConfirm'));
await p.click('#acYes'); await p.waitForTimeout(150);
ok('확인하면 초기화', (await p.textContent('#cnt')).trim() === '0');

// 망가진 저장값 방어 — store.num 이 범위로 자른다
await p.evaluate((a) => localStorage.setItem(`altino.${a}.speed`, '"-999"'), APP);
await p.reload(); await p.waitForTimeout(500);
ok('망가진 저장값은 범위로 잘림', (await p.textContent('#spdVal')).trim() === '0', await p.textContent('#spdVal'));
ok('무에러', errs.length === 0, errs.join(' | '));
console.log('──────────────'); console.log(`${APP} 앱 시험: ${pass} 통과 / ${fail} 실패`);
await br.close(); server.close(); process.exit(fail ? 1 : 0);
