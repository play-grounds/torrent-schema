// The fixed-layout codec: schema/tracker.jsonld's binary structs (and the peer wire protocol later) in code, with no
// per-struct logic. It walks a Struct's `fields` and reads or writes each by its wireType: big-endian integers of a
// width, fixed-size byte strings, IPv4/IPv6 addresses, a nested struct, the rest of the message; `repeat: toEnd` reads
// a field as many times as the bytes allow. Values: integers as Number (u64 as BigInt), bytes as hex, addresses as text.
import { bytesToHex, hexToBytes, utf8 } from './hash.js';
const shortId = (id) => String(id).replace(/^bt:/, '');
const SIZES = { u8: 1, u16be: 2, u32be: 4, i32be: 4, u64be: 8, i64be: 8, bytes20: 20, ip4: 4, ip6: 16 };
const ip4 = { read: (b) => Array.from(b).join('.'), write: (s) => Uint8Array.from(s.split('.').map(Number)) };
const ip6 = { read: (b) => { const h = []; for (let i = 0; i < 16; i += 2) h.push(((b[i] << 8) | b[i + 1]).toString(16)); return h.join(':'); },
  write: (s) => { const parts = s.split('::'); const head = parts[0] ? parts[0].split(':') : [], tail = parts[1] ? parts[1].split(':') : []; const full = [...head, ...Array(8 - head.length - tail.length).fill('0'), ...tail]; const out = new Uint8Array(16); full.forEach((h, i) => { const v = parseInt(h, 16); out[2 * i] = v >> 8; out[2 * i + 1] = v & 255; }); return out; } };

export class BinaryCodec {
  constructor(...docs) { this.structs = new Map(); for (const d of docs) for (const e of d['@graph'] ?? []) if (e['@type'] === 'Struct' && String(e.encoding).endsWith('binary')) this.structs.set(shortId(e['@id']), e); }
  struct(name) { const s = this.structs.get(shortId(name)); if (!s) throw new Error(`no binary struct ${name}`); return s; }
  decode(name, bytes, { check = true } = {}) { const r = this.read(name, bytes, 0, bytes.length, check); if (r.pos !== bytes.length) throw Object.assign(new Error(`${name}: ${bytes.length - r.pos} byte(s) left over`), { code: 'binary-trailing' }); return r.value; }
  read(name, bytes, pos, end, check) {
    const s = this.struct(name); const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); const out = {};
    const need = (n, f) => { if (pos + n > end) throw Object.assign(new Error(`${s.label}: short at '${f.label}' (need ${n}, have ${end - pos})`), { code: 'binary-short' }); };
    const one = (f) => {
      const t = f.wireType;
      if (t === 'struct') { const r = this.read(f.structType, bytes, pos, end, check); pos = r.pos; return r.value; }
      if (t === 'rest' || t === 'utf8rest') { const b = bytes.subarray(pos, end); pos = end; return t === 'rest' ? bytesToHex(b) : utf8.decode(b); }
      const n = SIZES[t]; if (!n) throw new Error(`unknown wireType ${t} on '${f.label}'`); need(n, f); const at = pos; pos += n;
      if (t === 'u8') return bytes[at]; if (t === 'u16be') return dv.getUint16(at); if (t === 'u32be') return dv.getUint32(at); if (t === 'i32be') return dv.getInt32(at);
      if (t === 'u64be') { const v = dv.getBigUint64(at); return v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v; } if (t === 'i64be') { const v = dv.getBigInt64(at); return v <= BigInt(Number.MAX_SAFE_INTEGER) && v >= -BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v; }
      if (t === 'bytes20') return bytesToHex(bytes.subarray(at, at + 20)); if (t === 'ip4') return ip4.read(bytes.subarray(at, at + 4)); if (t === 'ip6') return ip6.read(bytes.subarray(at, at + 16));
    };
    for (const f of s.fields) {
      if (f.repeat === 'toEnd') { const items = []; while (pos < end) items.push(one(f)); out[f.label] = items; continue; }
      const v = one(f); out[f.label] = v;
      if (check && f.constValue !== undefined) { const c = typeof f.constValue === 'string' ? BigInt(f.constValue) : BigInt(f.constValue); if (BigInt(v) !== c) throw Object.assign(new Error(`${s.label}: '${f.label}' is ${v}, not ${f.constValue}`), { code: 'binary-const' }); }
    }
    return { value: out, pos };
  }
  encode(name, inst) { const parts = []; this.write(name, inst, parts); const n = parts.reduce((a, p) => a + p.length, 0); const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; }
  write(name, inst, parts) {
    const s = this.struct(name);
    const one = (f, v) => {
      const t = f.wireType; if (v === undefined && f.constValue !== undefined) v = typeof f.constValue === 'string' ? BigInt(f.constValue) : f.constValue;
      if (t === 'struct') return this.write(f.structType, v, parts);
      if (t === 'rest') return parts.push(hexToBytes(v)); if (t === 'utf8rest') return parts.push(utf8.encode(v));
      if (t === 'bytes20') { const b = hexToBytes(v); if (b.length !== 20) throw new Error(`'${f.label}': 20 bytes needed`); return parts.push(b); }
      if (t === 'ip4') return parts.push(ip4.write(v)); if (t === 'ip6') return parts.push(ip6.write(v));
      const n = SIZES[t]; const b = new Uint8Array(n); const dv = new DataView(b.buffer);
      if (t === 'u8') b[0] = Number(v); else if (t === 'u16be') dv.setUint16(0, Number(v)); else if (t === 'u32be') dv.setUint32(0, Number(v) >>> 0); else if (t === 'i32be') dv.setInt32(0, Number(v)); else if (t === 'u64be') dv.setBigUint64(0, BigInt(v)); else if (t === 'i64be') dv.setBigInt64(0, BigInt(v)); else throw new Error(`unknown wireType ${t}`);
      parts.push(b);
    };
    for (const f of s.fields) { const v = inst[f.label]; if (f.repeat === 'toEnd') { for (const x of v ?? []) one(f, x); continue; } if (v === undefined && f.constValue === undefined) throw new Error(`${s.label}: '${f.label}' is needed`); one(f, v); }
  }
}
