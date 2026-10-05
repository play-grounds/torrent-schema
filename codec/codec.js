// The schema-driven metainfo codec: no per-field code. It walks a Struct's `fields` in schema/metainfo.jsonld, reads
// each by its bencode `key`, converts by `valueType` (utf8 → string, int → number, hashes → a list of 40-hex, list →
// array by itemType, struct → recurse), keeps unknown keys under `extra` so a file re-encodes byte-exactly, and
// computes the `derived` properties — the infohash over the info dictionary's own bytes from the file.
import { decode, encode } from './bencode.js';
import { sha1, bytesToHex, hexToBytes, utf8 } from './hash.js';
import { BinaryCodec } from './binary.js';

const shortId = (id) => String(id).replace(/^bt:/, '').replace(/^.*\//, '');

export class TorrentCodec {
  constructor(...docs) {
    this.structs = new Map(); this.rules = new Map(); this.docs = docs;
    for (const d of docs) for (const e of d['@graph'] ?? []) { if (e['@type'] === 'Struct') this.structs.set(shortId(e['@id']), e); if (e['@type'] === 'RuleSet') this.rules.set(shortId(e['@id']), e); }
  }
  struct(name) { const s = this.structs.get(shortId(name)); if (!s) throw new Error(`no struct ${name} in the schema`); return s; }

  // ---- bencode value → instance, by the schema
  fromValue(name, v, dec = null) {
    const s = this.struct(name); if (!(v instanceof Map)) throw new Error(`${s.label}: not a dictionary`);
    const out = {}; const used = new Set();
    for (const f of s.fields) {
      used.add(f.key); const raw = v.get(f.key);
      if (raw === undefined) { if (f.required) throw new Error(`${s.label}: '${f.key}' is required`); continue; }
      out[f.label] = this.convert(f, raw, dec);
    }
    const extra = [...v.keys()].filter((k) => !used.has(k)); if (extra.length) out.extra = Object.fromEntries(extra.map((k) => [k, v.get(k)]));
    if (dec?.raw) { const span = dec.raw(v); if (span) Object.defineProperty(out, '_raw', { value: span, enumerable: false }); }
    return out;
  }
  convert(f, raw, dec) {
    const t = f.valueType;
    if (t === 'int') { if (typeof raw !== 'number' && typeof raw !== 'bigint') throw new Error(`'${f.key}': not an integer`); return raw; }
    if (t === 'utf8') { if (!(raw instanceof Uint8Array)) throw new Error(`'${f.key}': not a string`); return utf8.decode(raw); }
    if (t === 'bytes') { if (!(raw instanceof Uint8Array)) throw new Error(`'${f.key}': not a string`); return bytesToHex(raw); }
    if (t === 'hashes') { if (!(raw instanceof Uint8Array)) throw new Error(`'${f.key}': not a string`); if (raw.length % 20) throw new Error(`'${f.key}': ${raw.length} bytes is not a whole number of 20-byte hashes`); const out = []; for (let i = 0; i < raw.length; i += 20) out.push(bytesToHex(raw.subarray(i, i + 20))); return out; }
    if (t === 'struct') return this.fromValue(f.structType, raw, dec);
    if (t === 'peers' || t === 'peers6') { // compact bytes (6 or 18 a peer), or a list of Peer dictionaries
      if (raw instanceof Uint8Array) { const n = t === 'peers' ? 6 : 18; if (raw.length % n) throw Object.assign(new Error(`'${f.key}': ${raw.length} bytes is not a whole number of ${n}-byte peers`), { code: 'tracker-bad-peers' });
        const bin = this.binary ?? (this.binary = new BinaryCodec(...this.docs)); const out = []; for (let i = 0; i < raw.length; i += n) out.push(bin.decode(t === 'peers' ? 'CompactPeer' : 'CompactPeer6', raw.subarray(i, i + n))); return out; }
      if (Array.isArray(raw)) return raw.map((x) => this.fromValue('Peer', x, dec)); throw new Error(`'${f.key}': neither compact bytes nor a list`); }
    if (t === 'dict') { if (!(raw instanceof Map)) throw new Error(`'${f.key}': not a dictionary`); const out = {}; for (const [k, v] of raw) out[bytesToHex(Uint8Array.from(k, (c) => c.charCodeAt(0)))] = f.itemType === 'struct' ? this.fromValue(f.structType, v, dec) : v; return out; }
    if (t === 'list') { const items = Array.isArray(raw) ? raw : raw instanceof Uint8Array && f.itemType === 'utf8' ? [raw] : null; if (!items) throw new Error(`'${f.key}': not a list`);
      const item = String(f.itemType); const inner = item.startsWith('list:') ? { valueType: 'list', itemType: item.slice(5), key: f.key } : item === 'struct' ? { valueType: 'struct', structType: f.structType, key: f.key } : { valueType: item, key: f.key };
      return items.map((x) => this.convert(inner, x, dec)); }
    throw new Error(`unknown valueType ${t} on '${f.key}'`);
  }
  // ---- instance → bencode value, by the schema (the inverse of fromValue; `extra` keys re-emitted as they were)
  toValue(name, inst) {
    const s = this.struct(name); const m = new Map();
    for (const f of s.fields) { const v = inst[f.label]; if (v === undefined || v === null) continue; m.set(f.key, this.unconvert(f, v)); }
    for (const [k, v] of Object.entries(inst.extra ?? {})) m.set(k, v);
    return m;
  }
  unconvert(f, v) {
    const t = f.valueType;
    if (t === 'int') return v; if (t === 'utf8') return utf8.encode(v); if (t === 'bytes') return hexToBytes(v);
    if (t === 'hashes') { const out = new Uint8Array(v.length * 20); v.forEach((h, i) => out.set(hexToBytes(h), i * 20)); return out; }
    if (t === 'struct') return this.toValue(f.structType, v);
    if (t === 'peers' || t === 'peers6') { const bin = this.binary ?? (this.binary = new BinaryCodec(...this.docs)); const n = t === 'peers' ? 6 : 18; const out = new Uint8Array(v.length * n); v.forEach((p, i) => out.set(bin.encode(t === 'peers' ? 'CompactPeer' : 'CompactPeer6', p), i * n)); return out; }
    if (t === 'dict') { const m = new Map(); for (const [k, x] of Object.entries(v)) m.set(String.fromCharCode(...hexToBytes(k)), f.itemType === 'struct' ? this.toValue(f.structType, x) : x); return m; }
    if (t === 'list') { const item = String(f.itemType); const inner = item.startsWith('list:') ? { valueType: 'list', itemType: item.slice(5) } : item === 'struct' ? { valueType: 'struct', structType: f.structType } : { valueType: item }; return v.map((x) => this.unconvert(inner, x)); }
    throw new Error(`unknown valueType ${t}`);
  }

  decode(name, bytes, opts) { const dec = decode(bytes, opts); return this.fromValue(name, dec.value, dec); }
  encode(name, inst) { return encode(this.toValue(name, inst)); }

  // ---- the derived properties of metainfo.jsonld, computed as the schema says
  static pieceCount(info) { return info.pieces.length; }
  static totalLength(info) { return info.length ?? info.files.reduce((s, f) => s + Number(f.length), 0); }
  static lastPieceLength(info) { return TorrentCodec.totalLength(info) - (info.pieces.length - 1) * Number(info['piece length']); }
  /** the infohash: SHA-1 over the info dictionary's bytes as they stand in the file (its canonical bencoding) */
  async infohash(meta) { const raw = meta.info?._raw ?? encode(this.toValue('Info', meta.info)); return bytesToHex(await sha1(raw)); }
  magnet(meta, infohash) {
    const enc = encodeURIComponent; const trackers = meta['announce-list']?.flat() ?? (meta.announce ? [meta.announce] : []);
    return `magnet:?xt=urn:btih:${infohash}&dn=${enc(meta.info.name)}` + trackers.map((t) => `&tr=${enc(t)}`).join('') + (meta['url-list'] ?? []).map((w) => `&ws=${enc(w)}`).join('');
  }
  /** the metainfo rules, each by its errorCode: the first failure or null */
  check(meta) {
    const info = meta.info; if (!info) return 'metainfo-no-info';
    if (!info.pieces?.length) return 'metainfo-bad-pieces';
    if ((info.length != null) === (info.files != null)) return 'metainfo-length-xor-files';
    if (!(Number(info['piece length']) > 0)) return 'metainfo-bad-piece-length';
    if (info.pieces.length !== Math.ceil(TorrentCodec.totalLength(info) / Number(info['piece length']))) return 'metainfo-piece-count';
    return null;
  }
  /** everything about a .torrent in one call: the instance, the derived values, the check */
  async parse(bytes, opts) { const meta = this.decode('MetaInfo', bytes, opts); const infohash = await this.infohash(meta); const info = meta.info;
    return { meta, infohash, magnet: this.magnet(meta, infohash), pieceCount: TorrentCodec.pieceCount(info), totalLength: TorrentCodec.totalLength(info), lastPieceLength: TorrentCodec.lastPieceLength(info), error: this.check(meta) }; }
}
