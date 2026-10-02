// 모든 화면이 오류·없는 파일(404) 없이 열리는지 — 통합 담당자가 합칠 때마다 돌린다.
//   node tests/pages.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = path.join(ROOT, 'webapp');
const STUB = fs.readFileSync(path.join(ROOT, 'tests', 'stub.js'), 'utf8');
let chromium;
try { ({ chromium } = await import('playwright')); }
catch (e) { ({ chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs')); }
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.wav': 'audio/wav' };
const server = http.createServer((req, res) => {
  const p = path.join(WEB, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(WEB) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, r));
const BASE = 'http://localhost:' + server.address().port;
const pages = fs.readdirSync(WEB).filter(f => f.endsWith('.html') && !f.includes('.test.')).sort();
const br = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
let fail = 0;
for (const pg of pages) {
  for (const native of [false, true]) {      // 브라우저(데모) / 태블릿(네이티브) 두 경우 다
    const ctx = await br.newContext({ viewport: { width: 1280, height: 800 } });
    if (native) await ctx.addInitScript(STUB);
    const p = await ctx.newPage(); const errs = [], bad = [];
    p.on('pageerror', e => errs.push(e.message));
    p.on('response', r => { if (r.status() >= 400 && !r.url().includes('favicon')) bad.push(r.url().replace(BASE, '')); });
    await p.goto(`${BASE}/${pg}`); await p.waitForTimeout(500);
    const okk = !errs.length && !bad.length; if (!okk) fail++;
    console.log(`${okk ? '✓' : '✗'} ${pg.padEnd(16)} ${native ? '태블릿' : '브라우저'}` + (okk ? '' : '  → ' + [...errs, ...bad.map(b => '404 ' + b)].join(' | ')));
    await ctx.close();
  }
}
console.log('──────────────'); console.log(`화면 ${pages.length}개 × 2: ${fail ? fail + '개 실패' : '모두 통과'}`);
await br.close(); server.close(); process.exit(fail ? 1 : 0);
