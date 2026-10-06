# Torrent Schema

**v0.0.3** · A machine-readable model of BitTorrent, written in JSON-LD, in the manner of [bitcoin-desktop/schema](https://github.com/bitcoin-desktop/schema): the schema is the source of truth and the code is a projection of it.

**Live:** https://play-grounds.github.io/torrent-schema/ — the schema rendered from its own documents · [a peer from the schema](https://play-grounds.github.io/torrent-schema/apps/peer.html): a BitTorrent peer in the browser with no library — tracker, WebRTC, handshake, bitfield, a verified piece of the UTXO snapshot · [torrent decoder](https://play-grounds.github.io/torrent-schema/apps/decode.html): drop a `.torrent` and the schema decodes it · [known trackers](https://play-grounds.github.io/torrent-schema/apps/trackers.html): every public WebSocket tracker we know of, as JSON-LD, each asked live.

A playground, started for [utxo-swarm](https://github.com/play-grounds/utxo-swarm). Nothing depends on it yet.

## The idea

BitTorrent is specified as numbered BEPs and implemented many times over; the implementations agree because the specs are good, but there is no single document a program can read. This repo writes the protocol down as data: structures with their fields, each field with its bencode key and value type; derived values with their derivation; validity rules with their error codes. A generic codec walks the schema — it has no per-field code — and the keystone test is that it must reproduce reality byte-exactly: three real `.torrent` files (ours, Ubuntu's, Debian's) decode, re-encode to the same bytes, and yield the infohash every tracker, client and DHT node computes for them; a real tracker's answers — UDP connect, announce and scrape, HTTP announce and scrape, captured from opentrackr for our infohash — decode to the counts it reported and re-encode to the bytes it sent; and a real peer session — handshakes, extended handshakes, bitfield, request, piece, captured from a seeder through this codec — in which all 256 blocks of piece 0 were assembled and hashed to `pieces[0]`, the first bytes being the UTXO snapshot's own header; a session with **qBittorrent 5.3.0rc1** (libtorrent 2.1, a third implementation) seeding the snapshot — its handshake, its extended handshake with libtorrent's extensions, piece 0 verified again; and a real WebSocket-tracker exchange with tracker.openwebtorrent.com — an announce carrying a WebRTC offer, the tracker's reply, the seeder's answer routed back — after which the WebRTC connection reached *connected*. If the schema could not do that it would be documentation; because it can, it is canonical.

Done so far, bottom up:

| Document | What it models | BEP |
|---|---|---|
| [`schema/bencode.jsonld`](schema/bencode.jsonld) | the encoding: four value types, canonical form as rules with error codes | 3 |
| [`schema/metainfo.jsonld`](schema/metainfo.jsonld) | the `.torrent` file: `MetaInfo`, `Info`, `FileEntry`; derived `infohash`, `magnet`, piece counts; validity rules | 3, 9, 12, 19, 27 |
| [`schema/tracker.jsonld`](schema/tracker.jsonld) | finding peers: the HTTP announce (query and bencoded answer) and scrape, compact peers v4/v6, the UDP protocol as fixed binary layouts, the exchange rules with error codes | 3, 15, 23, 7, 48 |
| [`schema/wire.jsonld`](schema/wire.jsonld) | peer to peer: the 68-byte handshake and its reserved bits, frames and every message by id, the extension protocol (extended handshake, `ut_metadata` with its trailing bytes, `ut_pex`), the rules a peer enforces | 3, 10, 9, 11, 6, 5 |
| [`schema/webseed.jsonld`](schema/webseed.jsonld) | an HTTP server as a peer: a block as a Range request, what the answer must look like, CORS from a browser | 19 |
| [`schema/webtorrent.jsonld`](schema/webtorrent.jsonld) | **the overlay**: the WebSocket tracker protocol in JSON — announces carrying WebRTC offers, the tracker's reply, forwarded offers, answers routed by peer id — and the statement that the wire protocol runs over the data channel unchanged. No BEP: written down from a captured exchange | — |

Next, in order: the peer wire protocol (BEP 3, 10, 9, 11), web seeds as a peer (BEP 19), the DHT (BEP 5), v2 (BEP 52); then **WebTorrent as an overlay**: the WebSocket tracker protocol (announce with offers, answers by peer id) and the wire protocol over an RTCDataChannel — a de facto standard from one implementation, worth writing down for exactly that reason. See [SPEC_COVERAGE.md](SPEC_COVERAGE.md).

## Data model

The metainfo structures as a UML class diagram — **generated from [`schema/metainfo.jsonld`](schema/metainfo.jsonld)** by [`tools/gen-class-diagram.js`](tools/gen-class-diagram.js), so it can never drift. Filled diamonds are composition; `+name()` methods are **derived** values (computed from the bytes, never stored); `?` marks optional fields.

```mermaid
classDiagram
  direction TB
  class MetaInfo {
    +utf8? announce
    +utf8[][]? announce-list
    +utf8[]? url-list
    +int? creation_date
    +utf8? comment
    +utf8? created_by
    +utf8? encoding
    +infohash() derived
    +magnet() derived
  }
  class Info {
    +utf8 name
    +int piece_length
    +hashes pieces
    +int? length
    +int? private
    +pieceCount() derived
    +totalLength() derived
    +lastPieceLength() derived
  }
  class FileEntry {
    +int length
    +utf8[] path
  }
  MetaInfo "1" *-- "1" Info : info
  Info "1" *-- "0..*" FileEntry : files
```

The tracker module's structures, the same way:

```mermaid
classDiagram
  direction TB
  class AnnounceRequest {
    +bytes info_hash
    +bytes peer_id
    +int port
    +int uploaded
    +int downloaded
    +int left
    +int? compact
    +int? no_peer_id
    +utf8? event
    +utf8? ip
    +int? numwant
    +utf8? key
    +utf8? trackerid
    +url() derived
  }
  class AnnounceResponse {
    +utf8? failure_reason
    +utf8? warning_message
    +int? interval
    +int? min_interval
    +utf8? tracker_id
    +int? complete
    +int? incomplete
    +int? downloaded
    +peers? peers
    +peers6? peers6
  }
  class Peer {
    +bytes? peer_id
    +utf8 ip
    +int port
  }
  class ScrapeResponse {
    +utf8? failure_reason
  }
  class ScrapeEntry {
    +int complete
    +int downloaded
    +int incomplete
    +utf8? name
  }
  class CompactPeer {
    +ip4 ip
    +u16be port
  }
  class CompactPeer6 {
    +ip6 ip
    +u16be port
  }
  class UdpConnectRequest {
    +u64be protocol_id
    +u32be action
    +u32be transaction_id
  }
  class UdpConnectResponse {
    +u32be action
    +u32be transaction_id
    +u64be connection_id
  }
  class UdpAnnounceRequest {
    +u64be connection_id
    +u32be action
    +u32be transaction_id
    +bytes20 info_hash
    +bytes20 peer_id
    +u64be downloaded
    +u64be left
    +u64be uploaded
    +u32be event
    +u32be ip
    +u32be key
    +i32be num_want
    +u16be port
  }
  class UdpAnnounceResponse {
    +u32be action
    +u32be transaction_id
    +u32be interval
    +u32be leechers
    +u32be seeders
  }
  class UdpScrapeRequest {
    +u64be connection_id
    +u32be action
    +u32be transaction_id
    +bytes20[] info_hashes
  }
  class UdpScrapeResponse {
    +u32be action
    +u32be transaction_id
  }
  class UdpScrapeCounts {
    +u32be seeders
    +u32be completed
    +u32be leechers
  }
  class UdpError {
    +u32be action
    +u32be transaction_id
    +utf8rest message
  }
  ScrapeResponse "1" *-- "1..*" ScrapeEntry : files
  UdpAnnounceResponse "1" *-- "0..*" CompactPeer : peers
  UdpScrapeResponse "1" *-- "0..*" UdpScrapeCounts : counts
```

The wire module:

```mermaid
classDiagram
  direction TB
  class Handshake {
    +u8 pstrlen
    +bytes pstr
    +bytes reserved
    +bytes20 info_hash
    +bytes20 peer_id
  }
  class Frame {
    +u32be length
    +rest body
  }
  class Have {
    +u32be index
  }
  class Bitfield {
    +rest bits
  }
  class Request {
    +u32be index
    +u32be begin
    +u32be length
  }
  class Piece {
    +u32be index
    +u32be begin
    +rest block
  }
  class Cancel {
    +u32be index
    +u32be begin
    +u32be length
  }
  class Port {
    +u16be port
  }
  class Extended {
    +u8 ext_id
    +rest payload
  }
  class ExtendedHandshake {
    +dictInt m
    +utf8? v
    +int? p
    +int? reqq
    +int? metadata_size
    +bytes? yourip
    +bytes? ipv6
    +bytes? ipv4
  }
  class UtMetadata {
    +int msg_type
    +int piece
    +int? total_size
  }
  class UtPex {
    +peers? added
    +bytes? added.f
    +peers? dropped
    +peers6? added6
    +bytes? added6.f
    +peers6? dropped6
  }
```

The WebTorrent overlay:

```mermaid
classDiagram
  direction TB
  class SessionDescription {
    +utf8 type
    +utf8 sdp
  }
  class WsOffer {
    +bytes offer_id
  }
  class WsAnnounce {
    +utf8 action
    +bytes info_hash
    +bytes peer_id
    +int? numwant
    +int? uploaded
    +int? downloaded
    +int? left
    +utf8? event
  }
  class WsAnnounceReply {
    +utf8 action
    +bytes? info_hash
    +int interval
    +int? complete
    +int? incomplete
    +utf8? failure_reason
    +utf8? warning_message
  }
  class WsOfferForwarded {
    +utf8 action
    +bytes info_hash
    +bytes peer_id
    +bytes offer_id
  }
  class WsAnswer {
    +utf8 action
    +bytes info_hash
    +bytes peer_id
    +bytes? to_peer_id
    +bytes offer_id
  }
  class WsScrape {
    +utf8 action
    +bytes? info_hash
  }
  WsOffer "1" *-- "1" SessionDescription : offer
  WsAnnounce "1" *-- "1..*" WsOffer : offers
  WsOfferForwarded "1" *-- "1" SessionDescription : offer
  WsAnswer "1" *-- "1" SessionDescription : answer
```

## The codec

- [`codec/bencode.js`](codec/bencode.js): bencode, strict by default (canonical form enforced on input, every rule its error code), lenient on request; every decoded dictionary remembers its byte span, so the infohash is computed over the `info` dictionary **as it stands in the file**, not over a re-encoding.
- [`codec/codec.js`](codec/codec.js): `TorrentCodec` reads the schema documents; `decode('MetaInfo', bytes)`, `encode('MetaInfo', instance)`, `infohash(meta)`, `magnet(meta, infohash)`, `check(meta)` (the rules, first failure by error code), and `parse(bytes)` for all of it. Unknown keys are kept under `extra` so a file round-trips.
- [`codec/binary.js`](codec/binary.js): `BinaryCodec`, the fixed-layout codec for structs with `wireType` fields (big-endian integers, fixed bytes, IPv4/IPv6, nested structs, `repeat: toEnd`); the UDP tracker messages today, the peer wire protocol next.
- [`codec/tracker.js`](codec/tracker.js): `TrackerCodec` — `announceUrl`, `scrapeUrl`, `parseAnnounce`, `parseScrape` (the rules applied, every error by its code), `udpEncode`/`udpDecode` (length, action and transaction id checked), compact peers both ways.
- [`codec/wire.js`](codec/wire.js): `WireCodec` — the handshake (reserved bits as `supports`), `frame`/`feed` (whole frames out of a stream, partial ones kept, over-long ones refused), bitfields both ways with the spare-bit rule, the extension protocol (`extendedHandshake`, `readExtended` with the receiver's id table, `utMetadata` with trailing bytes).
- [`codec/webtorrent.js`](codec/webtorrent.js): `WebTorrentCodec` — the announce with offers (ids as binary strings), answers addressed by peer id, `read` telling a reply, a forwarded offer and an answer apart with the rules applied (unknown offer, wrong torrent, bad id, bad SDP type); the web seed request for a block (BEP 19) and the check of its answer.
- [`codec/hash.js`](codec/hash.js): SHA-1 and SHA-256 on WebCrypto, so the same files run in Node and the browser.
- [`apps/peer.html`](apps/peer.html) + [`apps/peer.js`](apps/peer.js): the peer — announces over the WebSocket trackers with a WebRTC offer, takes a seeder's answer, runs the wire protocol over the data channel, fetches a piece block by block and checks its SHA-1; two implementations sharing no code, exchanging a verified piece. First run: piece 0 of the snapshot from the utxo-swarm seeder in 0.6 s.
- [`apps/tracker.html`](apps/tracker.html)`?t=<host>` + [`data/torrents.jsonld`](data/torrents.jsonld): one tracker's page — its entry (also embedded as JSON-LD), then asked live: an announce, a scrape of the torrents we can name (a `KnownTorrent` each: the snapshot, the WebTorrent demo films, two ISOs), an announce per torrent where scrape is refused, and a scrape with no infohash last (refused or ignored by all three live ones: a tracker keeps its list to itself).
- [`data/trackers.jsonld`](data/trackers.jsonld) + [`apps/trackers.html`](apps/trackers.html): the known trackers as `Tracker` entries (url, transport, operator, since, source, notes — a claim with a source), and the page that asks each WebSocket one live (alive, latency, seeders for the snapshot): the whole public infrastructure for browser swarms, measured. Additions by pull request, with a source.
- [`apps/decode.html`](apps/decode.html): the decoder page; [`apps/browse.js`](apps/browse.js): the front page, which renders whatever is in `schema/`.

```js
import { TorrentCodec } from './codec/codec.js';
const codec = new TorrentCodec(bencodeDoc, metainfoDoc);
const t = await codec.parse(bytes);   // { meta, infohash, magnet, pieceCount, totalLength, lastPieceLength, error }
```

## Tests

`npm test` — [`test/bencode.test.js`](test/bencode.test.js) (the BEP 3 examples, each canonical-form rule, round trips) and [`test/metainfo.test.js`](test/metainfo.test.js) (the three vectors in [`test/vectors/`](test/vectors/): infohash, fields, byte-exact re-encoding; the infohash unchanged by anything outside `info` and changed by anything inside it; every rule's error code; a multi-file torrent) and [`test/tracker.test.js`](test/tracker.test.js) (the captured exchanges in [`test/vectors/tracker/`](test/vectors/tracker/): requests re-encode to the bytes sent, responses decode to the counts reported and re-encode byte-exactly, every exchange rule by its code — including opentrackr's HTML answer to a non-compact announce) and [`test/wire.test.js`](test/wire.test.js) (the captured session in [`test/vectors/wire/`](test/vectors/wire/): handshakes, frames, the bitfield, the first block of piece 0 beginning `utxo\xff`, the extended handshakes, ut_metadata and ut_pex; and the same session with qBittorrent 5.3.0rc1 in [`test/vectors/wire-qbittorrent/`](test/vectors/wire-qbittorrent/)) and [`test/webtorrent.test.js`](test/webtorrent.test.js) (the captured exchange in [`test/vectors/webtorrent/`](test/vectors/webtorrent/), addresses in the SDP replaced by documentation addresses; the web seed Range for the first, a middle and the last block of the snapshot).

AGPL-3.0-or-later. Independent community project; not affiliated with the BitTorrent or WebTorrent projects.
