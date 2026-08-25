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
  async connect() {
    if (!AndroidBridgeTransport.supported) throw new Error('AltinoNative 미주입(래퍼 앱 아님)');
    window.__altinoOnData = (b64) => {
      const bin = atob(b64); const u = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      this._emit('data', u);
    };
    window.__altinoOnStatus = (s) => {
      this.connected = (s === 'connected');
      this._emit('status', s);
    };
    if (typeof window.AltinoNative.connect === 'function') window.AltinoNative.connect();
    // 실제 연결 확정은 네이티브의 __altinoOnStatus('connected') 콜백에서 이뤄짐
  }
  async send(u8) {
    let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    window.AltinoNative.sendFrame(btoa(s));
  }
  async disconnect() {
    try { if (window.AltinoNative && window.AltinoNative.disconnect) window.AltinoNative.disconnect(); } catch (e) {}
    this.connected = false; this._emit('status', 'disconnected');
  }
}

const AltinoTransport = { WebSocketTransport, WebSerialTransport, AndroidBridgeTransport, MockTransport };
if (typeof window !== 'undefined') window.AltinoTransport = AltinoTransport;
