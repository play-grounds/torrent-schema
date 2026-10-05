// The tracker exchanges of schema/tracker.jsonld: the HTTP announce URL from an AnnounceRequest, the bencoded answers
// (announce, scrape) as instances with peer lists in one shape whatever the wire form, the UDP messages through the
// binary codec with the exchange rules applied. No network here: the caller sends and receives; this names the bytes.
import { TorrentCodec } from './codec.js';
import { BinaryCodec } from './binary.js';
import { decode as bdecode } from './bencode.js';
import { hexToBytes, bytesToHex } from './hash.js';

const pct = (bytes) => Array.from(bytes, (b) => '%' + b.toString(16).padStart(2, '0')).join('');
export class TrackerCodec {
  constructor(...docs) { this.docs = docs; this.bencoded = new TorrentCodec(...docs); this.binary = new BinaryCodec(...docs); this.announceReq = this.bencoded.struct('AnnounceRequest'); }
  /** the GET for an announce: every present field as key=value, bytes percent-encoded byte by byte */
  announceUrl(announce, req) {
    const parts = [];
    for (const f of this.announceReq.fields) { const v = req[f.label]; if (v === undefined || v === null) { if (f.required) throw new Error(`announce: '${f.label}' is required`); continue; }
      parts.push(`${f.key}=${f.valueType === 'bytes' ? pct(hexToBytes(v)) : encodeURIComponent(String(v))}`); }
    return announce + (announce.includes('?') ? '&' : '?') + parts.join('&');
  }
  /** the scrape URL for an announce URL (BEP 48): only if the last path component begins with 'announce' */
  scrapeUrl(announce, infohashes) { const u = new URL(announce); const i = u.pathname.lastIndexOf('/'); const last = u.pathname.slice(i + 1); if (!last.startsWith('announce')) return null; u.pathname = u.pathname.slice(0, i + 1) + 'scrape' + last.slice('announce'.length); return u.origin + u.pathname + '?' + infohashes.map((h) => 'info_hash=' + pct(hexToBytes(h))).join('&'); }
  /** an HTTP announce body: { response, error } with the rules applied; peers as [{ ip, port, 'peer id'? }] */
  parseAnnounce(bytes) {
    let v; try { v = bdecode(bytes, { strict: false }).value; } catch { return { error: 'tracker-not-bencode' }; } if (!(v instanceof Map)) return { error: 'tracker-not-bencode' };
    if (v.has('failure reason')) return { response: { 'failure reason': new TextDecoder().decode(v.get('failure reason')) }, error: 'tracker-refused' }; // nothing else is present then, the schema says
    let response; try { response = this.bencoded.fromValue('AnnounceResponse', v); } catch (e) { return { error: e.code ?? 'tracker-bad-response', detail: e.message }; }
    if (!(Number(response.interval) > 0)) return { response, error: 'tracker-no-interval' };
    return { response, error: null };
  }
  parseScrape(bytes) { let v; try { v = bdecode(bytes, { strict: false }).value; } catch { return { error: 'tracker-not-bencode' }; } if (!(v instanceof Map)) return { error: 'tracker-not-bencode' };
    try { const response = this.bencoded.fromValue('ScrapeResponse', v); return { response, error: response['failure reason'] !== undefined ? 'tracker-refused' : null }; } catch (e) { return { error: 'tracker-bad-scrape', detail: e.message }; } }
  // ---- UDP (BEP 15)
  udpEncode(name, inst) { return this.binary.encode(name, inst); }
  /** a UDP datagram read against the request it answers: the rules on length, action and transaction id */
  udpDecode(request, bytes) {
    const MIN = { 0: 16, 1: 20, 2: 8, 3: 8 }; if (bytes.length < 8) return { error: 'tracker-udp-short' };
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); const action = dv.getUint32(0), tid = dv.getUint32(4);
    if (tid !== Number(request.transaction_id)) return { error: 'tracker-udp-transaction' };
    if (action !== Number(request.action) && action !== 3) return { error: 'tracker-udp-action' };
    if (bytes.length < MIN[action]) return { error: 'tracker-udp-short' };
    const name = action === 3 ? 'UdpError' : ['UdpConnectResponse', 'UdpAnnounceResponse', 'UdpScrapeResponse'][action];
    try { const response = this.binary.decode(name, bytes); return { response, name, error: action === 3 ? 'tracker-refused' : null }; } catch (e) { return { error: e.code ?? 'tracker-udp-short', detail: e.message }; }
  }
  compactPeers(hex, v6 = false) { return this.bencoded.convert({ key: 'peers', valueType: v6 ? 'peers6' : 'peers' }, hexToBytes(hex)); }
  compactEncode(peers, v6 = false) { return bytesToHex(this.bencoded.unconvert({ valueType: v6 ? 'peers6' : 'peers' }, peers)); }
}
