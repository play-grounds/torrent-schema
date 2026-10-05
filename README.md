# Torrent Schema

**v0.0.1** · A machine-readable model of BitTorrent, written in JSON-LD, in the manner of [bitcoin-desktop/schema](https://github.com/bitcoin-desktop/schema): the schema is the source of truth and the code is a projection of it.

**Live:** https://play-grounds.github.io/torrent-schema/ — drop a `.torrent` on the page and the schema decodes it: every field, the infohash, the magnet link, the pieces.

A playground, started for [utxo-swarm](https://github.com/play-grounds/utxo-swarm). Nothing depends on it yet.

## The idea

BitTorrent is specified as numbered BEPs and implemented many times over; the implementations agree because the specs are good, but there is no single document a program can read. This repo writes the protocol down as data: structures with their fields, each field with its bencode key and value type; derived values with their derivation; validity rules with their error codes. A generic codec walks the schema — it has no per-field code — and the keystone test is that it must reproduce reality byte-exactly: three real `.torrent` files (ours, Ubuntu's, Debian's) decode, re-encode to the same bytes, and yield the infohash every tracker, client and DHT node computes for them. If the schema could not do that it would be documentation; because it can, it is canonical.

Done so far, bottom up:

| Document | What it models | BEP |
|---|---|---|
| [`schema/bencode.jsonld`](schema/bencode.jsonld) | the encoding: four value types, canonical form as rules with error codes | 3 |
| [`schema/metainfo.jsonld`](schema/metainfo.jsonld) | the `.torrent` file: `MetaInfo`, `Info`, `FileEntry`; derived `infohash`, `magnet`, piece counts; validity rules | 3, 9, 12, 19, 27 |

Next, in order: the tracker protocols (HTTP, UDP — BEP 3, 15, 23), the peer wire protocol (BEP 3, 10, 9, 11), web seeds as a peer (BEP 19), the DHT (BEP 5), v2 (BEP 52); then **WebTorrent as an overlay**: the WebSocket tracker protocol (announce with offers, answers by peer id) and the wire protocol over an RTCDataChannel — a de facto standard from one implementation, worth writing down for exactly that reason. See [SPEC_COVERAGE.md](SPEC_COVERAGE.md).

## The codec

- [`codec/bencode.js`](codec/bencode.js): bencode, strict by default (canonical form enforced on input, every rule its error code), lenient on request; every decoded dictionary remembers its byte span, so the infohash is computed over the `info` dictionary **as it stands in the file**, not over a re-encoding.
- [`codec/codec.js`](codec/codec.js): `TorrentCodec` reads the schema documents; `decode('MetaInfo', bytes)`, `encode('MetaInfo', instance)`, `infohash(meta)`, `magnet(meta, infohash)`, `check(meta)` (the rules, first failure by error code), and `parse(bytes)` for all of it. Unknown keys are kept under `extra` so a file round-trips.
- [`codec/hash.js`](codec/hash.js): SHA-1 and SHA-256 on WebCrypto, so the same files run in Node and the browser.

```js
import { TorrentCodec } from './codec/codec.js';
const codec = new TorrentCodec(bencodeDoc, metainfoDoc);
const t = await codec.parse(bytes);   // { meta, infohash, magnet, pieceCount, totalLength, lastPieceLength, error }
```

## Tests

`npm test` — [`test/bencode.test.js`](test/bencode.test.js) (the BEP 3 examples, each canonical-form rule, round trips) and [`test/metainfo.test.js`](test/metainfo.test.js) (the three vectors in [`test/vectors/`](test/vectors/): infohash, fields, byte-exact re-encoding; the infohash unchanged by anything outside `info` and changed by anything inside it; every rule's error code; a multi-file torrent).

AGPL-3.0-or-later. Independent community project; not affiliated with the BitTorrent or WebTorrent projects.
