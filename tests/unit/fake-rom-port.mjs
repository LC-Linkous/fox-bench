// A Web Serial `SerialPort` whose other end is an ESP ROM bootloader — enough of one for esptool-js to
// sync, read the chip magic and registers, and identify the chip. It records every signal change and
// every SLIP command so a test can say what the real esptool-js did to the port.
//
// It is NOT a stub loader: `main()` goes on to upload the flasher stub, which needs MEM_BEGIN/DATA/END
// and a stub that answers "OHAI". The fake refuses at that point with a recognisable error, so the test
// can assert everything up to and including chip detection and the reset strategy the loader chose —
// which is the part of a flash that depends on the board (USB-JTAG on a native-USB chip such as the
// XIAO ESP32-C3, DTR/RTS on a UART bridge) and the part a bench failure ("Failed to connect") points at.
//
// Wire format (esptool docs, "Serial Protocol"): SLIP frames, each a command packet
//   dir(1)=0x00 cmd(1) size(2 LE) checksum(4 LE) data(size)
// and the ROM's reply  dir=0x01 cmd size value(4) data  where data ends in a 2-byte status (ROM: 2 bytes;
// stub: 2 bytes) — esptool-js reads value for READ_REG and the first status byte for success.

const SLIP_END = 0xC0, SLIP_ESC = 0xDB, ESC_END = 0xDC, ESC_ESC = 0xDD;
const CMD = { SYNC: 0x08, READ_REG: 0x0a, WRITE_REG: 0x09, MEM_BEGIN: 0x05, MEM_DATA: 0x07, MEM_END: 0x06, SPI_ATTACH: 0x0d, CHANGE_BAUD: 0x0f, GET_SECURITY_INFO: 0x14, ERASE_FLASH: 0xd0, FLASH_BEGIN: 0x02 };

// What esptool-js 0.7.0 asks an ESP32-C3 ROM (esp32c3.ts): GET_SECURITY_INFO first — a 20-byte reply whose
// chip id (bytes 12–15) is 5 for the C3 — then eFuse registers off EFUSE_BASE 0x60008800: MAC from +0x44/+0x48,
// chip revision from +0x50/+0x58, package/flash bits from +0x44 too. Crystal is a constant 40 MHz on the C3.
const CHIPS = {
  esp32c3: {
    name: 'ESP32-C3', securityInfo: { chipId: 5, flags: 0 },
    regs: {
      0x40001000: 0x6921506f,                               // chip-detect magic (not used when security info answers)
      0x60008844: 0xbda10f20, 0x60008848: 0x00007c9e,       // MAC 7c:9e:bd:a1:0f:20
      0x60008850: 0x00000000, 0x60008858: 0x00000000,       // revision 0.0
      0x60008854: 0x00000000, 0x6000884c: 0x00000000,
    },
  },
};

function slipEncode(bytes) {
  const out = [SLIP_END];
  for (const b of bytes) { if (b === SLIP_END) out.push(SLIP_ESC, ESC_END); else if (b === SLIP_ESC) out.push(SLIP_ESC, ESC_ESC); else out.push(b); }
  out.push(SLIP_END);
  return Uint8Array.from(out);
}
function reply(cmd, value, status = [0, 0], payload = []) {
  const data = Uint8Array.from([...payload, ...status]);
  const pkt = new Uint8Array(8 + data.length);
  const dv = new DataView(pkt.buffer);
  pkt[0] = 1; pkt[1] = cmd; dv.setUint16(2, data.length, true); dv.setUint32(4, value >>> 0, true); pkt.set(data, 8);
  return slipEncode(pkt);
}

export class FakeRomPort {
  /** @param {{chip?: string, usbVendorId?: number, usbProductId?: number, answerSync?: boolean}} o */
  constructor({ chip = 'esp32c3', usbVendorId = 0x303a, usbProductId = 0x1001, answerSync = true } = {}) {
    this.chipDef = CHIPS[chip]; this.chipName = chip;
    this.info = { usbVendorId, usbProductId };
    this.answerSync = answerSync;
    this.stubRunning = false;      // flip to make esptool-js skip the stub upload ("Stub is already running")
    this.opens = 0; this.closes = 0; this.baudRates = [];
    this.signals = [];          // every setSignals() call, in order, with a timestamp
    this.commands = [];         // every SLIP command decoded: {cmd, data}
    this.opened = null; this.closed = false;
    this._rx = [];              // bytes queued for the reader
    this._wake = null;
    this._inbuf = [];
    this._t0 = Date.now();
    this._mkStreams();
  }
  getInfo() { return this.info; }
  async open(o) { this.opened = o; this.opens++; this.baudRates.push(o?.baudRate); this.closed = false; this._rx = []; this._inbuf = []; this._mkStreams(); }
  async close() { this.closes++; this.closed = true; const w = this._wake; this._wake = null; w?.(); }
  _mkStreams() {
    const self = this;
    this.readable = new ReadableStream({
      async pull(ctl) {
        while (!self._rx.length && !self.closed) await new Promise(r => { self._wake = r; });
        if (self.closed && !self._rx.length) { try { ctl.close(); } catch {} return; }
        ctl.enqueue(self._rx.shift());
      },
    });
    this.writable = new WritableStream({ write: chunk => self._onWrite(chunk) });
  }
  async setSignals(s) { this.signals.push({ t: Date.now() - this._t0, ...s }); }
  async getSignals() { return {}; }
  _push(bytes) { this._rx.push(bytes); const w = this._wake; this._wake = null; w?.(); }
  _onWrite(chunk) {
    for (const b of chunk) {
      if (b === SLIP_END) {
        if (this._inbuf.length) { this._onFrame(Uint8Array.from(this._inbuf)); this._inbuf = []; }
        continue;
      }
      this._inbuf.push(b);
    }
  }
  _onFrame(raw) {
    // SLIP-decode
    const f = []; for (let i = 0; i < raw.length; i++) { if (raw[i] === SLIP_ESC) { i++; f.push(raw[i] === ESC_END ? SLIP_END : SLIP_ESC); } else f.push(raw[i]); }
    if (f.length < 8 || f[0] !== 0) return;
    const dv = new DataView(Uint8Array.from(f).buffer);
    const cmd = f[1], size = dv.getUint16(2, true), data = Uint8Array.from(f.slice(8, 8 + size));
    this.commands.push({ cmd, data, name: Object.keys(CMD).find(k => CMD[k] === cmd) || ('0x' + cmd.toString(16)) });
    switch (cmd) {
      case CMD.SYNC:
        if (!this.answerSync) return;                                 // a board not in download mode says nothing
        for (let i = 0; i < 8; i++) this._push(reply(CMD.SYNC, 0, this.stubRunning ? [0, 0] : [1, 0]));  // a burst of replies; status[0]=0 only from the stub
        return;
      case CMD.READ_REG: {
        const addr = new DataView(data.buffer).getUint32(0, true);
        const v = this.chipDef.regs[addr];
        this._push(reply(CMD.READ_REG, v === undefined ? 0 : v));
        return;
      }
      case CMD.WRITE_REG: this._push(reply(CMD.WRITE_REG, 0)); return;
      case CMD.GET_SECURITY_INFO: {
        const si = this.chipDef.securityInfo, p = new Uint8Array(20), dv2 = new DataView(p.buffer);
        dv2.setUint32(0, si.flags, true); dv2.setUint32(12, si.chipId, true); dv2.setUint32(16, 0, true);   // flags, flash_crypt_cnt, key purposes, chip id, api version
        this._push(reply(CMD.GET_SECURITY_INFO, 0, [0, 0], Array.from(p)));
        return;
      }
      case CMD.MEM_BEGIN:
      case CMD.ERASE_FLASH:
      case CMD.FLASH_BEGIN:
        // The stub upload, the erase and the write start here. The fake ends at chip identification: answer with
        // an error status so esptool-js fails fast with a recognisable message instead of timing out. Nothing
        // after this point is simulated; erase and write are verified on a board.
        this.refused = this.refused || cmd;
        this._push(reply(cmd, 0, [1, 0x05]));
        return;
      default: this._push(reply(cmd, 0)); return;
    }
  }
}
