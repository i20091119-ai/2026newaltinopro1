// 로봇 없이 시험하기 위한 '가짜 태블릿 앱(네이티브)' — 시험 도구가 페이지에 먼저 주입한다.
// ⚠ 프레임 위치는 js/protocol.js 와 같아야 한다(틀리면 시험이 엉뚱한 걸 통과시킨다 — 실제로 한 번 그랬다):
//   수신 54바이트: ir1~ir6 = 5,7,9,11,13,15 (각 2바이트) · 조도 cds = 47 · 배터리 = 49
//   송신 26바이트: motorA = 6~7 바이트 (음수는 0xFFFF−|v|, 1의 보수 — 아래 참고)
(function () {
  const cfg = window.__STUB_CFG || { connected: true, address: 'AA:BB:CC:DD:EE:16', name: 'ALTINO-NBF16' };
  window.__tx = [];          // 보낸 프레임의 motorA 값들
  window.__txFrames = [];    // 보낸 원본 프레임(필요하면)
  window.AltinoNative = {
    getState: () => JSON.stringify({ connected: cfg.connected, address: cfg.address, name: cfg.name }),
    sendFrame: (b64) => {
      const s = atob(b64); const f = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) f[i] = s.charCodeAt(i);
      // ⚠ 음수 모터값은 '2의 보수'가 아니라 0xFFFF − |v| (1의 보수)로 인코딩된다(protocol.js encodeMotor).
      //   int16 으로 읽으면 −300 이 −301 로 보인다 — 실제로 그렇게 잘못 읽었었다.
      const raw = (f[6] << 8) | f[7];
      window.__tx.push(raw & 0x8000 ? -(0xFFFF - raw) : raw);
      window.__txFrames.push(f);
      return true;
    },
    startScan() {}, stopScan() {}, connectTo() {}, connect() {},
    unbind() {}, disconnect() {}, openBluetoothSettings() {},
    getAppVersion: () => 'test',
  };
  // 센서 한 프레임 넣기: __feed({ ir2: 150, cds: 600 })
  window.__feed = (o) => {
    o = o || {};
    const f = new Uint8Array(54); f[0] = 0x02; f[1] = 0x30; f[53] = 0x03;
    const put = (i, v) => { f[i] = (v >> 8) & 0xFF; f[i + 1] = v & 0xFF; };
    put(5, o.ir1 ?? 900); put(7, o.ir2 ?? 900); put(9, o.ir3 ?? 900);
    put(11, o.ir4 ?? 900); put(13, o.ir5 ?? 900); put(15, o.ir6 ?? 900);
    put(47, o.cds ?? 600); put(49, o.battery ?? 820);
    let s = ''; for (const b of f) s += String.fromCharCode(b);
    if (window.__altinoOnData) window.__altinoOnData(btoa(s));
  };
})();
