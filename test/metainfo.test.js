// metainfo against three real .torrent files: ours (the txbt4 UTXO snapshot), Ubuntu's and Debian's. The infohash the
// schema derives must equal what every tracker, client and DHT node computes; the file must re-encode byte-exactly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { TorrentCodec } from '../codec/codec.js';
const root = new URL('..', import.meta.url);
const load = async (p) => JSON.parse(await readFile(new URL(p, root), 'utf8'));
const vector = async (f) => new Uint8Array(await readFile(new URL('test/vectors/' + f, root)));
const codec = new TorrentCodec(await load('schema/bencode.jsonld'), await load('schema/metainfo.jsonld'));

const VECTORS = [
  ['utxo-knots-150307.torrent', { infohash: '242e9b7dcba15cc0ed8f1bc5f06b68da008f87c0', name: 'utxo-knots-150307.dat', length: 869836053, pieceLength: 4194304, pieces: 208, createdBy: 'WebTorrent/0300' }],
  ['ubuntu-24.04.3-live-server-amd64.iso.torrent', { infohash: 'a1dfefec1a9dd7fa8a041ebeeea271db55126d2f', name: 'ubuntu-24.04.3-live-server-amd64.iso', length: 3303444480, pieceLength: 262144, pieces: 12602 }],
  ['debian-13.7.0-amd64-netinst.iso.torrent', { infohash: '7acf8fb590b2060dd9c3146ef770169d593433b0', name: 'debian-13.7.0-amd64-netinst.iso', length: 792723456, pieceLength: 262144, pieces: 3024 }],
];
for (const [file, x] of VECTORS) {
  test(`${file}: the schema derives the infohash every client agrees on, and the fields`, async () => {
    const bytes = await vector(file); const t = await codec.parse(bytes);
    assert.equal(t.infohash, x.infohash); assert.equal(t.error, null);
    assert.equal(t.meta.info.name, x.name); assert.equal(t.meta.info.length, x.length); assert.equal(t.meta.info['piece length'], x.pieceLength);
    assert.equal(t.pieceCount, x.pieces); assert.equal(t.totalLength, x.length); assert.equal(t.lastPieceLength, x.length - (x.pieces - 1) * x.pieceLength);
    assert.equal(t.meta.info.pieces.length, x.pieces); assert.match(t.meta.info.pieces[0], /^[0-9a-f]{40}$/);
    if (x.createdBy) assert.equal(t.meta['created by'], x.createdBy);
    assert.ok(t.magnet.startsWith(`magnet:?xt=urn:btih:${x.infohash}&dn=`));
  });
  test(`${file}: encode(decode(file)) is the file, byte for byte`, async () => {
    const bytes = await vector(file); const meta = codec.decode('MetaInfo', bytes); const again = codec.encode('MetaInfo', meta);
    assert.equal(again.length, bytes.length); assert.deepEqual(again, bytes);
  });
}
test('the infohash is over the info dictionary alone: trackers, web seeds and comments can change without changing it', async () => {
  const bytes = await vector('utxo-knots-150307.torrent'); const meta = codec.decode('MetaInfo', bytes);
  meta.announce = 'wss://tracker.example'; meta['url-list'] = ['https://example.org/utxo-knots-150307.dat']; meta.comment = 'changed';
  const again = codec.decode('MetaInfo', codec.encode('MetaInfo', meta));
  assert.equal(await codec.infohash(again), '242e9b7dcba15cc0ed8f1bc5f06b68da008f87c0');
  assert.deepEqual(again['url-list'], ['https://example.org/utxo-knots-150307.dat']);
  assert.match(codec.magnet(again, await codec.infohash(again)), /&tr=wss%3A%2F%2Ftracker.example&ws=https%3A%2F%2Fexample.org/);
});
test('…and touching anything inside info makes a different torrent', async () => {
  const meta = codec.decode('MetaInfo', await vector('utxo-knots-150307.torrent')); meta.info.name = 'renamed.dat';
  assert.notEqual(await codec.infohash(codec.decode('MetaInfo', codec.encode('MetaInfo', meta))), '242e9b7dcba15cc0ed8f1bc5f06b68da008f87c0');
});
test('the rules: each failure by its error code', async () => {
  const meta = codec.decode('MetaInfo', await vector('utxo-knots-150307.torrent'));
  const copy = () => JSON.parse(JSON.stringify(meta));
  let m = copy(); delete m.info; assert.equal(codec.check(m), 'metainfo-no-info');
  m = copy(); m.info.pieces = []; assert.equal(codec.check(m), 'metainfo-bad-pieces');
  m = copy(); m.info.files = [{ length: 1, path: ['a'] }]; assert.equal(codec.check(m), 'metainfo-length-xor-files');
  m = copy(); m.info['piece length'] = 0; assert.equal(codec.check(m), 'metainfo-bad-piece-length');
  m = copy(); m.info.pieces.pop(); assert.equal(codec.check(m), 'metainfo-piece-count');
  assert.throws(() => codec.decode('MetaInfo', codec.encode('MetaInfo', { announce: 'x' })), /'info' is required/);
});
test('a multi-file torrent: files with paths, totalLength summed, a single url-list string tolerated', async () => {
  const bytes = codec.encode('MetaInfo', { 'url-list': ['https://w/'], info: { name: 'dir', 'piece length': 16384, pieces: ['00'.repeat(20), '11'.repeat(20)], files: [{ length: 16384, path: ['a', 'b.txt'] }, { length: 10, path: ['c.txt'] }] } });
  const t = await codec.parse(bytes); assert.equal(t.totalLength, 16394); assert.equal(t.lastPieceLength, 10); assert.equal(t.error, null); assert.deepEqual(t.meta.info.files[0].path, ['a', 'b.txt']);
  const { encode } = await import('../codec/bencode.js');
  const single = codec.decode('MetaInfo', encode({ 'url-list': 'https://one/', info: { name: 'x', 'piece length': 1, pieces: new Uint8Array(20), length: 1 } }));
  assert.deepEqual(single['url-list'], ['https://one/']);
});
