// 변이 시험 — '시험이 진짜로 잡는지' 확인한다. (통합 담당자가 kit.js 를 고친 뒤 돌린다)
//   node tests/mutation.mjs
// kit.js 의 안전 규칙을 하나씩 일부러 깨뜨리고, 시험이 그 규칙의 항목에서 실패하는지 본다.
// 끝나면(중간에 멈춰도) kit.js 를 원래대로 되돌린다.
// ⚠ 깨뜨릴 자리를 문자열로 찾는다 — kit.js 를 고쳐서 자리를 못 찾으면 '자리 없음'으로 알려 준다.
//   그러면 아래 MUT 의 문자열을 새 코드에 맞게 고칠 것.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KIT = path.join(ROOT, 'webapp', 'js', 'kit.js');
const ORIG = fs.readFileSync(KIT, 'utf8');
const restore = () => fs.writeFileSync(KIT, ORIG);
process.on('SIGINT', () => { restore(); process.exit(130); });

const MUT = [
  ['S1', 'smoke', "    window.addEventListener('pagehide', panic);\n", ''],
  ['S2', 'smoke', "      if (visible($('altinoConfirm'))) return true;       // AltinoUI.confirm\n", ''],
  ['S3', 't00',   "        try { if (e && e.pointerId != null) el.setPointerCapture(e.pointerId); } catch (err) {}\n", ''],
  ['S4', 'smoke', "      if (o.kick !== false && m !== 0 && lastM === 0 && Math.abs(m) < KICK_BELOW) kickUntil = Date.now() + KICK_MS;\n", ''],
  ['S5', 'smoke', '        alive: () => running && gen === runGen,', '        alive: () => running,'],
  ['S6', 'smoke', '      if (running && m !== 0 && transport && transport.connected && Date.now() - lastRxAt > FRESH_MS) {', '      if (false) {'],
  ['S7', 'smoke', '      state.go(0, 0); state.steer(0); state.soundSet(0);\n      send();\n    }\n    function panic', '      state.go(0, 0); state.steer(0);\n      send();\n    }\n    function panic'],
];
let caught = 0, missing = 0;
try {
  for (const [tag, which, from, to] of MUT) {
    if (!ORIG.includes(from)) { missing++; console.log(`?  ${tag} 깨뜨릴 자리를 kit.js 에서 못 찾음 — tests/mutation.mjs 갱신 필요`); continue; }
    fs.writeFileSync(KIT, ORIG.replace(from, to));
    const args = which === 'smoke' ? ['tests/smoke.mjs', 't00'] : ['tests/t00.mjs'];
    const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', env: process.env });
    const own = (r.stdout || '').split('\n').filter(l => l.startsWith('✗') && l.slice(2).startsWith(tag));
    if (own.length) caught++;
    console.log(`${own.length ? '✓ 잡음' : '✗ 못 잡음'}  ${tag} 를 깨뜨리면 → ${own.map(l => l.slice(2, 48)).join(' | ') || '해당 항목이 실패하지 않음'}`);
  }
} finally { restore(); }
console.log('──────────────');
console.log(`변이 ${MUT.length}개 중 ${caught}개를 시험이 잡음${missing ? ` (자리 못 찾음 ${missing}개)` : ''}`);
process.exit(caught === MUT.length ? 0 : 1);
