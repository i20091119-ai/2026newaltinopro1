// 공통 안전 시험 — kit 을 쓰는 모든 주제 앱이 통과해야 한다.
//   node tests/smoke.mjs t07
// 준비(처음 한 번): npm i -D playwright && npx playwright install chromium
// 환경변수: CHROMIUM_PATH(브라우저 위치를 직접 줄 때)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = process.argv[2];
if (!/^t\d{2}$/.test(app || '')) { console.error('사용법: node tests/smoke.mjs t07'); process.exit(2); }
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = path.join(ROOT, 'webapp');
const STUB = fs.readFileSync(path.join(ROOT, 'tests', 'stub.js'), 'utf8');

let chromium;
try { ({ chromium } = await import('playwright')); }
catch (e) {
  try { ({ chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs')); }
  catch (e2) { console.error('playwright 가 없습니다: npm i -D playwright && npx playwright install chromium'); process.exit(2); }
}

// 정적 서버(파이썬 없이)
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.wav': 'audio/wav', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const p = path.join(WEB, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(WEB) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, r));
const BASE = 'http://localhost:' + server.address().port;

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('✓ ' + n); } else { fail++; console.log('✗ ' + n + (x ? '  → ' + x : '')); } };
const launch = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
const br = await chromium.launch(launch);
const wait = (p, ms) => p.waitForTimeout(ms);

async function open() {
  const ctx = await br.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: true });
  await ctx.addInitScript(STUB);
  const p = await ctx.newPage();
  const errs = [], bad = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('response', r => { if (r.status() >= 400 && !r.url().includes('favicon')) bad.push(r.status() + ' ' + r.url().replace(BASE, '')); });
  await p.goto(`${BASE}/${app}.html`); await wait(p, 600);
  return { ctx, p, errs, bad };
}
const recent = (p, n) => p.evaluate((k) => window.__tx.slice(-k), n);
const clearTx = (p) => p.evaluate(() => { window.__tx.length = 0; });

// 1) 기본
{
  const { ctx, p, errs, bad } = await open();
  ok('화면이 오류 없이 열림', errs.length === 0, errs.join(' | '));
  ok('없는 파일(404) 없음', bad.length === 0, bad.join(', '));
  const k = await p.evaluate(() => window.__altinoKit && { id: window.__altinoKit.appId, v: window.__altinoKit.VERSION });
  ok('kit 으로 만든 앱', !!k, '');
  ok(`appId 가 파일 번호와 같음 (${app})`, k && k.id === app, k && k.id);
  const ovf = await p.evaluate(() => ({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight }));
  ok('1280×800 에서 화면이 넘치지 않음', ovf.w <= 1280 && ovf.h <= 800, JSON.stringify(ovf));
  ok('상단 공통 칩(#kitBar) 있음', await p.evaluate(() => !!document.getElementById('kitBar')));
  await ctx.close();
}

// 2) 움직임과 정지 (S1·S2·S4·S7)
{
  const { ctx, p } = await open();
  await p.evaluate(() => window.__feed({}));
  await clearTx(p);
  await p.evaluate(() => window.__altinoKit.drive(200, 0));
  await wait(p, 120);
  const early = await recent(p, 3);
  await wait(p, 400);
  const later = await recent(p, 3);
  ok('S4 느린 출발은 처음에 세게(킥)', early.some(v => v === 400), JSON.stringify(early));
  ok('S4 …그 뒤 원래 속도로', later.every(v => v === 200), JSON.stringify(later));

  const sync = await p.evaluate(() => { window.__tx.length = 0; window.dispatchEvent(new Event('pagehide')); return window.__tx.slice(); });
  ok('S1 화면을 벗어나면 그 자리에서 정지 프레임', sync.length > 0 && sync.every(v => v === 0), JSON.stringify(sync));

  await p.evaluate(() => window.__altinoKit.drive(300, 0)); await wait(p, 300);
  await p.evaluate(() => { window.AltinoUI.confirm({ title: '시험' }); });
  await wait(p, 150); await clearTx(p); await wait(p, 350);
  const blocked = await recent(p, 3);
  ok('S2 확인창이 떠 있으면 멈춤', blocked.length > 0 && blocked.every(v => v === 0), JSON.stringify(blocked));
  await p.evaluate(() => document.getElementById('acNo') && document.getElementById('acNo').click());

  await p.evaluate(() => window.__altinoKit.beep(44, 5000)); await wait(p, 150);
  await p.evaluate(() => window.__altinoKit.stop()); await wait(p, 150);
  const snd = await p.evaluate(() => window.__altinoKit.state.sound);
  ok('S7 정지하면 부저도 꺼짐', snd === 0, String(snd));
  await ctx.close();
}

// 3) 자율 동작 (S5·S6)
{
  const { ctx, p } = await open();
  // S6: 센서가 끊기면 멈춘다
  await p.evaluate(() => {
    window.__feed({});
    window.__altinoKit.run(async (r) => { while (r.alive()) { r.drive(300, 0); if (!await r.sleep(100)) return; } });
  });
  await wait(p, 400);
  const moving = await recent(p, 2);
  await wait(p, 1500);                       // 이 사이 센서를 안 넣는다
  const stale = await recent(p, 3);
  ok('S6 (준비) 자율 동작이 움직임', moving.some(v => v !== 0), JSON.stringify(moving));
  ok('S6 센서가 1.2초 끊기면 멈춤', stale.every(v => v === 0), JSON.stringify(stale));
  await p.evaluate(() => window.__altinoKit.stop());

  // S5: 정지 직후 다시 출발해도 옛 루프가 살아나지 않는다
  const r = await p.evaluate(async () => {
    const kit = window.__altinoKit; let loops = 0;
    const feeder = setInterval(() => window.__feed({}), 80);
    kit.run(async (rr) => { while (rr.alive()) { loops++; rr.drive(300, 0); if (!await rr.sleep(200)) return; } });
    await new Promise(z => setTimeout(z, 250));
    kit.stop();
    const ok2 = kit.run(async (rr) => { while (rr.alive()) { rr.drive(-300, 0); if (!await rr.sleep(100)) return; } });
    window.__tx.length = 0;
    await new Promise(z => setTimeout(z, 700));
    const after = window.__tx.slice();
    kit.stop(); clearInterval(feeder);
    return { ok2, after };
  });
  ok('S5 정지 → 바로 재출발이 가능', r.ok2 === true);
  // 새 루프는 −300(처음엔 킥 −400). 옛 루프가 살아 있으면 +300 이 섞인다.
  ok('S5 옛 루프(+300)가 새 루프를 덮지 않음', r.after.length > 0 && r.after.every(v => v <= 0), JSON.stringify(r.after));
  ok('S5 새 루프는 원래 속도(−300)로 안정', r.after.slice(-2).every(v => v === -300), JSON.stringify(r.after.slice(-3)));
  await ctx.close();
}

// 5) S8 전송 주기 10Hz (12대 동시 운영 — 20Hz 면 블루투스가 밀려 명령이 씹혔다)
{
  const { ctx, p } = await open();
  await clearTx(p); await wait(p, 2000);
  const n = await p.evaluate(() => window.__tx.length);
  ok('S8 전송 주기 10Hz (2초에 18~22 프레임)', n >= 18 && n <= 22, n + ' 프레임');
  await ctx.close();
}

// 4) 저장 이름 공간
{
  const { ctx, p } = await open();
  const keys = await p.evaluate(() => Object.keys(localStorage));
  const stray = keys.filter(k => !k.startsWith('altino') && k !== 'altinoDotOrientV1');
  ok('localStorage 는 altino.* 이름만 씀', stray.length === 0, stray.join(', '));
  await ctx.close();
}

console.log('──────────────'); console.log(`${app} 공통 안전 시험: ${pass} 통과 / ${fail} 실패`);
await br.close(); server.close();
process.exit(fail ? 1 : 0);
