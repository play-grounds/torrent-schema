// Bencode (BEP 3), byte-exact and canonical: schema/bencode.jsonld in code. Values decode to plain JavaScript — integers
// to Number (or BigInt past 2^53), byte strings to Uint8Array, lists to arrays, dictionaries to Maps keyed by their raw
// key bytes as latin1 strings (so any key round-trips) — and every value remembers the byte span it came from, which is
// how an infohash is computed over the info dictionary exactly as it appears in a file rather than over a re-encoding.
import { compareBytes } from './hash.js';

const latin1 = { decode: (b) => String.fromCharCode(...b), encode: (s) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff) };
const INT_RE = /^(0|-?[1-9][0-9]*)$/, LEN_RE = /^(0|[1-9][0-9]*)$/;

/** decode one bencoded document; strict (the default) enforces canonical form: integer form, sorted keys, nothing trailing */
export function decode(bytes, { strict = true } = {}) {
  const spans = new Map(); // value → [start, end) in bytes, for dictionaries and lists (the objects that can be identified)
  let pos = 0;
  const fail = (code, what) => { const e = new Error(`${code}: ${what} at byte ${pos}`); e.code = code; throw e; };
  const digitsUntil = (stop) => { const start = pos; while (pos < bytes.length && bytes[pos] !== stop) pos++; if (pos >= bytes.length) fail('bencode-truncated', 'unterminated number'); const s = latin1.decode(bytes.subarray(start, pos)); pos++; return s; };
  const value = () => {
    if (pos >= bytes.length) fail('bencode-truncated', 'unexpected end');
    const c = bytes[pos];
    if (c === 0x69) { pos++; const s = digitsUntil(0x65); if (!INT_RE.test(s)) fail('bencode-bad-integer', `'${s}'`); const n = Number(s); return Number.isSafeInteger(n) ? n : BigInt(s); }
    if (c === 0x6c) { const start = pos++; const out = []; while (bytes[pos] !== 0x65) { if (pos >= bytes.length) fail('bencode-truncated', 'unterminated list'); out.push(value()); } pos++; spans.set(out, [start, pos]); return out; }
    if (c === 0x64) { const start = pos++; const out = new Map(); let prev = null;
      while (bytes[pos] !== 0x65) { if (pos >= bytes.length) fail('bencode-truncated', 'unterminated dictionary'); const k = value(); if (!(k instanceof Uint8Array)) fail('bencode-bad-key', 'a key is not a string');
        if (strict && prev && compareBytes(prev, k) >= 0) fail('bencode-keys-unsorted', `'${latin1.decode(k)}' after '${latin1.decode(prev)}'`); prev = k; out.set(latin1.decode(k), value()); }
      pos++; spans.set(out, [start, pos]); return out; }
    if (c >= 0x30 && c <= 0x39) { const s = digitsUntil(0x3a); if (!LEN_RE.test(s)) fail('bencode-bad-string', `length '${s}'`); const n = Number(s); if (pos + n > bytes.length) fail('bencode-truncated', `string of ${n} bytes`); const out = bytes.subarray(pos, pos + n); pos += n; return out; }
    fail('bencode-bad-token', `byte 0x${c.toString(16)}`);
  };
  const v = value();
  if (strict && pos !== bytes.length) fail('bencode-trailing-bytes', `${bytes.length - pos} byte(s) after the document`);
  return { value: v, spans, raw: (x) => { const s = spans.get(x); return s ? bytes.subarray(s[0], s[1]) : null; } };
}

/** encode a value canonically: dictionaries sorted by raw key bytes whatever order the Map holds them in */
export function encode(v) {
  const parts = []; const push = (b) => parts.push(typeof b === 'string' ? latin1.encode(b) : b);
  const walk = (x) => {
    if (typeof x === 'number' || typeof x === 'bigint') { if (typeof x === 'number' && !Number.isInteger(x)) throw new Error('bencode: not an integer'); push(`i${x}e`); }
    else if (x instanceof Uint8Array) { push(`${x.length}:`); push(x); }
    else if (typeof x === 'string') { const b = new TextEncoder().encode(x); push(`${b.length}:`); push(b); }
    else if (Array.isArray(x)) { push('l'); for (const y of x) walk(y); push('e'); }
    else if (x instanceof Map || (x && typeof x === 'object')) { push('d'); const entries = x instanceof Map ? [...x.entries()] : Object.entries(x);
      const keyed = entries.map(([k, val]) => [typeof k === 'string' ? latin1.encode(k) : k, val]).sort((a, b) => compareBytes(a[0], b[0]));
      for (const [k, val] of keyed) { push(`${k.length}:`); push(k); walk(val); } push('e'); }
    else throw new Error(`bencode: cannot encode ${typeof x}`);
  };
  walk(v);
  const n = parts.reduce((s, p) => s + p.length, 0); const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out;
}
export const keyBytes = latin1.encode;
