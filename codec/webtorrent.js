// The WebSocket tracker protocol of schema/webtorrent.jsonld: the announce a browser sends (ids as binary strings),
// the tracker's reply, forwarded offers and answers told apart and checked, and the web seed request of
// schema/webseed.jsonld. No sockets, no WebRTC: the page or the seeder brings those.
import { hexToBytes, bytesToHex } from './hash.js';
export const toBinary = (hex) => String.fromCharCode(...hexToBytes(hex));
export const fromBinary = (s) => bytesToHex(Uint8Array.from(s, (c) => c.charCodeAt(0)));
const isId = (s) => typeof s === 'string' && s.length === 20 && [...s].every((c) => c.charCodeAt(0) < 256);
export class WebTorrentCodec {
  constructor(...docs) { this.docs = docs; }
  /** the announce message: hex ids in, binary strings out; offers as [{ offer_id (hex), offer: { type, sdp } }] */
  announce({ info_hash, peer_id, offers = [], numwant = offers.length, uploaded = 0, downloaded = 0, left, event }) {
    const m = { action: 'announce', info_hash: toBinary(info_hash), peer_id: toBinary(peer_id), numwant, uploaded, downloaded, left };
    if (event) m.event = event; if (offers.length) m.offers = offers.map((o) => ({ offer: o.offer, offer_id: toBinary(o.offer_id) })); return m;
  }
  /** an answer to a forwarded offer, addressed to the offerer */
  answer({ info_hash, peer_id, to_peer_id, offer_id, answer }) { return { action: 'announce', info_hash: toBinary(info_hash), peer_id: toBinary(peer_id), to_peer_id: toBinary(to_peer_id), answer, offer_id: toBinary(offer_id) }; }
  scrape(info_hash) { return info_hash ? { action: 'scrape', info_hash: Array.isArray(info_hash) ? info_hash.map(toBinary) : toBinary(info_hash) } : { action: 'scrape' }; }
  /** a message from the tracker, told apart and checked: { kind: 'reply' | 'offer' | 'answer' | 'scrape' | 'failure', ...ids as hex, error } */
  read(msg, { announced = [], outstanding = [] } = {}) {
    if (!msg || typeof msg !== 'object') return { kind: 'unknown', error: 'ws-bad-message' };
    if (msg['failure reason']) return { kind: 'failure', reason: msg['failure reason'], error: 'tracker-refused' };
    if (msg.action === 'scrape') return { kind: 'scrape', files: msg.files, error: null };
    if (msg.action !== 'announce') return { kind: 'unknown', error: 'ws-bad-message' };
    const ih = isId(msg.info_hash) ? fromBinary(msg.info_hash) : null;
    if (msg.offer) { if (!isId(msg.info_hash) || !isId(msg.peer_id) || !isId(msg.offer_id)) return { kind: 'offer', error: 'ws-bad-id' }; if (announced.length && !announced.includes(ih)) return { kind: 'offer', info_hash: ih, error: 'ws-wrong-torrent' }; if (msg.offer.type !== 'offer') return { kind: 'offer', error: 'ws-bad-sdp' };
      return { kind: 'offer', info_hash: ih, peer_id: fromBinary(msg.peer_id), offer_id: fromBinary(msg.offer_id), offer: msg.offer, error: null }; }
    if (msg.answer) { if (!isId(msg.info_hash) || !isId(msg.peer_id) || !isId(msg.offer_id)) return { kind: 'answer', error: 'ws-bad-id' }; const oid = fromBinary(msg.offer_id); if (announced.length && !announced.includes(ih)) return { kind: 'answer', info_hash: ih, error: 'ws-wrong-torrent' }; if (outstanding.length && !outstanding.includes(oid)) return { kind: 'answer', offer_id: oid, error: 'ws-unknown-offer' }; if (msg.answer.type !== 'answer') return { kind: 'answer', error: 'ws-bad-sdp' };
      return { kind: 'answer', info_hash: ih, peer_id: fromBinary(msg.peer_id), offer_id: oid, answer: msg.answer, error: null }; }
    if (!(Number(msg.interval) > 0)) return { kind: 'reply', info_hash: ih, error: 'ws-no-interval' };
    return { kind: 'reply', info_hash: ih, interval: msg.interval, complete: msg.complete ?? null, incomplete: msg.incomplete ?? null, error: null };
  }
  /** BEP 19: the GET for a block of a single-file torrent at a web seed URL */
  webSeedRequest(url, info, { index, begin, length }) {
    const pieceLength = Number(info['piece length']); const total = Number(info.length); const first = index * pieceLength + begin; const last = Math.min(first + length, total) - 1;
    if (info.files) throw new Error('multi-file web seed requests are per file: not modelled yet'); if (first > last || last >= total) throw new Error('block outside the file');
    return { url: url.endsWith('/') ? url + encodeURIComponent(info.name) : url, headers: { Range: `bytes=${first}-${last}` }, first, last };
  }
  webSeedCheck(res, { first, last }) { if (res.status === 200) return 'webseed-no-range'; if (res.status !== 206) return 'webseed-no-range'; const cr = res.headers?.['content-range'] ?? res.headers?.get?.('content-range'); if (!cr || !cr.startsWith(`bytes ${first}-${last}/`)) return 'webseed-no-range'; if (res.byteLength !== undefined && res.byteLength !== last - first + 1) return 'webseed-bad-length'; return null; }
}
