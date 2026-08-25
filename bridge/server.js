#!/usr/bin/env node
// 알티노 브리지: WebSocket <-> Bluetooth Classic RFCOMM(SPP)
//
// 브라우저(Web Bluetooth)는 클래식 SPP를 지원하지 않으므로, 이 브리지가
// 웹앱과 로봇 사이에서 바이트를 그대로 중계한다.
//   웹앱 --(WebSocket, binary)--> 브리지 --(RFCOMM SPP)--> 알티노
//   알티노 --(RFCOMM)--> 브리지 --(WebSocket, binary)--> 웹앱
//
// 필요 패키지: ws, bluetooth-serial-port  (bridge/README.md 참고)
// 실행: node server.js --addr AA:BB:CC:DD:EE:FF   (미지정 시 자동 검색)

'use strict';
const WebSocket = require('ws');

const SPP_CHANNEL_FALLBACK = 1;
const WS_PORT = parseInt(process.env.PORT || '8080', 10);

function parseArgs() {
  const a = { addr: null, name: null };
  const v = process.argv.slice(2);
  for (let i = 0; i < v.length; i++) {
    if (v[i] === '--addr') a.addr = v[++i];
    else if (v[i] === '--name') a.name = v[++i];
  }
  return a;
}

let Bt;
try { Bt = require('bluetooth-serial-port').BluetoothSerialPort; }
catch (e) {
  console.error('[!] "bluetooth-serial-port" 미설치. bridge/README.md 참고 후 `npm install`.');
  process.exit(1);
}

function findDevice({ addr, name }) {
  return new Promise((resolve, reject) => {
    if (addr) return resolve(addr);
    const btf = new Bt();
    console.log('[*] 블루투스 기기 검색 중… (알티노 페어링 되어 있어야 함)');
    btf.on('found', (address, devname) => {
      console.log('    발견:', address, devname);
      if (!name || (devname && devname.toLowerCase().includes(name.toLowerCase()))
          || (devname && /altino/i.test(devname))) {
        btf.close(); resolve(address);
      }
    });
    btf.on('finished', () => reject(new Error('알티노를 찾지 못함. --addr 로 직접 지정하세요.')));
    btf.inquire();
  });
}

function connectSPP(address) {
  return new Promise((resolve, reject) => {
    const bt = new Bt();
    bt.findSerialPortChannel(address, (channel) => {
      console.log('[*] SPP 채널', channel, '로 연결 시도…');
      bt.connect(address, channel, () => resolve(bt), (err) => reject(err || new Error('연결 실패')));
    }, () => {
      // 채널 탐색 실패 시 폴백
      bt.connect(address, SPP_CHANNEL_FALLBACK, () => resolve(bt), (err) => reject(err || new Error('연결 실패')));
    });
  });
}

async function main() {
  const args = parseArgs();
  const address = await findDevice(args);
  console.log('[*] 대상 주소:', address);
  const bt = await connectSPP(address);
  console.log('[+] 알티노 RFCOMM 연결 완료');

  const wss = new WebSocket.Server({ port: WS_PORT });
  console.log('[+] WebSocket 대기: ws://0.0.0.0:' + WS_PORT);

  // 로봇 -> 모든 웹 클라이언트
  bt.on('data', (buf) => {
    wss.clients.forEach((c) => { if (c.readyState === WebSocket.OPEN) c.send(buf); });
  });
  bt.on('closed', () => { console.log('[!] RFCOMM 연결 종료'); process.exit(1); });
  bt.on('failure', (e) => console.error('[!] BT 오류', e));

  wss.on('connection', (ws) => {
    console.log('[+] 웹 클라이언트 접속');
    ws.on('message', (msg) => {
      // 웹앱은 26바이트 바이너리 프레임을 보냄 -> 로봇으로 그대로 write
      const buf = Buffer.isBuffer(msg) ? msg : Buffer.from(msg);
      bt.write(buf, (err) => { if (err) console.error('[!] write 오류', err); });
    });
    ws.on('close', () => console.log('[-] 웹 클라이언트 해제'));
  });
}

main().catch((e) => { console.error('[X]', e.message); process.exit(1); });
