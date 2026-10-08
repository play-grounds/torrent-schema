// pages: every node of the schema has a page at the path its IRI names, whose island carries the node verbatim (no
// drift from schema/*.jsonld) and, where there is one, an instance the codec decodes to the same value from the same
// bytes — so what a page shows is what the schema and the vectors say.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BinaryCodec } from '../codec/binary.js';
import { TorrentCodec } from '../codec/codec.js';
import { hexToBytes, bytesToHex } from '../codec/hash.js';
const root = new URL('..', import.meta.url);
const load = async (p) => JSON.parse(await readFile(new URL(p, root), 'utf8'));
const MODULES = ['bencode', 'metainfo', 'tracker', 'wire', 'webseed', 'webtorrent', 'nostr'];
const docs = await Promise.all(MODULES.map((m) => load(`schema/${m}.jsonld`))); const binary = new BinaryCodec(...docs), T = new TorrentCodec(...docs);
const json = (v) => JSON.stringify(v, (k, x) => typeof x === 'bigint' ? x.toString() : x);
const island = async (id) => { const html = await readFile(new URL(`${id}.html`, root), 'utf8'); const m = html.match(/<script type="application\/ld\+json" id="island">([\s\S]*?)<\/script>/); assert.ok(m, `${id}.html has an island`); return JSON.parse(m[1]); };
const terms = await load('terms.json');
let pages = 0, instances = 0;
for (const [i, d] of docs.entries()) for (const node of d['@graph']) {
  const id = String(node['@id']).replace(/^bt:/, '');
  test(`${MODULES[i]}: ${id}.html carries the node verbatim${node['@type'] === 'Struct' ? ' and a decodable instance if any' : ''}`, async () => {
    const isl = await island(id); pages++; assert.deepEqual(isl['@graph'][0], node, 'the island definition is the schema node, byte for byte of meaning');
    assert.equal(terms[id], id); for (const f of node.fields ?? []) if (f.property) { const p = f.property.replace(/^bt:/, ''); assert.ok(terms[p]?.endsWith(`#${p}`), `${p} resolves to a field anchor (shared properties go to the first struct that declares them)`); }
    const inst = isl['@graph'][1]; if (!inst) return; instances++;
    assert.equal(inst.of, node['@id']); assert.ok(inst.source && inst.captured);
    if (String(node.encoding).endsWith('binary') && inst.bytes) { const v = binary.decode(id, hexToBytes(inst.bytes)); assert.equal(json(v), json(inst.value), 'the bytes decode to the value'); assert.equal(inst.spans.at(-1)[2], inst.bytes.length / 2, 'the spans cover the bytes'); }
    if (id === 'MetaInfo') { const r = await T.parse(hexToBytes(inst.bytes)); assert.equal(r.infohash, inst.computed.infohash); assert.equal(r.magnet, inst.computed.magnet); }
  });
}
test('every term in terms.json points at a page that exists', async () => { const ids = new Set(docs.flatMap((d) => d['@graph'].map((n) => String(n['@id']).replace(/^bt:/, '')))); for (const v of Object.values(terms)) assert.ok(ids.has(v.split('#')[0]), v); });
