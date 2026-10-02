// 개발용 정적 서버 — 브라우저에서 앱을 가짜 로봇으로 열어 본다(파이썬 없이).
//   node tools/serve.mjs          → http://localhost:8099/t00.html
//   node tools/serve.mjs 8100     ← 포트를 바꿀 때
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const WEB = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), 'webapp');
const PORT = +(process.argv[2] || 8099);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.json': 'application/json' };
http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]); if (rel === '/') rel = '/school.html';
  const p = path.join(WEB, rel);
  if (!p.startsWith(WEB) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end('없는 파일: ' + rel); console.log('404 ' + rel); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(p).pipe(res);
}).listen(PORT, () => {
  console.log(`webapp/ 을 띄웠습니다 → http://localhost:${PORT}/t00.html  (로봇학교: http://localhost:${PORT}/)`);
  console.log('브라우저에서는 가짜 로봇으로 동작합니다. 끝내려면 Ctrl+C');
});
