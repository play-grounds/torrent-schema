// NIP-35 of schema/nostr.jsonld: a kind 2003 event read by the schema — its tags as fields, by key and by position —
// the magnet it yields, the projection of a MetaInfo onto it, and the rules by error code. The id is recomputed
// (NIP-01); the signature is not checked here, there is no secp256k1 in this repo.
import { sha256, bytesToHex, utf8 } from './hash.js';
import { TorrentCodec } from './codec.js';
const shortId = (id) => String(id).replace(/^bt:/, '');
const SCHEMES = new Set(['udp:', 'http:', 'https:', 'ws:', 'wss:']);
export class NostrCodec {
  constructor(...docs) {
    this.structs = new Map(); this.enums = new Map();
    for (const d of docs) for (const e of d['@graph'] ?? []) { if (e['@type'] === 'Struct') this.structs.set(shortId(e['@id']), e); if (e['@type'] === 'Enumeration') this.enums.set(shortId(e['@id']), e); }
    if (!this.structs.has('TorrentEvent')) throw new Error('schema/nostr.jsonld not loaded');
  }
  /** a tag-encoded struct read from an event's tags (or, for a struct with positions, from one tag) */
  fromTags(name, tags) {
    const s = this.structs.get(shortId(name)); const out = {}; const used = new Set();
    for (const f of s.fields) {
      if (f.position !== undefined) { const v = tags[f.position]; if (v === undefined) { if (f.required) throw new Error(`${s.label}: position ${f.position} is required`); continue; } out[f.label] = f.valueType === 'int' ? Number(v) : v; continue; }
      used.add(f.key); const mine = tags.filter((t) => t[0] === f.key);
      if (!mine.length) { if (f.required) throw new Error(`${s.label}: '${f.key}' tag is required`); continue; }
      if (f.valueType === 'list') out[f.label] = mine.map((t) => f.itemType === 'struct' ? this.fromTags(f.structType, t) : t[1]);
      else out[f.label] = f.valueType === 'int' ? Number(mine[0][1]) : mine[0][1];
    }
    if (used.size) { const extra = tags.filter((t) => !used.has(t[0])); if (extra.length) out.extra = extra; }
    return out;
  }
  /** a kind 2003 event as a TorrentEvent instance, with the envelope kept beside it */
  read(event) { return { ...this.fromTags('TorrentEvent', event.tags ?? []), content: event.content, id: event.id, pubkey: event.pubkey, created_at: event.created_at }; }
  /** the inverse: tags from an instance, in schema order; extra tags appended as they were */
  toTags(name, inst) {
    const s = this.structs.get(shortId(name)); const tags = [];
    for (const f of s.fields) { const v = inst[f.label]; if (v === undefined || v === null) continue;
      if (f.valueType === 'list') for (const x of v) tags.push(f.itemType === 'struct' ? [f.key, ...this.positional(f.structType, x)] : [f.key, String(x)]); else tags.push([f.key, String(v)]); }
    for (const t of inst.extra ?? []) tags.push(t); return tags;
  }
  positional(name, inst) { const s = this.structs.get(shortId(name)); const out = []; for (const f of s.fields) if (f.position !== undefined && inst[f.label] !== undefined) out[f.position - 1] = String(inst[f.label]); return out; }
  /** NIP-01: the id as the schema derives it */
  async id(event) { return bytesToHex(await sha256(utf8.encode(JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content])))); }
  /** the derived magnet: btih, dn, tr — and nothing for web seeds, the event has no place for them */
  magnet(inst) { const enc = encodeURIComponent; return `magnet:?xt=urn:btih:${inst.x}&dn=${enc(inst.title)}` + (inst.tracker ?? []).map((t) => `&tr=${enc(t)}`).join(''); }
  /** the projection of a parsed .torrent (TorrentCodec.parse) onto a TorrentEvent: what survives, as an instance */
  fromMetaInfo({ meta, infohash }, { title } = {}) {
    const info = meta.info; const files = info.files ? info.files.map((f) => ({ name: [info.name, ...f.path].join('/'), size: Number(f.length) })) : [{ name: info.name, size: Number(info.length) }];
    const trackers = meta['announce-list']?.flat() ?? (meta.announce ? [meta.announce] : []);
    const out = { title: title ?? info.name, x: infohash, file: files }; if (trackers.length) out.tracker = trackers; return out;
  }
  /** the rules of nostrRules, by error code: the first failure or null; `torrent` (parsed) enables the cross-check */
  async check(event, { torrent } = {}) {
    if (event.kind !== 2003) return 'nostr-bad-kind';
    const tags = event.tags ?? []; const xs = tags.filter((t) => t[0] === 'x'); if (xs.length !== 1 || !/^[0-9a-f]{40}$/.test(xs[0][1] ?? '')) return 'nostr-bad-x';
    const title = tags.find((t) => t[0] === 'title'); if (!title || !String(title[1] ?? '').trim()) return 'nostr-no-title';
    for (const t of tags) {
      if (t[0] === 'file' && (t.length < 2 || (t[2] !== undefined && !/^[0-9]+$/.test(t[2])))) return 'nostr-bad-file';
      if (t[0] === 'tracker') { let u; try { u = new URL(t[1]); } catch { return 'nostr-bad-tracker'; } if (!SCHEMES.has(u.protocol)) return 'nostr-bad-tracker'; }
      if (t[0] === 'i' && !/^[^:]+:./.test(t[1] ?? '')) return 'nostr-bad-reference';
    }
    if (event.id !== undefined && event.id !== await this.id(event)) return 'nostr-bad-id';
    if (torrent) { const inst = this.read(event); if (inst.x !== torrent.infohash) return 'nostr-torrent-mismatch';
      const mine = this.fromMetaInfo(torrent).file; const total = TorrentCodec.totalLength(torrent.meta.info);
      for (const f of inst.file ?? []) { if (f.name === '.') { if (f.size !== undefined && f.size !== total) return 'nostr-torrent-mismatch'; continue; } const m = mine.find((x) => x.name === f.name); if (!m || (f.size !== undefined && f.size !== m.size)) return 'nostr-torrent-mismatch'; } }
    return null;
  }
  /** each 'i' reference split, with its prefix looked up in ReferencePrefix: { prefix, id, known } */
  references(inst) { const known = new Set((this.enums.get('ReferencePrefix')?.members ?? []).map((m) => m.label)); return (inst.i ?? []).map((r) => { const [prefix, ...rest] = r.split(':'); return { prefix, id: rest.join(':'), known: known.has(prefix) }; }); }
}
