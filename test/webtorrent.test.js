// webtorrent: a real exchange with tracker.openwebtorrent.com for the snapshot's infohash (test/vectors/webtorrent/):
// our announce carrying a WebRTC offer, the tracker's reply, and the answer routed back from the seeder, after which
// the WebRTC connection reached 'connected'. Addresses in the SDP were replaced by documentation addresses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { WebTorrentCodec, toBinary, fromBinary } from '../codec/webtorrent.js';
import { TorrentCodec } from '../codec/codec.js';
const root = new URL('..', import.meta.url);
const load = async (p) => JSON.parse(await readFile(new URL(p, root), 'utf8'));
const S = await load('test/vectors/webtorrent/announce-session.json'); const C = new WebTorrentCodec();
const T = new TorrentCodec(await load('schema/bencode.jsonld'), await load('schema/metainfo.jsonld'));
const torrent = await T.parse(new Uint8Array(await readFile(new URL('test/vectors/utxo-knots-150307.torrent', root))));

test('ids travel as binary strings of 20 characters, not hex: both ways', () => {
  assert.equal(toBinary(S.infohash).length, 20); assert.equal(fromBinary(toBinary(S.infohash)), S.infohash); assert.equal(S.sent[0].info_hash, toBinary(S.infohash));
});
test('the announce the schema builds is the one that was sent, offer and all', () => {
  const sent = S.sent[0]; const offer = sent.offers[0];
  const built = C.announce({ info_hash: S.infohash, peer_id: S.peer_id, numwant: 5, left: 869836053, event: 'started', offers: [{ offer_id: S.offer_id, offer: offer.offer }] });
  assert.deepEqual(built, sent); assert.equal(offer.offer.type, 'offer'); assert.match(offer.offer.sdp, /^v=0\r?\n/); assert.match(offer.offer.sdp, /a=ice-ufrag:/); assert.match(offer.offer.sdp, /webrtc-datachannel/);
});
test("the tracker's reply: counts and an interval, no peers (they come as offers and answers)", () => {
  const r = C.read(S.received[0], { announced: [S.infohash] }); assert.equal(r.kind, 'reply'); assert.equal(r.error, null); assert.equal(r.interval, 120); assert.equal(r.complete, 3); assert.equal(r.incomplete, 1); assert.equal(S.received[0].peers, undefined);
});
test("the seeder's answer: matched to our offer by offer_id, from a peer named by its id, with an SDP of type answer; the exchange reached 'connected'", () => {
  const a = C.read(S.received[1], { announced: [S.infohash], outstanding: [S.offer_id] }); assert.equal(a.kind, 'answer'); assert.equal(a.error, null);
  assert.equal(a.offer_id, S.offer_id); assert.equal(a.info_hash, S.infohash); assert.match(Buffer.from(a.peer_id, 'hex').toString('latin1'), /^-WW0300-/); assert.equal(a.answer.type, 'answer'); assert.match(a.answer.sdp, /a=candidate:/);
  assert.equal(S.received[1].to_peer_id, undefined, 'the tracker strips to_peer_id before delivery');
});
test('the rules: an answer for an unknown offer, for a torrent not announced, with a bad id, a reply without an interval, a failure', () => {
  assert.equal(C.read(S.received[1], { announced: [S.infohash], outstanding: ['00'.repeat(20)] }).error, 'ws-unknown-offer');
  assert.equal(C.read(S.received[1], { announced: ['11'.repeat(20)] }).error, 'ws-wrong-torrent');
  assert.equal(C.read({ ...S.received[1], offer_id: 'short' }).error, 'ws-bad-id');
  assert.equal(C.read({ ...S.received[1], answer: { type: 'offer', sdp: '' } }, { outstanding: [S.offer_id] }).error, 'ws-bad-sdp');
  assert.equal(C.read({ action: 'announce', info_hash: S.sent[0].info_hash }).error, 'ws-no-interval');
  assert.equal(C.read({ 'failure reason': 'unregistered torrent' }).error, 'tracker-refused');
  assert.equal(C.read({ action: 'announce', info_hash: S.sent[0].info_hash, peer_id: S.sent[0].peer_id, offer: { type: 'offer', sdp: 'v=0' }, offer_id: S.sent[0].offers[0].offer_id }).kind, 'offer', 'a forwarded offer is told apart');
  const ans = C.answer({ info_hash: S.infohash, peer_id: S.peer_id, to_peer_id: fromBinary(S.received[1].peer_id), offer_id: S.offer_id, answer: { type: 'answer', sdp: 'v=0' } });
  assert.equal(ans.to_peer_id, S.received[1].peer_id); assert.equal(ans.offer_id, S.sent[0].offers[0].offer_id);
});
test('a web seed request (BEP 19): a block of the snapshot becomes a Range on the file URL; the last block is clipped; a 200 disqualifies the seed', () => {
  const info = torrent.meta.info; const r = C.webSeedRequest('https://mirror.example/utxo-knots-150307.dat', info, { index: 0, begin: 0, length: 16384 });
  assert.equal(r.headers.Range, 'bytes=0-16383'); assert.equal(r.url, 'https://mirror.example/utxo-knots-150307.dat');
  assert.equal(C.webSeedRequest('https://mirror.example/dir/', info, { index: 1, begin: 16384, length: 16384 }).headers.Range, `bytes=${4194304 + 16384}-${4194304 + 32767}`);
  assert.equal(C.webSeedRequest('https://m/f', info, { index: 207, begin: 1605632, length: 16384 }).last, 869836052, 'the final block ends at the last byte of the file');
  assert.throws(() => C.webSeedRequest('https://m/f', info, { index: 208, begin: 0, length: 1 }), /outside/);
  assert.equal(C.webSeedCheck({ status: 200, headers: {} }, r), 'webseed-no-range'); assert.equal(C.webSeedCheck({ status: 206, headers: { 'content-range': 'bytes 0-16383/869836053' }, byteLength: 16384 }, r), null); assert.equal(C.webSeedCheck({ status: 206, headers: { 'content-range': 'bytes 0-16383/869836053' }, byteLength: 100 }, r), 'webseed-bad-length');
});
