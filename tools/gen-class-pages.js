#!/usr/bin/env node
// One page per node of the schema — every Struct, Enumeration, RuleSet, Encoding and Module — at the path its IRI
// names (bt:Handshake is https://torrent-schema.github.io/Handshake; GitHub Pages serves Handshake.html for it), so
// every term dereferences. Each page carries a JSON-LD island with the node's definition verbatim and, where one was
// captured, a real instance: the bytes, the decoded value, the field spans, the derived values and the rule result,
// all computed here through the codec. The HTML is rendered from the same island, so the page reads without
// JavaScript; apps/class.js then re-decodes the bytes in the visitor's browser and says whether it agrees.
//   node tools/gen-class-pages.js          -> <Node>.html for every node, terms.json, 404.html
//   node tools/gen-og.js                   -> og/<Node>.png (chromium), run after
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { TorrentCodec } from '../codec/codec.js';
import { BinaryCodec } from '../codec/binary.js';
import { TrackerCodec } from '../codec/tracker.js';
import { WireCodec } from '../codec/wire.js';
import { WebTorrentCodec, fromBinary } from '../codec/webtorrent.js';
import { NostrCodec } from '../codec/nostr.js';
import { bytesToHex, sha256, utf8 } from '../codec/hash.js';

const root = new URL('..', import.meta.url);
const SITE = 'https://torrent-schema.github.io/';
export const MODULES = ['bencode', 'metainfo', 'tracker', 'wire', 'webseed', 'webtorrent', 'nostr'];
const short = (id) => String(id).replace(/^bt:/, '');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const load = async (p) => JSON.parse(await readFile(new URL(p, root), 'utf8'));
const bin = async (p) => new Uint8Array(await readFile(new URL(p, root)));
const pkg = await load('package.json');
const docs = await Promise.all(MODULES.map((m) => load(`schema/${m}.jsonld`)));
const nodes = []; const byId = new Map();
for (const [i, d] of docs.entries()) for (const n of d['@graph']) { const mod = d['@graph'].find((x) => x['@type'] === 'Module'); nodes.push({ node: n, module: MODULES[i], mod }); if (byId.has(short(n['@id']))) throw new Error(`two nodes named ${n['@id']}`); byId.set(short(n['@id']), n); }
const codec = new TorrentCodec(...docs), binary = new BinaryCodec(...docs), tracker = new TrackerCodec(...docs), wire = new WireCodec(...docs), wt = new WebTorrentCodec(...docs), nostr = new NostrCodec(...docs);
const SIZES = { u8: 1, u16be: 2, u32be: 4, i32be: 4, u64be: 8, i64be: 8, bytes20: 20, ip4: 4, ip6: 16 };
const json = (v) => JSON.stringify(v, (k, x) => typeof x === 'bigint' ? x.toString() : x instanceof Uint8Array ? bytesToHex(x) : x);
const plain = (v) => JSON.parse(json(v));

// ---- field spans of a binary struct instance: [label, start, end] for each field, nested structs flattened with a path
function spans(name, bytes, pos = 0, end = bytes.length, path = '') {
  const s = binary.struct(name); const out = [];
  const one = (f, label) => { const t = f.wireType; const start = pos;
    if (t === 'struct') { out.push(...spans(f.structType, bytes, pos, end, label + '.')); pos = out.at(-1)?.[2] ?? pos; return; }
    if (t === 'rest' || t === 'utf8rest') pos = end; else if (t === 'bytes') pos += f.size; else pos += SIZES[t];
    out.push([label, start, pos]); };
  for (const f of s.fields) { if (f.repeat === 'toEnd') { let i = 0; while (pos < end) one(f, `${path}${f.label}[${i++}]`); } else one(f, path + f.label); }
  return out;
}
const bytesOf = (name, b) => ({ bytes: bytesToHex(b), value: plain(binary.decode(name, b)), spans: spans(name, b) });

// ---- the captured instances, one per struct where one exists
async function instances() {
  const I = {}; const vec = (p) => bin('test/vectors/' + p);
  const snapshotBytes = await vec('utxo-knots-150307.torrent'); const snapshot = await codec.parse(snapshotBytes);
  const bbbBytes = await bin('data/torrents/big-buck-bunny.torrent'); const bbb = await codec.parse(bbbBytes);
  const metaValue = (t) => plain({ ...t.meta, info: { ...t.meta.info, pieces: t.meta.info.pieces } });
  I.MetaInfo = { source: 'test/vectors/utxo-knots-150307.torrent', captured: 'the .torrent of the txbt4 UTXO snapshot, made by WebTorrent 3 on 2026-09-14; 208 pieces of 4 MiB', bytes: bytesToHex(snapshotBytes), value: metaValue(snapshot),
    computed: { infohash: snapshot.infohash, magnet: snapshot.magnet }, result: snapshot.error };
  I.Info = { source: 'test/vectors/utxo-knots-150307.torrent', captured: "the 'info' dictionary of the snapshot torrent, the bytes the infohash is the SHA-1 of", bytes: bytesToHex(snapshot.meta.info._raw), value: plain(snapshot.meta.info),
    computed: { pieceCount: snapshot.pieceCount, totalLength: snapshot.totalLength, lastPieceLength: snapshot.lastPieceLength, 'sha1 of these bytes': snapshot.infohash }, result: snapshot.error };
  I.FileEntry = { source: 'data/torrents/big-buck-bunny.torrent', captured: `the first of ${bbb.meta.info.files.length} files of Big Buck Bunny, the WebTorrent demo torrent (a multi-file torrent: 'files' instead of 'length')`, value: plain(bbb.meta.info.files[0]), computed: { 'all files': bbb.meta.info.files.map((f) => f.path.join('/') + ' (' + f.length + ')') } };
  // tracker: opentrackr, captured byte for byte
  const annUrl = utf8.decode(await vec('tracker/httpAnnounceUrlCompact.bin'));
  const req = binary.decode('UdpAnnounceRequest', await vec('tracker/udpAnnounceRequest.bin'));
  I.AnnounceRequest = { source: 'test/vectors/tracker/httpAnnounceUrlCompact.bin', captured: 'the GET sent to tracker.opentrackr.org for the snapshot, as bytes on the wire (percent-encoding is per byte)', bytes: bytesToHex(utf8.encode(annUrl)), value: Object.fromEntries([...new URL(annUrl).searchParams].map(([k, v]) => [k, v])), computed: { url: annUrl } };
  const ann = tracker.parseAnnounce(await vec('tracker/httpAnnounceCompact.bin'));
  I.AnnounceResponse = { source: 'test/vectors/tracker/httpAnnounceCompact.bin', captured: "opentrackr's bencoded answer to that announce: counts, an interval, compact peers", bytes: bytesToHex(await vec('tracker/httpAnnounceCompact.bin')), value: plain(ann.response), result: ann.error };
  I.CompactPeer = { source: 'test/vectors/tracker/httpAnnounceCompact.bin', captured: "the first peer of that answer's 'peers' string: four bytes of address, two of port", ...bytesOf('CompactPeer', binary.encode('CompactPeer', ann.response.peers[0])) };
  const scr = tracker.parseScrape(await vec('tracker/httpScrape.bin'));
  I.ScrapeResponse = { source: 'test/vectors/tracker/httpScrape.bin', captured: "opentrackr's scrape for the snapshot's infohash", bytes: bytesToHex(await vec('tracker/httpScrape.bin')), value: plain(scr.response), result: scr.error };
  I.ScrapeEntry = { source: 'test/vectors/tracker/httpScrape.bin', captured: "the one entry of that scrape, keyed by infohash", value: plain(Object.values(scr.response.files)[0]) };
  for (const [name, f] of [['UdpConnectRequest', 'udpConnectRequest'], ['UdpConnectResponse', 'udpConnectResponse'], ['UdpAnnounceRequest', 'udpAnnounceRequest'], ['UdpAnnounceResponse', 'udpAnnounceResponse'], ['UdpScrapeRequest', 'udpScrapeRequest'], ['UdpScrapeResponse', 'udpScrapeResponse']])
    I[name] = { source: `test/vectors/tracker/${f}.bin`, captured: `the UDP ${name.includes('Request') ? 'datagram sent to' : 'datagram received from'} tracker.opentrackr.org:1337 for the snapshot, byte for byte`, ...bytesOf(name, await vec(`tracker/${f}.bin`)) };
  I.UdpScrapeCounts = { source: 'test/vectors/tracker/udpScrapeResponse.bin', captured: 'the twelve bytes of counts after the scrape response header', ...bytesOf('UdpScrapeCounts', (await vec('tracker/udpScrapeResponse.bin')).subarray(8, 20)) };
  const trackers = await load('data/trackers.jsonld'), torrents = await load('data/torrents.jsonld');
  I.Tracker = { source: 'data/trackers.jsonld', captured: 'the first entry of the known trackers list', value: trackers['@graph'].find((n) => n['@type'] === 'bt:Tracker') };
  I.KnownTorrent = { source: 'data/torrents.jsonld', captured: 'the known torrents entry for the snapshot', value: torrents['@graph'].find((n) => n['@type'] === 'bt:KnownTorrent') };
  // wire: the qBittorrent 5.3 session (libtorrent 2.1) and the webtorrent seeder session
  const hs = await vec('wire-qbittorrent/handshakeReceived.bin');
  I.Handshake = { source: 'test/vectors/wire-qbittorrent/handshakeReceived.bin', captured: 'the 68 bytes qBittorrent 5.3.0rc1 (libtorrent 2.1) sent first, seeding the snapshot over TCP', ...bytesOf('Handshake', hs), computed: { 'reserved bits': plain(wire.readHandshake(hs).supports ?? wire.readHandshake(hs)) } };
  const reqFrame = await vec('wire/requestSent.bin'); I.Frame = { source: 'test/vectors/wire/requestSent.bin', captured: 'a whole frame as sent: 4 bytes of length, the id 6 (Request), 12 bytes of payload', ...bytesOf('Frame', reqFrame) };
  I.Request = { source: 'test/vectors/wire/requestSent.bin', captured: 'the payload of that frame: block 0 of piece 0, 16 KiB', ...bytesOf('Request', reqFrame.subarray(5)) };
  const bf = await vec('wire-qbittorrent/bitfieldReceived.bin'); I.Bitfield = { source: 'test/vectors/wire-qbittorrent/bitfieldReceived.bin', captured: "qBittorrent's bitfield for the snapshot: 208 pieces in 26 bytes, every bit set", ...bytesOf('Bitfield', bf.subarray(5)), computed: { 'pieces had': wire.pieces(bytesToHex(bf.subarray(5)), 208).have?.length ?? wire.pieces(bytesToHex(bf.subarray(5)), 208) } };
  const pc = await vec('wire/pieceReceived.bin'); I.Piece = { source: 'test/vectors/wire/pieceReceived.bin', captured: 'the first block of piece 0 of the snapshot from a webtorrent seeder: 8 bytes of index and offset, then 16,384 bytes of the UTXO set itself', ...bytesOf('Piece', pc.subarray(5)) };
  const ext = await vec('wire-qbittorrent/extendedHandshakeReceived.bin'); I.Extended = { source: 'test/vectors/wire-qbittorrent/extendedHandshakeReceived.bin', captured: "qBittorrent's extended handshake frame: id 20, extension id 0, a bencoded dictionary", ...bytesOf('Extended', ext.subarray(5)) };
  const eh = wire.readExtended(wire.feed(ext).messages[0]); I.ExtendedHandshake = { source: 'test/vectors/wire-qbittorrent/extendedHandshakeReceived.bin', captured: "the dictionary inside it: libtorrent's extensions by name and id, the metadata size, the client version", bytes: bytesToHex(ext.subarray(7)), value: plain(eh.value) };
  // webtorrent: the openwebtorrent session
  const S = await load('test/vectors/webtorrent/announce-session.json'); const sdpStrip = (m) => plain(m);
  const hexIds = (m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, ['info_hash', 'peer_id', 'offer_id', 'to_peer_id'].includes(k) ? fromBinary(v) : v]));
  I.WsAnnounce = { source: 'test/vectors/webtorrent/announce-session.json', captured: 'the announce this codec sent to tracker.openwebtorrent.com for the snapshot, carrying one WebRTC offer (ids shown as hex; on the wire they are 20-char binary strings)', value: { ...hexIds(sdpStrip(S.sent[0])), offers: S.sent[0].offers.map((o) => ({ offer: o.offer, offer_id: fromBinary(o.offer_id) })) } };
  I.WsOffer = { source: 'test/vectors/webtorrent/announce-session.json', captured: 'the offer in that announce', value: { offer: S.sent[0].offers[0].offer, offer_id: fromBinary(S.sent[0].offers[0].offer_id) } };
  I.SessionDescription = { source: 'test/vectors/webtorrent/announce-session.json', captured: "the browser's offer SDP as announced (addresses replaced by documentation addresses)", value: S.sent[0].offers[0].offer };
  I.WsAnnounceReply = { source: 'test/vectors/webtorrent/announce-session.json', captured: "the tracker's reply: counts and an interval, no peer list", value: hexIds(S.received[0]), result: wt.read(S.received[0], { announced: [S.infohash] }).error };
  I.WsAnswer = { source: 'test/vectors/webtorrent/announce-session.json', captured: "the seeder's answer as the tracker delivered it: 'to_peer_id' stripped in transit, the offer_id ours; the connection then reached 'connected'", value: hexIds(S.received[1]), result: wt.read(S.received[1], { announced: [S.infohash], outstanding: [S.offer_id] }).error };
  // webseed: the request the schema derives for block 0 at the snapshot's web seed
  const ws = wt.webSeedRequest('https://melvin.me/datstr/snapshots/utxo-knots-150307.dat', snapshot.meta.info, { index: 0, begin: 0, length: 16384 });
  I.WebSeedRequest = { source: 'test/vectors/utxo-knots-150307.torrent', captured: "not captured: derived from the snapshot torrent for block 0 at its web seed, as the schema says a peer must form it", value: { url: ws.url, headers: ws.headers }, computed: { first: ws.first, last: ws.last } };
  // nostr: the real kind 2003 event
  const E = await load('test/vectors/nostr/utxo-knots-150307.json'); const ev = nostr.read(E);
  I.NostrEvent = { source: 'test/vectors/nostr/utxo-knots-150307.json', captured: 'the kind 2003 event announcing the snapshot, as relays hold it', value: E, computed: { id: await nostr.id(E) }, result: await nostr.check(E, { torrent: snapshot }) };
  I.TorrentEvent = { source: 'test/vectors/nostr/utxo-knots-150307.json', captured: 'the same event read as a listing: its tags as fields', value: plain(ev), computed: { magnet: nostr.magnet(ev), fromMetaInfo: nostr.fromMetaInfo(snapshot), references: nostr.references(ev) }, result: await nostr.check(E, { torrent: snapshot }) };
  I.FileTag = { source: 'test/vectors/nostr/utxo-knots-150307.json', captured: "the event's one 'file' tag", value: ev.file[0] };
  return I;
}

// ---- rendering
const link = (id) => { const s = short(id); return byId.has(s) ? `<a href="${esc(s)}">${esc(s)}</a>` : esc(s); };
const typeOf = (f) => f.wireType ? (f.wireType === 'struct' ? link(f.structType) : esc(f.wireType)) + (f.repeat === 'toEnd' ? ' …to end' : '')
  : f.valueType === 'list' ? `list&lt;${String(f.itemType).startsWith('list:') ? `list&lt;${esc(String(f.itemType).slice(5))}&gt;` : f.itemType === 'struct' ? link(f.structType) : esc(f.itemType)}&gt;` : f.valueType === 'struct' ? link(f.structType) : esc(f.valueType);
const show = (v, depth = 0) => { if (v === undefined) return '<span class="mut">—</span>'; if (v === null) return 'null';
  if (Array.isArray(v)) { if (v.length > 6 && v.every((x) => typeof x === 'string' && /^[0-9a-f]{40}$/.test(x))) return `<code>${esc(v[0])}</code>, <code>${esc(v[1])}</code> … <span class="mut">${v.length} hashes</span>`; if (v.every((x) => typeof x === 'string' || typeof x === 'number')) return `<code class="pre">${esc(v.slice(0, 12).join('\n'))}</code>${v.length > 12 ? ` <span class="mut">… ${v.length} items</span>` : ''}`; if (v.length > 12) return `<code class="pre">${esc(json(v.slice(0, 12)))}</code> <span class="mut">… ${v.length} items</span>`; return `<code class="pre">${esc(JSON.stringify(v, null, 1))}</code>`; }
  if (typeof v === 'object') return `<code class="pre">${esc(JSON.stringify(v, null, 1))}</code>`;
  const s = String(v); if (/^[0-9a-f]{64,}$/.test(s) && s.length > 200) return `<code>${esc(s.slice(0, 96))}</code><span class="mut"> … ${s.length / 2} bytes</span>`; if (s.length > 600) return `<code class="pre">${esc(s.slice(0, 600))}</code><span class="mut"> … ${s.length} chars</span>`; return `<code class="pre">${esc(s)}</code>`; };
const valueOf = (inst, f) => inst?.value?.[f.label] ?? (f.key !== undefined ? inst?.value?.[f.key] : undefined);
const hexdump = (hex, sp) => { const b = hex.match(/../g) ?? []; const owner = new Array(b.length).fill(null); for (const [label, s, e] of sp ?? []) for (let i = s; i < e && i < b.length; i++) owner[i] = label;
  const max = 1024; const out = []; for (let i = 0; i < Math.min(b.length, max); i++) { const o = owner[i]; const prev = i ? owner[i - 1] : undefined; if (o !== prev && i) out.push('</span>'); if (o !== prev) out.push(`<span class="f" data-f="${esc(o ?? '')}" title="${esc(o ?? '')}">`); out.push(b[i] + ((i + 1) % 16 ? ' ' : '\n')); }
  out.push('</span>'); if (b.length > max) out.push(`<span class="mut">… ${b.length - max} more bytes</span>`); return out.join(''); };
const printable = (hex) => (hex.match(/../g) ?? []).slice(0, 2400).map((h) => { const c = parseInt(h, 16); return c >= 32 && c < 127 ? esc(String.fromCharCode(c)) : '·'; }).join('') + (hex.length > 4800 ? ` <span class="mut">… ${hex.length / 2} bytes</span>` : '');

function renderNode({ node, module, mod }, inst) {
  const type = node['@type']; const id = short(node['@id']); const binaryEnc = String(node.encoding ?? '').endsWith('binary'); const enc = short(node.encoding ?? '');
  const keyHead = enc === 'nostrTag' ? 'tag' : enc === 'json' || enc === 'nostrEvent' ? 'JSON key' : enc === 'urlquery' ? 'query key' : 'bencode key';
  let body = '';
  if (type === 'Struct') {
    const rows = node.fields.map((f) => `<tr id="${esc(short(f.property ?? f.label))}"><td class="name">${esc(f.label)}</td><td class="type">${f.position !== undefined ? `[${esc(f.position)}]` : binaryEnc ? esc(f.wireType === 'struct' ? '' : f.wireType) : esc(f.key ?? '')}</td><td class="type">${binaryEnc ? (f.constValue !== undefined ? '= ' + esc(f.constValue) : f.wireType === 'struct' ? link(f.structType) : '') : typeOf(f) + (f.required ? '' : '?')}</td><td class="desc">${f.presentIf ? `<b class="accent">if ${esc(f.presentIf)}:</b> ` : ''}${esc(f.comment ?? '')}${f.enumType ? ` <span class="mut">(one of ${link(f.enumType)})</span>` : ''}${f.bep ? ` <span class="mut">(BEP ${esc(f.bep)})</span>` : ''}</td>${inst ? `<td class="val" data-f="${esc(f.label)}">${show(valueOf(inst, f), 1)}</td>` : ''}</tr>`).join('');
    body += `<div class="card"><h2>fields</h2><table><tr><th>field</th><th>${binaryEnc ? 'wire type' : keyHead}</th><th>${binaryEnc ? 'constant / struct' : 'type'}</th><th>description</th>${inst ? '<th>in the instance</th>' : ''}</tr>${rows}</table>`;
    if (node.derived) body += `<div class="derived-label">derived (computed, never stored)</div><table><tr><th>value</th><th>derivation</th>${inst?.computed ? '<th>computed from the instance</th>' : ''}</tr>${node.derived.map((d) => `<tr id="${esc(short(d.property ?? d.label))}"><td class="name">${esc(d.label)}</td><td class="desc"><code>${esc(d.derivation)}</code>${d.comment ? `<br>${esc(d.comment)}` : ''}${d.bep ? ` <span class="mut">(BEP ${esc(d.bep)})</span>` : ''}</td>${inst?.computed ? `<td class="val">${show(inst.computed[d.label], 1)}</td>` : ''}</tr>`).join('')}</table>`;
    body += '</div>';
    if (inst) {
      const extraComputed = Object.entries(inst.computed ?? {}).filter(([k]) => !(node.derived ?? []).some((d) => d.label === k));
      body += `<div class="card" id="instance"><h2>a real instance</h2><p class="comment">${esc(inst.captured)}. Source: <a href="https://github.com/torrent-schema/torrent-schema.github.io/blob/gh-pages/${esc(inst.source)}">${esc(inst.source)}</a>. The values in the table above are read from it by the codec; the island at the foot of this page carries all of it.</p>`;
      if (inst.bytes) body += `<p class="tiny mut">${inst.bytes.length / 2} bytes${inst.spans ? ' · hover a field row or a byte to see which is which' : ''}</p><pre class="hex" id="hex">${hexdump(inst.bytes, inst.spans)}</pre>${!binaryEnc ? `<pre class="hex txt">${printable(inst.bytes)}</pre>` : ''}`;
      if (extraComputed.length) body += `<table><tr><th>computed</th><th>value</th></tr>${extraComputed.map(([k, v]) => `<tr><td class="name">${esc(k)}</td><td class="val">${show(v, 1)}</td></tr>`).join('')}</table>`;
      if (inst.result !== undefined) body += `<p class="rule-result">rules: ${inst.result === null ? '<span class="ok">all pass</span>' : `<span class="bad">${esc(inst.result)}</span>`}</p>`;
      body += `<p id="verify" class="tiny mut">JavaScript off: the values above were computed when this page was built. With it on, your browser decodes the bytes again through the codec and reports here.</p></div>`;
    } else body += `<div class="card"><h2>no captured instance yet</h2><p class="comment mut">No real ${esc(node.label)} has been captured into test/vectors/ so far; this page shows the definition only. The codec reads and writes it, and a capture is the next step.</p></div>`;
  } else if (type === 'Enumeration') {
    body += `<div class="card"><h2>${node.members.length} members</h2><table><tr>${node.members[0].code !== undefined ? '<th>code</th>' : ''}<th>member</th><th>description</th></tr>${node.members.map((m) => `<tr id="${esc(short(m['@id'] ?? m.label))}">${m.code !== undefined ? `<td class="type">${esc(m.code)}</td>` : ''}<td class="name">${esc(m.label)}</td><td class="desc">${esc(m.comment ?? '')}${m.bep ? ` <span class="mut">(BEP ${esc(m.bep)})</span>` : ''}</td></tr>`).join('')}</table></div>`;
    const users = nodes.filter((x) => x.node['@type'] === 'Struct' && (x.node.fields ?? []).some((f) => short(f.enumType ?? '') === id)); if (users.length) body += `<p class="comment">Used by ${users.map((u) => link(u.node['@id'])).join(', ')}.</p>`;
  } else if (type === 'RuleSet') {
    body += `<div class="card"><h2>${node.rules.length} rules · scope <b>${esc(node.scope)}</b></h2><table><tr><th>#</th><th>rule</th><th>error code</th><th>check</th></tr>${node.rules.map((r, i) => `<tr id="${esc(short(r['@id'] ?? r.label))}"><td class="name">${i + 1}</td><td class="desc">${esc(r.label)}</td><td class="type">${esc(r.errorCode)}</td><td class="desc"><code>${esc(r.check)}</code></td></tr>`).join('')}</table></div>`;
  } else if (type === 'Module') {
    const mine = nodes.filter((x) => x.module === module && x.node !== node);
    body += `<div class="card"><h2>in this module</h2><table><tr><th>node</th><th>kind</th><th>description</th></tr>${mine.map((x) => `<tr><td class="name">${link(x.node['@id'])}</td><td class="type">${esc(short(x.node['@type']))}${x.node.encoding ? ` · ${esc(short(x.node.encoding))}` : ''}</td><td class="desc">${esc(String(x.node.comment ?? '').split(/(?<=\.)\s/)[0])}</td></tr>`).join('')}</table><p class="comment tiny mut">The document itself: <a href="schema/${esc(module)}.jsonld">schema/${esc(module)}.jsonld</a></p></div>`;
  } else if (type === 'Encoding') {
    const users = nodes.filter((x) => short(x.node.encoding ?? '') === id); body += `<div class="card"><h2>structs in this encoding</h2><p class="comment">${users.length ? users.map((u) => link(u.node['@id'])).join(', ') : 'none yet'}</p></div>`;
  }
  const meta = [esc(short(type)), `module ${link(mod['@id'])}`, node.encoding ? `encoding ${link(node.encoding)}` : '', node.wireSize ? `<b>${esc(node.wireSize)} bytes</b> on the wire` : '', node.kind ? `<b>kind ${esc(node.kind)}</b>` : '', node.fields ? `${node.fields.length} fields` : '', node.bep ? `BEP ${esc([].concat(node.bep).join(', '))}` : '', node.layer ? `layer ${esc(node.layer)}` : '', node.version ? `v${esc(node.version)}` : ''].filter(Boolean).join(' · ');
  const island = { '@context': 'context.jsonld', '@graph': [node, ...(inst ? [{ '@id': `${id}#instance`, '@type': 'Instance', of: node['@id'], ...inst }] : [])] };
  const first = String(node.comment ?? '').split(/(?<=\.)\s/)[0]; const desc = (first.length > 280 ? first.slice(0, 277) + '…' : first);
  const title = `${node.label} — ${short(type)} of the ${module} module — Torrent Schema`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Torrent Schema">
<meta property="og:title" content="${esc(node.label)} — ${esc(short(type))}, ${esc(module)} module">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${SITE}${esc(id)}">
<meta property="og:image" content="${SITE}og/${esc(id)}.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(node.label)}: ${esc(short(type))} of the ${esc(module)} module of Torrent Schema${node.fields ? ', with its fields' : ''}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(node.label)} — Torrent Schema">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${SITE}og/${esc(id)}.png">
<link rel="canonical" href="${SITE}${esc(id)}">
<link rel="alternate" type="application/ld+json" href="schema/${esc(module)}.jsonld">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; connect-src 'self' wss:; img-src 'self' data:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'">
<style>
  :root { --bg: #fbfaf7; --fg: #1e1d1a; --mut: #6b675f; --line: #ddd8cc; --accent: #c2410c; --link: #1f5fa3; --card: #fff; --ok: #1c7a3c; --bad: #b3261e; --hl: #ffe9b3; --mono: ui-monospace, Menlo, Consolas, monospace; }
  @media (prefers-color-scheme: dark) { :root { --bg: #15161a; --fg: #ebe9e2; --mut: #a39f94; --line: #333640; --card: #1d1f25; --link: #7fb0ff; --accent: #f08c4b; --ok: #5fcf7f; --bad: #ff7a70; --hl: #4a3a10; } }
  html { background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, sans-serif; } body { margin: 0; padding: 0 16px 48px; max-width: 980px; margin-inline: auto; }
  h1 { font-size: 1.7rem; margin: 1.2rem 0 .2rem; } h1 span { color: var(--accent); } h1 small { font-size: .55em; color: var(--mut); font-weight: 400; } a { color: var(--link); }
  nav { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: .9rem; margin: .4rem 0 .8rem; } .meta { color: var(--mut); font-size: .88rem; margin: 0 0 .6rem; } .comment { margin: .3rem 0 .6rem; } .tiny { font-size: .85em; } .mut { color: var(--mut); } .accent { color: var(--accent); } .ok { color: var(--ok); font-weight: 600; } .bad { color: var(--bad); font-weight: 600; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; margin: 12px 0; } .card h2 { margin: 0 0 .4rem; font-size: 1.1rem; }
  table { border-collapse: collapse; width: 100%; font-size: .92rem; } th { text-align: left; color: var(--mut); font-weight: 600; padding: 4px 8px; border-bottom: 1px solid var(--line); } td { padding: 5px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
  td.name { font-family: var(--mono); white-space: nowrap; } td.type { font-family: var(--mono); color: var(--accent); white-space: nowrap; } td.val { font-family: var(--mono); font-size: .85em; max-width: 44ch; min-width: 22ch; overflow-wrap: anywhere; } code { font-family: var(--mono); font-size: .92em; } code.pre { white-space: pre-wrap; }
  tr:target { background: var(--hl); } tr.hl, span.f.hl { background: var(--hl); }
  .derived-label { margin: .8rem 0 .2rem; font-size: .8rem; color: var(--link); font-weight: 600; letter-spacing: .04em; text-transform: uppercase; }
  pre.hex { font: 12px/1.5 var(--mono); background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; overflow-x: auto; white-space: pre; margin: .4rem 0; } pre.hex.txt { white-space: pre-wrap; overflow-wrap: anywhere; color: var(--mut); } span.f { border-bottom: 2px solid var(--line); }
  details > summary { cursor: pointer; color: var(--mut); font-size: .9rem; } pre.island { font: 12px/1.45 var(--mono); white-space: pre-wrap; overflow-wrap: anywhere; max-height: 60vh; overflow: auto; background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; }
  footer { color: var(--mut); font-size: .9rem; margin-top: 2rem; }
</style>
</head>
<body>
<header>
  <h1><span>${esc(node.label)}</span> <small>${esc(short(type))} · <a href="./">Torrent Schema</a> v${esc(pkg.version)}</small></h1>
  <nav><a href="./">all classes</a><a href="${esc(short(mod['@id']))}">module: ${esc(mod.label)}</a><a href="schema/${esc(module)}.jsonld">schema/${esc(module)}.jsonld</a><a href="#island">the island</a></nav>
  <p class="meta">${meta} · <span class="mut">IRI</span> <code>${SITE}${esc(id)}</code></p>
  <p class="comment">${esc(node.comment ?? '')}</p>${node.seeAlso ? `<p class="comment tiny">See also: <a href="${esc(node.seeAlso)}">${esc(node.seeAlso)}</a></p>` : ''}
</header>
${body}
<details id="island-details"><summary>the JSON-LD island this page is rendered from${inst ? ' — the definition and the instance' : ' — the definition'}</summary><pre class="island">${esc(JSON.stringify(island, null, 1))}</pre></details>
<script type="application/ld+json" id="island">${JSON.stringify(island).replace(/</g, '\\u003c')}</script>
<footer><p>Generated from <a href="schema/${esc(module)}.jsonld">schema/${esc(module)}.jsonld</a> by tools/gen-class-pages.js; the island above is the source of this page and is checked against the schema by the tests. Independent community project; not affiliated with the BitTorrent or WebTorrent projects. AGPL-3.0-or-later.</p></footer>
<script type="module" src="apps/class.js"></script>
</body>
</html>
`;
}

export async function build() {
  const I = await instances(); const terms = {}; let count = 0, withInstance = 0;
  for (const x of nodes) {
    const n = x.node; const id = short(n['@id']); const inst = n['@type'] === 'Struct' ? I[id] : undefined; if (inst) withInstance++;
    await writeFile(new URL(`${id}.html`, root), renderNode(x, inst)); count++; terms[id] = id;
    for (const f of n.fields ?? []) if (f.property) terms[short(f.property)] ??= `${id}#${short(f.property)}`; // a property may be shared by structs: it resolves to the first that declares it
    for (const d of n.derived ?? []) if (d.property) terms[short(d.property)] ??= `${id}#${short(d.property)}`;
    for (const r of n.rules ?? []) if (r['@id']) terms[short(r['@id'])] = `${id}#${short(r['@id'])}`;
    for (const m of n.members ?? []) if (m['@id']) terms[short(m['@id'])] = `${id}#${short(m['@id'])}`;
  }
  await writeFile(new URL('terms.json', root), JSON.stringify(terms, null, 1) + '\n');
  // the catalogue: one row per node, the index renders it as a table and anyone may read it as data
  const classes = nodes.map((x) => { const n = x.node; const id = short(n['@id']); const inst = n['@type'] === 'Struct' ? I[id] : undefined; return { id, label: n.label, type: short(n['@type']), module: x.module, layer: x.mod.layer, encoding: n.encoding ? short(n.encoding) : undefined, bep: n.bep, kind: n.kind, wireSize: n.wireSize, fields: n.fields?.length, members: n.members?.length, rules: n.rules?.length, instance: inst ? { source: inst.source, bytes: inst.bytes ? inst.bytes.length / 2 : undefined } : undefined, summary: String(n.comment ?? '').split(/(?<=\.)\s/)[0] }; });
  await writeFile(new URL('classes.json', root), JSON.stringify({ version: pkg.version, generated: new Date().toISOString().slice(0, 10), classes }, null, 1) + '\n');
  await writeFile(new URL('404.html', root), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Torrent Schema — term lookup</title>
<meta name="robots" content="noindex"><style>html{font:15px/1.5 system-ui,sans-serif;background:#fbfaf7;color:#1e1d1a}body{max-width:720px;margin:3rem auto;padding:0 16px}a{color:#1f5fa3}</style></head>
<body><h1>Torrent Schema</h1><p id="msg">Looking this term up…</p><p><a href="/">All classes</a></p>
<script>(async()=>{const t=decodeURIComponent(location.pathname.replace(/^\\//,'').replace(/\\.html$/,''));try{const m=await (await fetch('/terms.json')).json();if(m[t]){location.replace('/'+m[t]);return}}catch{}document.getElementById('msg').textContent='No term named "'+t+'" in the schema.'})()</script>
</body></html>
`);
  return { count, withInstance, nodes: nodes.map((x) => ({ id: short(x.node['@id']), type: short(x.node['@type']), module: x.module, label: x.node.label, hasInstance: !!(x.node['@type'] === 'Struct' && I[short(x.node['@id'])]), node: x.node, inst: x.node['@type'] === 'Struct' ? I[short(x.node['@id'])] : undefined })) };
}
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) { const r = await build(); console.log(`${r.count} pages, ${r.withInstance} with a captured instance; terms.json has ${Object.keys(JSON.parse(await readFile(new URL('terms.json', root), 'utf8'))).length} terms`); }
