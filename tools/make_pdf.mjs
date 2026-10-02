// 활동지·강사용 안내 HTML → A4 PDF. 몇 장이 나왔는지 알려 준다.
//   node tools/make_pdf.mjs docs/topics/t07_활동지.html          → 같은 이름의 .pdf
//   node tools/make_pdf.mjs docs/topics/t07_활동지.html --pages 1  ← 1장을 넘으면 실패(활동지)
// 왜: 화면 폭에서 보고 '한 장'이라 했는데 인쇄하면 두 장이었다(dev-guide/04 #39).
//     A4 인쇄 영역 폭(여백 11mm 기준 188mm ≈ 711px)으로 그려야 진짜 줄바꿈이 나온다 — 이 도구는 인쇄 그대로 그린다.
// 글꼴·그림: HTML 옆에 없으면 webapp/fonts/ · webapp/assets/ 에서 같은 이름을 찾는다.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = process.argv[2];
const pi = process.argv.indexOf('--pages'), maxPages = pi > 0 ? +process.argv[pi + 1] : 0;
if (!src || !/\.html?$/.test(src) || !fs.existsSync(src)) { console.error('사용법: node tools/make_pdf.mjs <파일.html> [--pages 1]'); process.exit(2); }
let chromium;
try { ({ chromium } = await import('playwright')); }
catch (e) {
  try { ({ chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs')); }
  catch (e2) { console.error('playwright 가 없습니다: npm install && npx playwright install chromium'); process.exit(2); }
}
const DIR = path.resolve(path.dirname(src)), FONTS = path.join(ROOT, 'webapp', 'fonts'), ASSETS = path.join(ROOT, 'webapp', 'assets');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  let p = path.join(DIR, rel);
  if (!fs.existsSync(p) && rel.endsWith('.woff2')) p = path.join(FONTS, path.basename(rel));
  else if (!fs.existsSync(p) && /\.(png|jpg|svg)$/.test(rel)) p = path.join(ASSETS, path.basename(rel));
  if (!(p.startsWith(DIR) || p.startsWith(FONTS) || p.startsWith(ASSETS)) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, r));
const br = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await br.newPage();
const missing = [];
page.on('response', r => { if (r.status() >= 400) missing.push(decodeURIComponent(r.url().replace(/^https?:\/\/[^/]+/, ''))); });
await page.goto(`http://localhost:${server.address().port}/${encodeURIComponent(path.basename(src))}`, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
const out = src.replace(/\.html?$/, '.pdf');
const buf = await page.pdf({ path: out, format: 'A4', printBackground: true, preferCSSPageSize: true });
const pages = (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
await br.close(); server.close();
if (missing.length) console.log('⚠️  없는 파일: ' + missing.join(', '));
console.log(`${out} — A4 ${pages}장`);
if (maxPages && pages > maxPages) { console.log(`❌ ${maxPages}장을 넘었습니다 — 글을 줄이거나 칸을 줄이세요`); process.exit(1); }
