# Spec coverage

What the schema models, by BEP. "modelled" means a document exists and the codec reads it; "tested" means real data round-trips.

| BEP | Title | Status |
|---|---|---|
| 3 | The BitTorrent Protocol — bencode, metainfo | modelled, tested (three real torrents) |
| 3 | — tracker HTTP protocol | modelled, tested (opentrackr) |
| 3 | — peer wire protocol | modelled, tested (a real session with a seeder) |
| 5 | DHT | the PORT message and reserved bit modelled; the DHT itself planned |
| 9 | Extension for peers to send metadata files; magnet links | modelled, tested (`ut_metadata`, magnet derivation) |
| 10 | Extension protocol | modelled, tested (extended handshakes from a real peer) |
| 11 | Peer exchange | modelled, tested (`ut_pex`) |
| 6 | Fast extension | the reserved bit modelled; messages 13–17 planned |
| 20 | Peer id conventions | noted |
| 12 | Multitracker metadata extension (`announce-list`) | modelled |
| 15 | UDP tracker protocol | modelled, tested (opentrackr, byte-exact) |
| 19 | WebSeed — HTTP/FTP seeding (`url-list`) | modelled, tested (the Range request and its checks) |
| 23 | Tracker returns compact peer lists | modelled, tested |
| 7 | IPv6 tracker extension (`peers6`) | modelled, tested |
| 48 | Tracker scrape | modelled, tested (HTTP and UDP) |
| 27 | Private torrents | field modelled |
| 52 | v2 (SHA-256, merkle trees, hybrid) | planned |
| — | WebTorrent: WebSocket tracker protocol, wire protocol over RTCDataChannel | modelled, tested (a real exchange with tracker.openwebtorrent.com; the connection reached 'connected') |
| — | NIP-35: a torrent as a Nostr event (kind 2003), comments (kind 2004) | modelled, tested (the real event announcing the txbt4 snapshot, checked against its .torrent; id recomputed; signature not checked, no secp256k1 here) |
