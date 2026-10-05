// tracker: real exchanges with tracker.opentrackr.org for the snapshot's infohash, captured byte for byte (test/vectors/
// tracker/): the UDP connect, announce and scrape, the HTTP compact announce and scrape, and opentrackr's HTML answer
// to a non-compact announce. Requests must re-encode to the bytes that were sent; responses must decode to the counts
// the tracker reported; the exchange rules must catch the wrong transaction id, action and length.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { TrackerCodec } from '../codec/tracker.js';
const root = new URL('..', import.meta.url);
const load = async (p) => JSON.parse(await readFile(new URL(p, root), 'utf8'));
const vec = async (f) => new Uint8Array(await readFile(new URL('test/vectors/tracker/' + f + '.bin', root)));
const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const T = new TrackerCodec(await load('schema/bencode.jsonld'), await load('schema/metainfo.jsonld'), await load('schema/tracker.jsonld'));
const INFOHASH = '242e9b7dcba15cc0ed8f1bc5f06b68da008f87c0', PEER_ID = hex(new TextEncoder().encode('-TS0001-0123456789ab'));

test('UDP connect: the request is the magic number, action 0 and a transaction id; the response echoes the id and gives a connection id', async () => {
  const reqBytes = await vec('udpConnectRequest'); const req = T.binary.decode('UdpConnectRequest', reqBytes);
  assert.equal(req.protocol_id, 0x41727101980); assert.equal(req.action, 0); assert.deepEqual(T.udpEncode('UdpConnectRequest', req), reqBytes);
  assert.deepEqual(T.udpEncode('UdpConnectRequest', { transaction_id: req.transaction_id }), reqBytes, 'constants fill themselves in');
  const r = T.udpDecode(req, await vec('udpConnectResponse')); assert.equal(r.error, null); assert.equal(r.name, 'UdpConnectResponse'); assert.equal(r.response.transaction_id, req.transaction_id); assert.ok(r.response.connection_id > 0);
});
test('UDP announce: 98 bytes that re-encode exactly; the response names seeders, leechers, an interval and compact peers', async () => {
  const reqBytes = await vec('udpAnnounceRequest'); const req = T.binary.decode('UdpAnnounceRequest', reqBytes);
  assert.equal(reqBytes.length, 98); assert.equal(req.info_hash, INFOHASH); assert.equal(req.peer_id, PEER_ID); assert.equal(req.left, 869836053); assert.equal(req.event, 2); assert.equal(req.num_want, 50); assert.equal(req.port, 6881); assert.equal(req.key, 0xdeadbeef);
  assert.deepEqual(T.udpEncode('UdpAnnounceRequest', req), reqBytes);
  const r = T.udpDecode(req, await vec('udpAnnounceResponse')); assert.equal(r.error, null);
  assert.equal(r.response.interval, 3617); assert.equal(r.response.seeders, 2); assert.equal(r.response.leechers, 1);
  assert.equal(r.response.peers.length, 3); assert.deepEqual(r.response.peers[0], { ip: '86.49.17.222', port: 6881 });
  assert.deepEqual(T.udpEncode('UdpAnnounceResponse', r.response), await vec('udpAnnounceResponse'), 'the response re-encodes byte-exactly too');
});
test('UDP scrape: one infohash in, one triple of counts out, consistent with the announce', async () => {
  const req = T.binary.decode('UdpScrapeRequest', await vec('udpScrapeRequest')); assert.deepEqual(req.info_hashes, [INFOHASH]);
  const r = T.udpDecode(req, await vec('udpScrapeResponse')); assert.equal(r.error, null); assert.deepEqual(r.response.counts, [{ seeders: 2, completed: 8, leechers: 1 }]);
});
test('UDP rules: a wrong transaction id, a wrong action and a short datagram are each refused by their code; an error datagram is read', async () => {
  const req = T.binary.decode('UdpAnnounceRequest', await vec('udpAnnounceRequest')); const resp = await vec('udpAnnounceResponse');
  assert.equal(T.udpDecode({ ...req, transaction_id: req.transaction_id ^ 1 }, resp).error, 'tracker-udp-transaction');
  assert.equal(T.udpDecode({ ...req, action: 2 }, resp).error, 'tracker-udp-action');
  assert.equal(T.udpDecode(req, resp.subarray(0, 12)).error, 'tracker-udp-short');
  assert.equal(T.udpDecode(req, resp.subarray(0, 23)).error, 'binary-short', 'a torn compact peer');
  const err = T.udpEncode('UdpError', { transaction_id: req.transaction_id, message: 'Connection ID mismatch.' }); const e = T.udpDecode(req, err);
  assert.equal(e.error, 'tracker-refused'); assert.equal(e.response.message, 'Connection ID mismatch.');
  assert.throws(() => T.binary.decode('UdpConnectRequest', new Uint8Array(16)), (x) => x.code === 'binary-const', 'the magic number is checked');
});
test('HTTP announce: the URL the schema builds is the one that was sent, infohash percent-encoded byte by byte', async () => {
  const sent = new TextDecoder().decode(await vec('httpAnnounceUrlCompact'));
  const url = T.announceUrl('http://tracker.opentrackr.org:1337/announce', { info_hash: INFOHASH, peer_id: PEER_ID, port: 6881, uploaded: 0, downloaded: 0, left: 869836053, event: 'started', numwant: 50, compact: 1 });
  const params = (u) => new Set(u.split('?')[1].split('&')); // the schema's field order is canonical; the capture sent them in another order, which a tracker does not care about
  assert.deepEqual(params(url), params(sent)); assert.equal(url.split('?')[0], sent.split('?')[0]); assert.match(url, /info_hash=%24%2e%9b%7d/);
  assert.throws(() => T.announceUrl('http://t/announce', { info_hash: INFOHASH }), /'peer_id' is required/);
  assert.equal(T.scrapeUrl('http://tracker.opentrackr.org:1337/announce', [INFOHASH]), new TextDecoder().decode(await vec('httpScrapeUrl')));
  assert.equal(T.scrapeUrl('http://t/x', [INFOHASH]), null);
});
test('HTTP announce response: compact peers read as ip and port; the counts match the UDP answer from the same tracker', async () => {
  const r = T.parseAnnounce(await vec('httpAnnounceCompact')); assert.equal(r.error, null);
  assert.equal(r.response.interval, 3734); assert.equal(r.response['min interval'], 1867); assert.equal(r.response.complete, 2); assert.equal(r.response.incomplete, 1); assert.equal(r.response.downloaded, 8);
  assert.equal(r.response.peers.length, 3); assert.deepEqual(r.response.peers[0], { ip: '86.49.17.222', port: 6881 });
  assert.deepEqual(T.bencoded.encode('AnnounceResponse', r.response), await vec('httpAnnounceCompact'), 're-encodes byte-exactly, compact peers and all');
});
test("HTTP rules: opentrackr's HTML answer to a non-compact announce is 'not bencode'; a failure reason is a refusal; no interval is an error; a torn peer list is bad peers", async () => {
  assert.equal(T.parseAnnounce(await vec('httpAnnounceFull')).error, 'tracker-not-bencode');
  const { encode } = await import('../codec/bencode.js');
  assert.equal(T.parseAnnounce(encode({ 'failure reason': 'unregistered torrent' })).error, 'tracker-refused');
  assert.equal(T.parseAnnounce(encode({ peers: new Uint8Array(6) })).error, 'tracker-no-interval');
  assert.equal(T.parseAnnounce(encode({ interval: 60, peers: new Uint8Array(7) })).error, 'tracker-bad-peers');
  const dict = T.parseAnnounce(encode({ interval: 60, peers: [{ 'peer id': new Uint8Array(20), ip: '10.0.0.1', port: 51413 }] })); assert.equal(dict.error, null); assert.equal(dict.response.peers[0].ip, '10.0.0.1'); assert.equal(dict.response.peers[0].port, 51413);
  const v6 = T.parseAnnounce(encode({ interval: 60, peers6: T.binary.encode('CompactPeer6', { ip: '2001:db8::1', port: 6881 }) })); assert.deepEqual(v6.response.peers6, [{ ip: '2001:db8:0:0:0:0:0:1', port: 6881 }]);
});
test('HTTP scrape: files keyed by infohash with seeders, completed, leechers', async () => {
  const r = T.parseScrape(await vec('httpScrape')); assert.equal(r.error, null); assert.deepEqual(r.response.files[INFOHASH], { complete: 2, downloaded: 8, incomplete: 1 });
  assert.deepEqual(T.bencoded.encode('ScrapeResponse', r.response), await vec('httpScrape'));
});
test('compact peers both ways, v4 and v6', () => {
  assert.equal(T.compactEncode([{ ip: '86.49.17.222', port: 6881 }, { ip: '10.0.0.1', port: 80 }]), '563111de1ae10a0000010050');
  assert.deepEqual(T.compactPeers('563111de1ae10a0000010050'), [{ ip: '86.49.17.222', port: 6881 }, { ip: '10.0.0.1', port: 80 }]);
  const six = T.compactEncode([{ ip: '2001:db8::1', port: 6881 }], true); assert.equal(six.length, 36); assert.equal(T.compactPeers(six, true)[0].port, 6881);
});
