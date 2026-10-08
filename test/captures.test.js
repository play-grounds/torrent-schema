// the second round of captures (8 Oct 2026), each decoded by the schema: a local bittorrent-tracker for the forms
// opentrackr refuses, opentrackr's UDP error, a session with the webtorrent 3 seeder (Port, Have after a verified piece,
// Cancel, ut_metadata whose data hashes to the infohash), an offer forwarded by openwebtorrent, a scrape answered by
// webtorrent.dev, and a kind 2004 comment signed but not published.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { TorrentCodec } from '../codec/codec.js';
import { TrackerCodec } from '../codec/tracker.js';
import { WireCodec } from '../codec/wire.js';
import { WebTorrentCodec, fromBinary } from '../codec/webtorrent.js';
import { NostrCodec } from '../codec/nostr.js';
import { sha1, bytesToHex } from '../codec/hash.js';
const root = new URL('..', import.meta.url);
const load = async (p) => JSON.parse(await readFile(new URL(p, root), 'utf8'));
const vec = async (p) => new Uint8Array(await readFile(new URL('test/vectors/' + p, root)));
const docs = await Promise.all(['bencode', 'metainfo', 'tracker', 'wire', 'webseed', 'webtorrent', 'nostr'].map((m) => load(`schema/${m}.jsonld`)));
const T = new TorrentCodec(...docs), TR = new TrackerCodec(...docs), W = new WireCodec(...docs), C = new WebTorrentCodec(...docs), N = new NostrCodec(...docs);
const IH = '242e9b7dcba15cc0ed8f1bc5f06b68da008f87c0';

test('a non-compact HTTP announce answer (bittorrent-tracker, local): Peer dictionaries with ip, port and peer id', async () => {
  const r = TR.parseAnnounce(await vec('tracker-local/httpAnnounceFullLocal.bin')); assert.equal(r.error, null); assert.equal(r.response.peers.length, 2);
  for (const p of r.response.peers) { assert.ok(p.ip); assert.equal(p.port, 51413); assert.match(Buffer.from(p['peer id'], 'hex').toString('latin1'), /^-TS0001-/); }
  assert.ok(r.response.peers.some((p) => p.ip === '::1'), 'the peer announced from ::1 is listed by its IPv6 address');
});
test("an IPv6 peer comes back in 'peers6' as 18 compact bytes", async () => {
  const r = TR.parseAnnounce(await vec('tracker-local/httpAnnounce6Local.bin')); assert.equal(r.error, null); assert.deepEqual(r.response.peers6, [{ ip: '0:0:0:0:0:0:0:1', port: 51413 }]); assert.ok(r.response.peers.length >= 1, 'the v4 peers come in the compact peers string beside it');
});
test('opentrackr refuses an announce without a connect: a UdpError echoing our transaction id', async () => {
  const req = T.binary ? null : null; const B = TR.binary; const sent = B.decode('UdpAnnounceRequest', await vec('tracker/udpErrorRequest.bin'), { check: false }); const err = B.decode('UdpError', await vec('tracker/udpErrorResponse.bin'));
  assert.equal(err.action, 3); assert.equal(err.transaction_id, sent.transaction_id); assert.match(err.message, /^Connection ID missmatch/); assert.equal(sent.connection_id, 0x41727101980);
});
test('the webtorrent seeder session: Port unasked, Have only after piece 0 verified, a Cancel naming its Request, ut_metadata data hashing to the infohash', async () => {
  const S = await load('test/vectors/wire-webtorrent/session.json'); const f = async (n) => W.feed(await vec('wire-webtorrent/' + n)).messages[0];
  const port = await f('portReceived.bin'); assert.equal(port.name, 'Port'); assert.ok(port.port > 1024);
  const hs = W.readHandshake(await vec('wire-webtorrent/handshakeReceived.bin')); assert.equal(hs.supports.dht, true, 'the seeder set the DHT bit, which is why it sends Port');
  assert.equal(S.piece0.ok, true); assert.equal(S.piece0.sha1, S.piece0.expected); const have = await f('haveSent.bin'); assert.equal(have.name, 'Have'); assert.equal(have.index, 0);
  const rq = await f('requestCancelledSent.bin'), cn = await f('cancelSent.bin'); assert.equal(cn.name, 'Cancel'); assert.deepEqual([cn.index, cn.begin, cn.length], [rq.index, rq.begin, rq.length]);
  const x = W.readExtended(await f('utMetadataReceived.bin'), { 1: 'ut_metadata' }); assert.equal(x.kind, 'ut_metadata'); assert.equal(x.value.msg_type, 1); assert.equal(x.value.total_size, 4248); assert.equal(x.data.length, 4248);
  assert.equal(bytesToHex(await sha1(x.data)), IH, 'rule wire-bad-metadata: the metadata hashes to the infohash');
});
test('an offer forwarded by openwebtorrent to a peer that announced with none: from the seeder, for our torrent, type offer — and it kept the trickle line', async () => {
  const OF = await load('test/vectors/webtorrent/offer-forwarded.json'); const fwd = OF.received.find((m) => m.offer); const r = C.read(fwd, { announced: [IH] });
  assert.equal(r.kind, 'offer'); assert.equal(r.error, null); assert.equal(r.info_hash, IH); assert.match(Buffer.from(r.peer_id, 'hex').toString('latin1'), /^-WW0300-/); assert.equal(fwd.to_peer_id, undefined);
  assert.match(fwd.offer.sdp, /a=ice-options:[^\n]*trickle/, 'Node webtorrent leaves a=ice-options:trickle in; the rule ws-trickle is about what a browser client should strip');
});
test('a WebSocket scrape: webtorrent.dev answers with counts keyed by binary infohash', async () => {
  const SC = await load('test/vectors/webtorrent/scrape.json'); const r = C.read(SC.received); assert.equal(r.kind, 'scrape'); assert.equal(fromBinary(SC.sent.info_hash), IH); assert.deepEqual(Object.keys(r.files).map(fromBinary), [IH]); assert.ok(Object.values(r.files)[0].complete >= 1);
});
test('a kind 2004 comment: threaded to the listing by e and p, id recomputes, signed by the listing author', async () => {
  const CM = await load('test/vectors/nostr/comment-unpublished.json'); const E = await load('test/vectors/nostr/utxo-knots-150307.json');
  assert.equal(CM.kind, 2004); const c = N.fromTags('TorrentComment', CM.tags); assert.deepEqual(c.e, [E.id]); assert.deepEqual(c.p, [E.pubkey]); assert.equal(await N.id(CM), CM.id); assert.equal(CM.pubkey, E.pubkey);
});
