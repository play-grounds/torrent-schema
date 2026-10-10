// nostr: the real kind 2003 event that announces the txbt4 UTXO snapshot (test/vectors/nostr/), read by the schema and
// checked against the .torrent it was made from (test/vectors/utxo-knots-150307.torrent) — the projection in both
// directions, the id recomputed, the magnet derived, and the rules by error code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NostrCodec } from '../codec/nostr.js';
import { TorrentCodec } from '../codec/codec.js';
const root = new URL('..', import.meta.url);
const load = async (p) => JSON.parse(await readFile(new URL(p, root), 'utf8'));
const E = await load('test/vectors/nostr/utxo-knots-150307.json');
const N = new NostrCodec(await load('schema/nostr.jsonld'));
const T = new TorrentCodec(await load('schema/bencode.jsonld'), await load('schema/metainfo.jsonld'));
const torrent = await T.parse(new Uint8Array(await readFile(new URL('test/vectors/utxo-knots-150307.torrent', root))));

test('the event is read by the schema: tags become fields, by key and by position; unknown tags are kept', () => {
  const e = N.read(E);
  assert.equal(e.x, '242e9b7dcba15cc0ed8f1bc5f06b68da008f87c0'); assert.match(e.title, /^Bitcoin BLAKE2b testnet4/);
  assert.deepEqual(e.file, [{ name: 'utxo-knots-150307.dat', size: 869836053 }]);
  assert.equal(e.tracker.length, 6); assert.equal(e.t.length, 8); assert.deepEqual(e.i, ['tcat:other']); assert.match(e.alt, /^Torrent: /);
  assert.deepEqual(e.extra.map((t) => t[0]), ['sha256', 'txoutset_hash', 'base', 'n'], 'tags the NIP does not name survive, in order');
  const sorted = (tags) => [...tags].map((x) => JSON.stringify(x)).sort();
  assert.deepEqual(sorted(N.toTags('TorrentEvent', e)), sorted(E.tags), 'and the same tags come back — in schema order, not the event\'s: order is part of the id, so a re-emitted event is a new event to sign, never a copy');
});
test('the id is the SHA-256 of the NIP-01 serialisation, and the rules pass', async () => {
  assert.equal(await N.id(E), E.id); assert.equal(await N.check(E), null); assert.equal(await N.check(E, { torrent }), null);
});
test("the projection from the shipped .torrent: hash, file and the five trackers agree with the real event; the event's sixth 'tracker' is a web seed the NIP has no tag for, and not even the same URL as the torrent's url-list", () => {
  const p = N.fromMetaInfo(torrent); const e = N.read(E);
  assert.equal(p.x, e.x); assert.deepEqual(p.file, e.file); assert.equal(p.title, 'utxo-knots-150307.dat');
  assert.deepEqual(p.tracker, e.tracker.slice(0, 5), 'announce-list flattened is the first five tracker tags, in order');
  assert.equal(e.tracker.length, 6); assert.match(e.tracker[5], /^https:\/\/melvin\.me\//); assert.notEqual(e.tracker[5], torrent.meta['url-list'][0], 'the event names a second mirror of the same file');
});
test('the derived magnet against the one the author wrote into the content: same hash and trackers; the dn is the title, not the file name; no web seed, the event cannot carry one', () => {
  const e = N.read(E); const m = N.magnet(e); const written = E.content.match(/^magnet: (\S+)$/m)[1];
  const trOf = (u) => new URL(u).searchParams.getAll('tr').filter((x) => !x.startsWith('https://melvin.me/'));
  assert.equal(new URL(m).searchParams.get('xt'), new URL(written).searchParams.get('xt')); assert.deepEqual(trOf(m), trOf(written));
  assert.equal(new URL(m).searchParams.get('dn'), e.title); assert.equal(new URL(written).searchParams.get('dn'), 'utxo-knots-150307.dat', 'the author put the file name; the NIP has only the title to offer');
  assert.match(written, /&ws=/); assert.doesNotMatch(m, /&ws=/);
  assert.ok(e.tracker.some((t) => t.startsWith('https://melvin.me/')), "the web seed rides in a 'tracker' tag: the NIP has no better place");
});
test('references: the prefix is looked up in ReferencePrefix; an unknown one is reported, not rejected', async () => {
  assert.deepEqual(N.references(N.read(E)), [{ prefix: 'tcat', id: 'other', known: true }]);
  assert.deepEqual(N.references({ i: ['nyaa:2171056', 'imdb:tt15239678'] }), [{ prefix: 'nyaa', id: '2171056', known: false }, { prefix: 'imdb', id: 'tt15239678', known: true }]);
  assert.equal(await N.check({ ...E, tags: [...E.tags, ['i', 'nyaa:1']] }), 'nostr-bad-id', 'altered tags change the id');
});
test('the rules, each by its error code', async () => {
  const w = (tags, more = {}) => ({ ...E, ...more, tags }); const without = (k) => E.tags.filter((t) => t[0] !== k); const swap = (k, t) => [...without(k), t];
  assert.equal(await N.check(w(E.tags, { kind: 1 })), 'nostr-bad-kind');
  assert.equal(await N.check(w(without('x'))), 'nostr-bad-x'); assert.equal(await N.check(w(swap('x', ['x', E.tags[1][1].toUpperCase()]))), 'nostr-bad-x'); assert.equal(await N.check(w([...E.tags, ['x', '00'.repeat(20)]])), 'nostr-bad-x');
  assert.equal(await N.check(w(swap('title', ['title', ' ']))), 'nostr-no-title');
  assert.equal(await N.check(w(swap('file', ['file', 'a', '12 MB']))), 'nostr-bad-file'); assert.equal(await N.check(w(swap('file', ['file']))), 'nostr-bad-file');
  assert.equal(await N.check(w([...E.tags, ['tracker', 'not a url']])), 'nostr-bad-tracker'); assert.equal(await N.check(w([...E.tags, ['tracker', 'ftp://x/announce']])), 'nostr-bad-tracker');
  assert.equal(await N.check(w([...E.tags, ['i', 'imdb']])), 'nostr-bad-reference');
  assert.equal(await N.check({ ...E, content: E.content + ' ' }), 'nostr-bad-id');
  const unsigned = { kind: 2003, pubkey: E.pubkey, created_at: E.created_at, content: '', tags: [['title', 'x'], ['x', '11'.repeat(20)]] };
  assert.equal(await N.check(unsigned), null, 'an event without an id yet is checked for everything else');
  assert.equal(await N.check(unsigned, { torrent }), 'nostr-torrent-mismatch');
  assert.equal(await N.check({ ...unsigned, tags: [['title', 'x'], ['x', torrent.infohash], ['file', 'utxo-knots-150307.dat', '1']] }, { torrent }), 'nostr-torrent-mismatch');
  assert.equal(await N.check({ ...unsigned, tags: [['title', 'x'], ['x', torrent.infohash], ['file', '.', '869836053']] }, { torrent }), null, "a '.' file is the whole torrent");
});
