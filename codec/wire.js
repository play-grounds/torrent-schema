// The peer wire protocol of schema/wire.jsonld: the handshake, frames, every message by its id, the extension protocol
// (the extended handshake, ut_metadata with its trailing bytes, ut_pex). Streams arrive in pieces, so `feed` buffers
// and yields whole frames; nothing here touches a socket.
import { TorrentCodec } from './codec.js';
import { BinaryCodec } from './binary.js';
import { decode as bdecode, encode as bencode } from './bencode.js';
import { hexToBytes, bytesToHex } from './hash.js';
const MSG = { 0: 'choke', 1: 'unchoke', 2: 'interested', 3: 'not interested', 4: 'Have', 5: 'Bitfield', 6: 'Request', 7: 'Piece', 8: 'Cancel', 9: 'Port', 20: 'Extended' };
const ID = Object.fromEntries(Object.entries(MSG).map(([k, v]) => [v, Number(k)]));
const cat = (parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
export class WireCodec {
  constructor(...docs) { this.bencoded = new TorrentCodec(...docs); this.binary = new BinaryCodec(...docs); }
  // ---- the handshake
  handshake({ info_hash, peer_id, extensions = true, dht = false, fast = false }) { const r = new Uint8Array(8); if (extensions) r[5] |= 0x10; if (dht) r[7] |= 0x01; if (fast) r[7] |= 0x04; return this.binary.encode('Handshake', { reserved: bytesToHex(r), info_hash, peer_id }); }
  readHandshake(bytes) { if (bytes.length < 68) return { error: 'binary-short' }; try { const h = this.binary.decode('Handshake', bytes.subarray(0, 68)); const r = hexToBytes(h.reserved); return { handshake: h, supports: { extensions: !!(r[5] & 0x10), dht: !!(r[7] & 0x01), fast: !!(r[7] & 0x04) }, rest: bytes.subarray(68), error: null }; } catch { return { error: 'wire-bad-handshake' }; } }
  // ---- frames
  frame(name, payload = {}) { if (name === 'keep-alive') return new Uint8Array(4); const id = ID[name]; if (id === undefined) throw new Error(`no message ${name}`); const body = id <= 3 ? new Uint8Array(0) : this.binary.encode(name, payload); const out = new Uint8Array(5 + body.length); new DataView(out.buffer).setUint32(0, 1 + body.length); out[4] = id; out.set(body, 5); return out; }
  /** a buffer of stream bytes → the whole frames in it, decoded, and the bytes left over */
  feed(bytes, { maxLength = 13 + 16384 } = {}) {
    const messages = []; let pos = 0; const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    while (pos + 4 <= bytes.length) { const len = dv.getUint32(pos); if (len > maxLength) return { messages, rest: bytes.subarray(pos), error: 'wire-frame-too-long' }; if (pos + 4 + len > bytes.length) break;
      if (len === 0) { messages.push({ name: 'keep-alive' }); pos += 4; continue; }
      const id = bytes[pos + 4], body = bytes.subarray(pos + 5, pos + 4 + len); const name = MSG[id] ?? `unknown-${id}`;
      const m = { name, id }; if (id >= 4 && MSG[id]) { try { Object.assign(m, this.binary.decode(name, body)); } catch (e) { m.error = e.code ?? 'binary-short'; } } else if (!MSG[id]) m.payload = bytesToHex(body);
      messages.push(m); pos += 4 + len; }
    return { messages, rest: bytes.subarray(pos), error: null };
  }
  // ---- the bitfield
  bitfield(have, pieceCount) { const out = new Uint8Array(Math.ceil(pieceCount / 8)); for (const i of have) out[i >> 3] |= 0x80 >> (i & 7); return bytesToHex(out); }
  pieces(bitsHex, pieceCount) { const b = hexToBytes(bitsHex); if (b.length !== Math.ceil(pieceCount / 8)) return { error: 'wire-bad-bitfield' }; const have = []; for (let i = 0; i < pieceCount; i++) if (b[i >> 3] & (0x80 >> (i & 7))) have.push(i); for (let i = pieceCount; i < b.length * 8; i++) if (b[i >> 3] & (0x80 >> (i & 7))) return { error: 'wire-bad-bitfield' }; return { have, error: null }; }
  // ---- the extension protocol (BEP 10): the extended handshake, then messages under the ids the receiver named
  extendedHandshake(inst) { return this.frame('Extended', { ext_id: 0, payload: bytesToHex(this.bencoded.encode('ExtendedHandshake', inst)) }); }
  /** an Extended message's payload read as the handshake (ext_id 0) or as a named extension; ut_metadata keeps the bytes after its dictionary */
  readExtended(m, names = {}) {
    const payload = hexToBytes(m.payload); let dec; try { dec = bdecode(payload, { strict: false }); } catch { return { error: 'bencode-bad-token' }; }
    const span = dec.spans.get(dec.value); const trailing = span ? payload.subarray(span[1]) : new Uint8Array(0);
    if (m.ext_id === 0) return { kind: 'handshake', value: this.bencoded.fromValue('ExtendedHandshake', dec.value), error: null };
    const name = names[m.ext_id]; if (!name) return { kind: 'unknown', ext_id: m.ext_id, error: 'wire-extension-unsupported' };
    if (name === 'ut_metadata') return { kind: name, value: this.bencoded.fromValue('UtMetadata', dec.value), data: trailing, error: null };
    if (name === 'ut_pex') return { kind: name, value: this.bencoded.fromValue('UtPex', dec.value), error: null };
    return { kind: name, raw: dec.value, error: null };
  }
  utMetadata(ext_id, inst, data = null) { const dict = this.bencoded.encode('UtMetadata', inst); return this.frame('Extended', { ext_id, payload: bytesToHex(data ? cat([dict, data]) : dict) }); }
}
export { bencode };
