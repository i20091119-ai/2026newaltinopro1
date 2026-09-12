// 전송 계층 추상화.
// 브라우저 Web Bluetooth 는 클래식 SPP 를 지원하지 않으므로, 아래 두 경로 중
// 하나로 로봇과 연결한다:
//   1) WebSocketTransport : bridge/ 의 Node 브리지(WS<->RFCOMM SPP) 경유. (권장)
//   2) WebSerialTransport : 알티노를 USB 시리얼로 붙였거나 OS가 SPP를 시리얼
//      포트로 노출한 데스크톱 Chrome에서. (태블릿에선 대개 불가)
'use strict';

// 공통 인터페이스:
//   async connect(opts)   연결
//   async disconnect()    해제
//   async send(uint8)     26바이트 프레임 전송
//   on('data', bytes=>{}) 수신 바이트
//   on('status', s=>{})   'connected' | 'disconnected' | 'error:<msg>'
class BaseTransport {
  constructor() { this._h = { data: [], status: [] }; this.connected = false; }
  on(ev, cb) { (this._h[ev] || (this._h[ev] = [])).push(cb); return this; }
  _emit(ev, arg) { (this._h[ev] || []).forEach(cb => { try { cb(arg); } catch (e) {} }); }
}

// ---- 1) WebSocket 브리지 ----
class WebSocketTransport extends BaseTransport {
  constructor() { super(); this.ws = null; }
  async connect({ url }) {
    return new Promise((resolve, reject) => {
      try {
        const ws = new WebSocket(url);
        ws.binaryType = 'arraybuffer';
        this.ws = ws;
        const to = setTimeout(() => { try { ws.close(); } catch (e) {} reject(new Error('연결 시간 초과')); }, 6000);
        ws.onopen = () => { clearTimeout(to); this.connected = true; this._emit('status', 'connected'); resolve(); };
        ws.onmessage = (ev) => {
          const bytes = ev.data instanceof ArrayBuffer ? new Uint8Array(ev.data)
            : (typeof ev.data === 'string' ? null : new Uint8Array(ev.data));
          if (bytes) this._emit('data', bytes);
        };
        ws.onerror = () => { this._emit('status', 'error:websocket'); };
        ws.onclose = () => { this.connected = false; this._emit('status', 'disconnected'); };
      } catch (e) { reject(e); }
    });
  }
  async send(u8) { if (this.ws && this.connected) this.ws.send(u8); }
  async disconnect() { if (this.ws) { try { this.ws.close(); } catch (e) {} this.ws = null; } this.connected = false; }
}

// ---- 2) Web Serial ----
class WebSerialTransport extends BaseTransport {
  constructor() { super(); this.port = null; this.writer = null; this.reader = null; this._readLoop = null; }
  static get supported() { return typeof navigator !== 'undefined' && 'serial' in navigator; }
  async connect({ baudRate = 9600 } = {}) {
    if (!WebSerialTransport.supported) throw new Error('이 브라우저는 Web Serial 미지원');
    this.port = await navigator.serial.requestPort();
    await this.port.open({ baudRate });
    this.writer = this.port.writable.getWriter();
    this.connected = true;
    this._emit('status', 'connected');
    this._startRead();
  }
  async _startRead() {
    try {
      this.reader = this.port.readable.getReader();
      while (this.connected) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (value) this._emit('data', new Uint8Array(value));
      }
    } catch (e) { this._emit('status', 'error:read'); }
  }
  async send(u8) { if (this.writer) await this.writer.write(u8); }
  async disconnect() {
    this.connected = false;
    try { if (this.reader) { await this.reader.cancel(); this.reader.releaseLock(); } } catch (e) {}
    try { if (this.writer) this.writer.releaseLock(); } catch (e) {}
    try { if (this.port) await this.port.close(); } catch (e) {}
    this.port = this.writer = this.reader = null;
    this._emit('status', 'disconnected');
  }
}

// ---- (옵션) 실제 링크 없이 UI만 테스트하는 목 전송 ----
class MockTransport extends BaseTransport {
  async connect() { this.connected = true; this._emit('status', 'connected');
    this._t = setInterval(() => {
      // 가짜 센서 프레임 생성 (배터리/IR 랜덤)
      const f = new Uint8Array(54); f[0]=0x02; f[1]=0x30; f[53]=0x03;
      const put=(i,v)=>{f[i]=(v>>8)&0xFF;f[i+1]=v&0xFF;};
      put(5,300+((Math.random()*40)|0)); put(7,280); put(9,260); put(11,250); put(13,240); put(15,230);
      put(47,500+((Math.random()*30)|0)); put(49,760+((Math.random()*20)|0));
      this._emit('data', f);
    }, 100);
  }
  async send(u8) { /* 콘솔로만 확인 */ if (window.__ALTINO_LOG_TX) console.log('TX', AltinoProtocol.toHex(u8)); }
  async disconnect() { clearInterval(this._t); this.connected=false; this._emit('status','disconnected'); }
}

// ---- 3) Android WebView 네이티브 브리지 (방법 B) ----
// 얇은 Android 래퍼가 window.AltinoNative 를 주입한 경우 사용.
//   네이티브 -> JS : window.__altinoOnData(base64) 로 수신 바이트 전달
//   JS -> 네이티브 : AltinoNative.sendFrame(base64) 로 26바이트 프레임 전송
class AndroidBridgeTransport extends BaseTransport {
  static get supported() { return typeof window !== 'undefined' && !!window.AltinoNative; }
  // ⚠ 전역 콜백(__altinoOnData/Status/Scan)은 window 에 하나뿐이다.
  //   예전엔 새 인스턴스를 만들 때마다 이 전역을 덮어써서, 연결창을 한 번 열면
  //   (연결창이 스캔 전용 transport 를 새로 만든다) 살아있던 게임 쪽 transport 의
  //   센서 수신이 영구히 끊겼다 — 화면엔 '연결됨'인데 잡힘 판정·배터리·IR 이 전부 정지.
  //   그래서 전역에는 '중계기'만 한 번 설치하고, 실제 배달은 아래 규칙으로 한다.
  //     data/status → _active (연결을 소유한 인스턴스) 에게만
  //     scan        → _attach 된 모든 인스턴스에게 (연결창도 결과를 받아야 하므로)
  _attach() {
    const C = AndroidBridgeTransport;
    C._all.add(this);
    if (C._installed) return; C._installed = true;
    window.__altinoOnData = (b64) => {
      const t = C._active; if (!t) return;
      const bin = atob(b64); const u = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      t._emit('data', u);
    };
    window.__altinoOnStatus = (s) => {
      const t = C._active; if (!t) return;
      // ⚠ 'scanning' · 'error:busy' 같은 진행중 알림까지 연결끊김으로 처리하면
      //   스스로 재연결 루프를 만든다. 확정 신호일 때만 connected 를 바꾼다.
      if (s === 'connected') t.connected = true;
      else if (s === 'disconnected' || s === 'error:no-bound' || s === 'error:location-off'
               || s === 'error:bt-off' || s === 'error:not-found') t.connected = false;
      t._emit('status', s);
    };
    // BLE 스캔 결과(무페어링) — 기기 발견마다 호출
    window.__altinoOnScan = (json) => {
      let d; try { d = JSON.parse(json); } catch (e) { return; }
      if (!d || !d.address) return;
      C._all.forEach((t) => t._emit('scan', d));
    };
  }
  // 이 인스턴스를 '연결 소유자'로 지정 — connect/connectTo/adopt 에서만 호출
  _claim() { this._attach(); AndroidBridgeTransport._active = this; }
  // 더 이상 쓰지 않는 인스턴스는 반드시 떼어낸다(연결창 닫기 등).
  // 안 떼면 네이티브 자동재연결 데이터가 유령 인스턴스로 흘러들어간다.
  detach() {
    const C = AndroidBridgeTransport;
    C._all.delete(this);
    if (C._active === this) C._active = null;
  }
  // BLE 스캔 시작 — 발견 기기는 on('scan', {name,address,rssi}) 로 전달
  startScan() {
    this._attach();   // 스캔은 _attach 만 — _claim 하지 않는다(살아있는 연결을 뺏지 않도록)
    try { if (window.AltinoNative.startScan) window.AltinoNative.startScan(); else window.AltinoNative.listDevices(); } catch (e) {}
  }
  stopScan() { try { if (window.AltinoNative.stopScan) window.AltinoNative.stopScan(); } catch (e) {} }
  // 하위호환: 즉시 배열이 필요하던 옛 UI용(BLE에선 스캔을 시작하고 빈 배열 반환)
  listDevices() {
    try { const r = window.AltinoNative.listDevices(); return JSON.parse(r || '[]'); } catch (e) { return []; }
  }
  // 안드로이드 [설정 → 블루투스] 열기 (페어링하러 다녀오기)
  openSettings() {
    try { if (window.AltinoNative && window.AltinoNative.openBluetoothSettings) window.AltinoNative.openBluetoothSettings(); } catch (e) {}
  }
  async connect() { // 바인딩된(이전에 고른) 로봇에만 연결. 없으면 error:no-bound.
    if (!AndroidBridgeTransport.supported) throw new Error('AltinoNative 미주입(래퍼 앱 아님)');
    this._claim();
    if (typeof window.AltinoNative.connect === 'function') window.AltinoNative.connect();
    // 실제 연결 확정은 네이티브의 __altinoOnStatus('connected') 콜백에서
  }
  // 네이티브 연결 상태 조회(페이지 이동해도 네이티브 GATT는 살아있음)
  state() { try { return JSON.parse(window.AltinoNative.getState() || '{}'); } catch (e) { return {}; } }
  // 이미 연결된 네이티브 링크를 '입양'(재연결 없이 콜백만 재바인딩)
  adopt() { this._claim(); this.connected = true; this._emit('status', 'connected'); }
  // 바인딩 해제('다른 로봇 선택')
  unbind() { try { if (window.AltinoNative.unbind) window.AltinoNative.unbind(); } catch (e) {} this.connected = false; }
  async connectTo(address) { // 특정 MAC으로 연결(다중 기기 선택)
    if (!AndroidBridgeTransport.supported) throw new Error('AltinoNative 미주입');
    this._claim();
    if (typeof window.AltinoNative.connectTo === 'function') window.AltinoNative.connectTo(address);
  }
  async send(u8) {
    let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    window.AltinoNative.sendFrame(btoa(s));
  }
  async disconnect() {
    try { if (window.AltinoNative && window.AltinoNative.disconnect) window.AltinoNative.disconnect(); } catch (e) {}
    this.connected = false; this._emit('status', 'disconnected');
    this.detach();
  }
}
AndroidBridgeTransport._all = new Set();
AndroidBridgeTransport._active = null;
AndroidBridgeTransport._installed = false;

const AltinoTransport = { WebSocketTransport, WebSerialTransport, AndroidBridgeTransport, MockTransport };
if (typeof window !== 'undefined') window.AltinoTransport = AltinoTransport;
