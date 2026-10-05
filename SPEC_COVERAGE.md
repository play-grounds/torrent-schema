# Spec coverage

What the schema models, by BEP. "modelled" means a document exists and the codec reads it; "tested" means real data round-trips.

| BEP | Title | Status |
|---|---|---|
| 3 | The BitTorrent Protocol — bencode, metainfo | modelled, tested (three real torrents) |
| 3 | — tracker HTTP protocol | modelled, tested (opentrackr) |
| 3 | — peer wire protocol | planned |
| 5 | DHT | planned |
| 9 | Extension for peers to send metadata files; magnet links | magnet derivation modelled; metadata exchange planned |
| 10 | Extension protocol | planned |
| 11 | Peer exchange | planned |
| 12 | Multitracker metadata extension (`announce-list`) | modelled |
| 15 | UDP tracker protocol | modelled, tested (opentrackr, byte-exact) |
| 19 | WebSeed — HTTP/FTP seeding (`url-list`) | field modelled; the peer behaviour planned |
| 23 | Tracker returns compact peer lists | modelled, tested |
| 7 | IPv6 tracker extension (`peers6`) | modelled, tested |
| 48 | Tracker scrape | modelled, tested (HTTP and UDP) |
| 27 | Private torrents | field modelled |
| 52 | v2 (SHA-256, merkle trees, hybrid) | planned |
| — | WebTorrent: WebSocket tracker protocol, wire protocol over RTCDataChannel | planned, as an overlay |
