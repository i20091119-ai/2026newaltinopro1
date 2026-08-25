// 알티노 네오 프로토콜 인코더/디코더
// altinoneoCodingplay.apk 를 리버스 엔지니어링해 바이트 단위로 재현한 구현.
// 자세한 명세: docs/PROTOCOL.md
//
// 핵심: 앱은 26바이트 "상태 프레임"을 유지하고 50ms 주기로 계속 전송한다.
// 각 조작은 프레임의 특정 바이트만 바꾸고, 전송은 스트리밍 루프가 담당한다.

'use strict';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// 로봇으로 보낼 논리적 상태. buildFrame()이 이걸 26바이트로 직렬화한다.
class AltinoState {
  constructor() {
    this.steering = 0;      // -127..127
    this.motorA = 0;        // -1000..1000  (bytes 6,7)
    this.motorB = 0;        // -1000..1000  (bytes 8,9)
    this.displayMode = 0;   // 0x00=밝기, 0xFF=도트 비트맵
    this.dot = new Uint8Array(8); // 도트 8행 (displayMode=0xFF일 때 사용)
    this.sound = 0;         // 0..255
    this.led = 0;           // 0..65535 비트마스크
  }

  // --- APK의 static 명령 메서드들을 그대로 옮긴 것 ---

  // Go(a, b): a -> motorB(8,9), b -> motorA(6,7)  (APK 파라미터 순서 재현)
  go(a, b) {
    this.motorB = clamp(a | 0, -1000, 1000);
    this.motorA = clamp(b | 0, -1000, 1000);
  }

  steer(v) { this.steering = clamp(v | 0, -127, 127); }

  ledSet(v) { this.led = clamp(v | 0, 0, 0xFFFF); }

  soundSet(v) { this.sound = clamp(v | 0, 0, 255); }

  // 밝기 모드: 도트 비트맵을 지우고 전체 밝기만 설정
  display(brightness) {
    this.displayMode = 0x00 & 0xFF; // byte10 = brightness 값 자체(아래 buildFrame서 처리)
    this._brightness = clamp(brightness | 0, 0, 255);
    this.dot.fill(0);
  }

  // 도트 비트맵 모드
  dotOn(col, row) {   // col,row: 1..8
    if (col < 1 || col > 8 || row < 1 || row > 8) return;
    this.displayMode = 0xFF;
    this.dot[8 - col] |= (1 << (row - 1));
  }
  dotOff(col, row) {
    if (col < 1 || col > 8 || row < 1 || row > 8) return;
    this.displayMode = 0xFF;
    this.dot[8 - col] &= ~(1 << (row - 1)) & 0xFF;
  }
  dotClear() { this.displayMode = 0; this._brightness = 0; this.dot.fill(0); }

  stopAll() {
    this.go(0, 0); this.steer(0); this.soundSet(0); this.ledSet(0); this.dotClear();
  }
}

// 16bit 모터 값 인코딩 (APK Go() 재현)
// 양수: big-endian. 음수: ~|v| 의 하위 16bit = 0xFFFF - |v|.
function encodeMotor(v) {
  v = clamp(v | 0, -1000, 1000);
  let raw;
  if (v < 0) raw = (~Math.abs(v)) & 0xFFFF;   // 0xFFFF - |v|
  else raw = v & 0xFFFF;
  return [(raw >> 8) & 0xFF, raw & 0xFF];
}

// 상태 -> 26바이트 프레임 (Uint8Array). ConnectedThread.Sendbyte() 재현.
function buildFrame(st) {
  const b = new Uint8Array(26);
  b[0] = 0x02;            // STX
  b[1] = 0x14;            // CMD (20)
  // b[2] = checksum (아래에서 계산)
  b[3] = 0x01;
  b[4] = 0x01;
  b[5] = st.steering & 0xFF;               // signed int8 -> 바이트
  const [a6, a7] = encodeMotor(st.motorA);
  b[6] = a6; b[7] = a7;
  const [b8, b9] = encodeMotor(st.motorB);
  b[8] = b8; b[9] = b9;
  if (st.displayMode === 0xFF) {
    b[10] = 0xFF;
    for (let i = 0; i < 8; i++) b[11 + i] = st.dot[i] & 0xFF;
  } else {
    b[10] = (st._brightness || 0) & 0xFF;  // 밝기 모드
    for (let i = 11; i <= 18; i++) b[i] = 0;
  }
  b[19] = st.sound & 0xFF;
  b[20] = (st.led >> 8) & 0xFF;   // LED hi
  b[21] = st.led & 0xFF;          // LED lo
  b[22] = 0; b[23] = 0; b[24] = 0;
  b[25] = 0x03;                   // ETX
  // checksum: sum(bytes[3..24]) % 256
  let sum = 0;
  for (let i = 3; i <= 24; i++) sum += b[i];
  b[2] = sum & 0xFF;
  return b;
}

// 수신 54바이트 프레임 파서. 유효하면 센서 객체, 아니면 null.
function parseSensorFrame(f) {
  if (!f || f.length < 54) return null;
  if (f[0] !== 0x02 || f[1] !== 0x30 || f[53] !== 0x03) return null;
  const u16 = (hi, lo) => ((f[hi] & 0xFF) << 8) | (f[lo] & 0xFF);
  return {
    ir1: u16(5, 6), ir2: u16(7, 8), ir3: u16(9, 10),
    ir4: u16(11, 12), ir5: u16(13, 14), ir6: u16(15, 16),
    cds: u16(47, 48),      // 조도
    battery: u16(49, 50),  // 배터리
  };
}

// 바이트 스트림에서 54바이트 프레임을 뽑아내는 슬라이딩 파서
class SensorFrameAssembler {
  constructor() { this.buf = []; }
  push(bytes) {
    const out = [];
    for (const byte of bytes) {
      this.buf.push(byte & 0xFF);
      if (this.buf.length > 54) this.buf.shift();
      if (this.buf.length === 54) {
        const frame = Uint8Array.from(this.buf);
        const s = parseSensorFrame(frame);
        if (s) { out.push(s); this.buf = []; }
      }
    }
    return out;
  }
}

const AltinoProtocol = {
  AltinoState, buildFrame, parseSensorFrame, encodeMotor,
  SensorFrameAssembler,
  toHex: (u8) => Array.from(u8).map(x => x.toString(16).padStart(2, '0')).join(' '),
};

if (typeof module !== 'undefined' && module.exports) module.exports = AltinoProtocol;
if (typeof window !== 'undefined') window.AltinoProtocol = AltinoProtocol;
