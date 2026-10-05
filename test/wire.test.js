// peer wire: a real session with a seeder for the snapshot (webtorrent, on this machine), captured through the schema's
// own codec: the handshakes, the extended handshakes, the bitfield, interested, a request and the first 16 KiB block
// of piece 0 (test/vectors/wire/). The session itself assembled the whole piece and checked its SHA-1 (session.json).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { WireCodec } from '../codec/wire.js';
import { TorrentCodec } from '../codec/codec.js';
const root = new URL('..', import.meta.url);
const load = async (p) => JSON.parse(await readFile(new URL(p, root), 'utf8'));
const vec = async (f) => new Uint8Array(await readFile(new URL('test/vectors/wire/' + f + '.bin', root)));
const docs = [await load('schema/bencode.jsonld'), await load('schema/metainfo.jsonld'), await load('schema/tracker.jsonld'), await load('schema/wire.jsonld')];
const W = new WireCodec(...docs); const T = new TorrentCodec(...docs); const session = await load('test/vectors/wire/session.json');
const torrent = await T.parse(new Uint8Array(await readFile(new URL('test/vectors/utxo-knots-150307.torrent', root))));
const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

test('the handshake: 68 bytes, the protocol name, reserved bits read as what the peer supports; ours re-encodes exactly', async () => {
  const ours = await vec('handshakeSent'); const h = W.readHandshake(ours); assert.equal(h.error, null);
  assert.equal(h.handshake.pstrlen, 19); assert.equal(h.handshake.pstr, 'BitTorrent protocol'); assert.equal(h.handshake.info_hash, session.infohash); assert.equal(h.handshake.peer_id, session.ourPeerId);
  assert.deepEqual(h.supports, { extensions: true, dht: false, fast: false });
  assert.deepEqual(W.handshake({ info_hash: session.infohash, peer_id: session.ourPeerId }), ours);
  const theirs = W.readHandshake(await vec('handshakeReceived')); assert.equal(theirs.handshake.info_hash, session.infohash); assert.equal(theirs.handshake.peer_id, session.theirPeerId);
  assert.deepEqual(theirs.supports, { extensions: true, dht: true, fast: true }); assert.match(Buffer.from(theirs.handshake.peer_id, 'hex').toString('latin1'), /^-WW0300-/, 'webtorrent names itself in the peer id (BEP 20)');
  assert.equal(W.readHandshake(new Uint8Array(68)).error, 'wire-bad-handshake'); assert.equal(W.readHandshake(ours.subarray(0, 60)).error, 'binary-short');
});
test('frames: the stream feeds as whole messages, partial ones wait; keep-alive, the id-only messages, and an over-long frame', () => {
  const stream = new Uint8Array([...W.frame('keep-alive'), ...W.frame('interested'), ...W.frame('Have', { index: 7 }), ...W.frame('Request', { index: 0, begin: 16384, length: 16384 }), 0, 0, 0]);
  const r = W.feed(stream); assert.equal(r.error, null); assert.deepEqual(r.messages.map((m) => m.name), ['keep-alive', 'interested', 'Have', 'Request']); assert.equal(r.messages[2].index, 7); assert.equal(r.messages[3].begin, 16384); assert.equal(r.rest.length, 3);
  assert.equal(W.feed(new Uint8Array([0, 1, 0, 0, 7])).error, 'wire-frame-too-long');
  assert.equal(W.feed(new Uint8Array([0, 0, 0, 1, 99])).messages[0].name, 'unknown-99');
});
test("the seeder's bitfield says it has all 208 pieces in 26 bytes; the bitfield rule catches a wrong length and set spare bits", async () => {
  const m = W.feed(await vec('bitfieldReceived')).messages[0]; assert.equal(m.name, 'Bitfield'); assert.equal(m.bits.length / 2, 26);
  const p = W.pieces(m.bits, torrent.pieceCount); assert.equal(p.error, null); assert.equal(p.have.length, 208); assert.equal(m.bits, W.bitfield(p.have, 208));
  assert.equal(W.pieces(m.bits, 300).error, 'wire-bad-bitfield'); assert.equal(W.pieces('ff'.repeat(26), 207).error, 'wire-bad-bitfield', 'a spare bit set');
  assert.equal(W.bitfield([0, 9], 16), '8040');
});
test('interested and a request re-encode to what was sent; the piece that came back is the first block of the snapshot and begins with its header', async () => {
  assert.deepEqual(W.frame('interested'), await vec('interestedSent')); assert.deepEqual(W.frame('Request', { index: 0, begin: 0, length: 16384 }), await vec('requestSent'));
  const m = W.feed(await vec('pieceReceived')).messages[0]; assert.equal(m.name, 'Piece'); assert.equal(m.index, 0); assert.equal(m.begin, 0); assert.equal(m.block.length / 2, 16384);
  assert.ok(m.block.startsWith('7574786fff0200'), "the UTXO snapshot's magic 'utxo' 0xff and format version 2, little-endian, are the file's first bytes");
  assert.equal(session.pieceOk, true); assert.equal(session.pieceSha1, torrent.meta.info.pieces[0], 'the session assembled all 256 blocks and the piece hashed to pieces[0]');
  assert.deepEqual(W.frame('Piece', m), await vec('pieceReceived'));
});
test('the extension protocol: our extended handshake and the seeder\'s decode by the schema; its m table names what it will receive under which id', async () => {
  const ours = W.feed(await vec('extendedHandshakeSent')).messages[0]; assert.equal(ours.name, 'Extended'); assert.equal(ours.ext_id, 0);
  const x = W.readExtended(ours); assert.equal(x.kind, 'handshake'); assert.deepEqual(x.value.m, { ut_metadata: 1, ut_pex: 2 }); assert.equal(x.value.v, 'torrent-schema/0.0.1'); assert.equal(x.value.p, 6881);
  assert.deepEqual(W.extendedHandshake(x.value), await vec('extendedHandshakeSent'));
  const theirs = W.readExtended(W.feed(await vec('extendedHandshakeReceived')).messages[0]); assert.deepEqual(theirs.value.m, { lt_donthave: 3, ut_metadata: 1, ut_pex: 2 }); assert.equal(theirs.value.metadata_size, 4248);
  assert.equal(theirs.value.metadata_size, T.encode('Info', torrent.meta.info).length, 'metadata_size is the byte length of the bencoded info dictionary');
});
test('ut_metadata: a data message is a dictionary followed by raw bytes; ut_pex carries compact peers; an unknown id is refused', async () => {
  const info = T.encode('Info', torrent.meta.info); const piece0 = info.subarray(0, 16384);
  const frame = W.utMetadata(1, { msg_type: 1, piece: 0, total_size: info.length }, piece0); const m = W.feed(frame).messages[0];
  const x = W.readExtended(m, { 1: 'ut_metadata' }); assert.equal(x.kind, 'ut_metadata'); assert.equal(x.value.msg_type, 1); assert.equal(x.value.total_size, 4248); assert.equal(x.data.length, piece0.length); assert.equal(hex(x.data), hex(piece0));
  const { encode } = await import('../codec/bencode.js');
  const pex = W.readExtended({ ext_id: 2, payload: hex(encode({ added: new Uint8Array([10, 0, 0, 1, 0x1a, 0xe1]), 'added.f': new Uint8Array([2]) })) }, { 2: 'ut_pex' });
  assert.equal(pex.kind, 'ut_pex'); assert.deepEqual(pex.value.added, [{ ip: '10.0.0.1', port: 6881 }]); assert.equal(pex.value['added.f'], '02');
  assert.equal(W.readExtended({ ext_id: 9, payload: hex(encode({})) }, { 2: 'ut_pex' }).error, 'wire-extension-unsupported');
});
