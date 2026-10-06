// A peer from the schema: the WebSocket tracker protocol (webtorrent module), the handshake, frames, bitfield and
// block requests (wire module), the piece hash (metainfo module) — through the codec only, no torrent library.
import { TorrentCodec } from '../codec/codec.js';
import { WireCodec } from '../codec/wire.js';
import { WebTorrentCodec } from '../codec/webtorrent.js';
import { sha1, bytesToHex, hexToBytes } from '../codec/hash.js';
const $ = (id) => document.getElementById(id); const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const fmt = (n) => Number(n).toLocaleString('en-US'); const mb = (n) => (n / 1048576).toFixed(2) + ' MB';
const log = (t) => { $('log').textContent += new Date().toISOString().slice(11, 23) + ' ' + t + '\n'; };
const set = (id, html, cls) => { const e = $(id); e.innerHTML = html; e.className = cls ?? ''; };
const docs = await Promise.all(['bencode', 'metainfo', 'tracker', 'wire', 'webseed', 'webtorrent'].map((m) => fetch(`../schema/${m}.jsonld`).then((r) => r.json())));
const T = new TorrentCodec(...docs), W = new WireCodec(...docs), X = new WebTorrentCodec(...docs);
const kdoc = await (await fetch('../data/torrents.jsonld')).json(); const known = kdoc['@graph'].filter((n) => n['@type'] === 'bt:KnownTorrent' && n.file);
const wanted = (new URLSearchParams(location.search).get('h') ?? '').toLowerCase(); const entry = known.find((k) => k.infohash === wanted) ?? known[0];
const torrent = await T.parse(new Uint8Array(await (await fetch('../data/' + entry.file)).arrayBuffer()));
{ const nav = document.getElementById('which'); if (nav) nav.innerHTML = known.map((k) => k === entry ? `<b>${k.name}</b>` : `<a href="peer.html?h=${k.infohash}">${k.name}</a>`).join(' · '); }
const info = torrent.meta.info, PIECE_LENGTH = Number(info['piece length']), BLOCK = 16384;
set('t-torrent', `<a href="torrent.html?h=${torrent.infohash}">${esc(info.name)}</a> · infohash ${torrent.infohash} · ${fmt(torrent.pieceCount)} pieces of ${fmt(PIECE_LENGTH)} bytes${info.files ? ` · ${info.files.length} files` : ''}`);
{ const pn = document.getElementById('piece-note'); if (pn) pn.textContent = `of ${fmt(torrent.pieceCount)}, ${fmt(PIECE_LENGTH)} bytes each (the last is ${fmt(torrent.lastPieceLength)} bytes)`; }
const rand = (n) => bytesToHex(crypto.getRandomValues(new Uint8Array(n)));
const PEER_ID = bytesToHex(new TextEncoder().encode('-TS0001-')) + rand(12); set('t-ourid', PEER_ID + ' (' + esc('-TS0001-…') + ')');

let pc = null, dc = null, sockets = [], stopped = false, t0 = 0;
function stop(why) { stopped = true; for (const s of sockets) { try { s.close(); } catch {} } sockets = []; try { dc?.close(); } catch {} try { pc?.close(); } catch {} $('go').disabled = false; $('stop').disabled = true; if (why) { $('state').textContent = why; log(why); } }
$('stop').onclick = () => stop('stopped');
$('go').onclick = async () => {
  $('go').disabled = true; $('stop').disabled = false; stopped = false; $('log').textContent = ''; t0 = Date.now(); for (const id of ['t-reply', 't-answer', 't-dc', 't-hs', 't-ext', 't-bits', 't-blocks', 't-piece']) set(id, '—', 'mut'); $('bar').value = 0;
  const index = Math.max(0, Math.min(torrent.pieceCount - 1, Number($('piece').value) || 0)); const pieceLen = index === torrent.pieceCount - 1 ? torrent.lastPieceLength : PIECE_LENGTH; const nBlocks = Math.ceil(pieceLen / BLOCK);
  const trackers = $('trackers').value.split(',').map((s) => s.trim()).filter(Boolean);
  // ---- one offer per tracker: each tracker forwards what it is given, so the same offer on two trackers reaches the same
  // seeder twice and it answers twice — two connections with one set of ICE credentials, and the race breaks both.
  // WebTorrent clients make a fresh offer per tracker for this reason; so does this page. The first answer wins.
  const noTrickle = (sdp) => sdp.replace(/a=ice-options:trickle\s*\r?\n/g, '');
  const makeOffer = async () => {
    const c = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }); const d = c.createDataChannel('webrtc-datachannel'); d.binaryType = 'arraybuffer';
    await c.setLocalDescription(await c.createOffer());
    await new Promise((r) => { if (c.iceGatheringState === 'complete') return r(); c.addEventListener('icegatheringstatechange', () => c.iceGatheringState === 'complete' && r()); setTimeout(r, 3000); });
    // the tracker protocol carries whole descriptions and no later candidates, so the SDP must not say trickle: a receiver that
    // honours a=ice-options:trickle waits for candidates that never come (simple-peer strips it too; without this no stranger answered)
    return { pc: c, dc: d, offer: { type: 'offer', sdp: noTrickle(c.localDescription.sdp) }, offerId: rand(20) };
  };
  $('state').textContent = `making ${trackers.length} WebRTC offer(s), one per tracker…`;
  // several offers per tracker: a tracker forwards each offer to one peer, so one offer reaches one peer, which may be
  // capped or asleep; WebTorrent clients send numwant offers for this reason. The first answer, whichever offer, wins.
  const PER_TRACKER = 8; const attempts = new Map(); // url → [{ pc, dc, offer, offerId }]
  for (const url of trackers) { const list = []; for (let i = 0; i < PER_TRACKER; i++) list.push(await makeOffer()); attempts.set(url, list); }
  log(`${trackers.length * PER_TRACKER} offer(s) ready, ${PER_TRACKER} per tracker`);
  $('state').textContent = 'announcing…'; let answered = false, answers = 0;
  const answering = []; const closeOthers = (keep) => { for (const list of attempts.values()) for (const a of list) if (a !== keep) { try { a.pc.close(); } catch {} } for (const c of answering) if (c !== pc) { try { c.close(); } catch {} } };
  for (const [url, list] of attempts) {
    const announce = X.announce({ info_hash: torrent.infohash, peer_id: PEER_ID, numwant: PER_TRACKER, left: torrent.totalLength, event: 'started', offers: list.map((a) => ({ offer_id: a.offerId, offer: a.offer })) });
    let ws; try { ws = new WebSocket(url); } catch (e) { log(`${url}: ${e.message}`); continue; } sockets.push(ws);
    ws.onopen = () => { ws.send(JSON.stringify(announce)); log(`${url}: announced with ${list.length} offers`); };
    ws.onmessage = async (m) => { let msg; try { msg = JSON.parse(m.data); } catch { return; } const r = X.read(msg, { announced: [torrent.infohash], outstanding: list.map((a) => a.offerId) });
      if (r.kind === 'reply' && !r.error) { set('t-reply', `${esc(url.replace('wss://', ''))}: ${fmt(r.complete)} seeder(s), ${fmt(r.incomplete)} leecher(s), interval ${r.interval} s`); log(`${url}: reply · complete ${r.complete} incomplete ${r.incomplete}`); }
      else if (r.kind === 'answer' && !r.error) { const a = list.find((x) => x.offerId === r.offer_id); if (!a || a.answered) return; a.answered = true; answers++;
        // every answer is taken and its connection tried; the first data channel that opens wins (an answer is not a connection: NAT decides that)
        log(`${url}: answer from ${r.peer_id.slice(0, 16)}… (${esc(new TextDecoder().decode(hexToBytes(r.peer_id)).slice(0, 8))}) for offer ${r.offer_id.slice(0, 8)}…: connecting`); if (!answered) set('t-answer', `${answers} answer(s) so far: ${esc(url.replace('wss://', ''))} relayed one from ${r.peer_id} (${esc(new TextDecoder().decode(hexToBytes(r.peer_id)).slice(0, 8))}); connecting…`);
        a.peer = r.peer_id; a.via = url; a.pc.onconnectionstatechange = () => { log(`${a.via.replace('wss://', '')}/${a.peer.slice(0, 8)}: connection ${a.pc.connectionState}`); if (a.pc.connectionState === 'failed') { a.failed = true; if (!answered) set('t-dc', `${[...attempts.values()].flat().filter((x) => x.failed).length} connection(s) failed so far (NAT); still trying`, 'mut'); } };
        a.dc.onopen = () => { if (answered) return; answered = true; pc = a.pc; dc = a.dc; closeOthers(a); set('t-answer', `${esc(a.via.replace('wss://', ''))} relayed an answer from peer ${a.peer} (${esc(new TextDecoder().decode(hexToBytes(a.peer)).slice(0, 8))}); its connection opened`); wire(); dc.onopen(); };
        try { await a.pc.setRemoteDescription(r.answer); } catch (e) { log('setRemoteDescription: ' + e.message); } }
      else if (r.kind === 'offer' && !answered) { log(`${url}: peer ${r.peer_id.slice(0, 8)}… offered to us: answering`); try {
          const c = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }); let channel = null; c.ondatachannel = (ev) => { channel = ev.channel; channel.binaryType = 'arraybuffer'; const take = () => { if (answered) return; answered = true; pc = c; dc = channel; closeOthers(null); set('t-answer', `we answered an offer from peer ${r.peer_id} (${esc(new TextDecoder().decode(hexToBytes(r.peer_id)).slice(0, 8))}) via ${esc(url.replace('wss://', ''))}`); log('their data channel opened: we are the answerer'); wire(); dc.onopen(); }; if (channel.readyState === 'open') take(); else channel.onopen = take; };
          await c.setRemoteDescription(r.offer); await c.setLocalDescription(await c.createAnswer());
          await new Promise((res) => { if (c.iceGatheringState === 'complete') return res(); c.addEventListener('icegatheringstatechange', () => c.iceGatheringState === 'complete' && res()); setTimeout(res, 3000); });
          ws.send(JSON.stringify(X.answer({ info_hash: torrent.infohash, peer_id: PEER_ID, to_peer_id: r.peer_id, offer_id: r.offer_id, answer: { type: 'answer', sdp: c.localDescription.sdp } }))); answering.push(c);
        } catch (e) { log('answering failed: ' + e.message); } }
      else if (r.kind === 'offer') log(`${url}: another offer to us, not needed`);
      else if (r.error && r.kind === 'answer' && r.error === 'ws-unknown-offer') log(`${url}: an answer for an offer that is not this tracker's: ignored (the rule)`);
      else if (r.error) log(`${url}: ${r.kind} refused: ${r.error}`); };
    ws.onerror = () => log(`${url}: socket error`);
  }
  function wire() {
  let buf = new Uint8Array(0), handshaken = false, names = {}, unchoked = false; const blocks = new Map(); let next = 0, inflight = 0, received = 0;
  pc.onconnectionstatechange = () => { log('connection: ' + pc.connectionState); if (pc.connectionState === 'failed') stop('the WebRTC connection failed after opening'); };
  // ---- the data channel: the wire protocol, byte for byte as over TCP
  const send = (b) => dc.send(b);
  const ask = () => { while (unchoked && inflight < 8 && next < nBlocks && !stopped) { const begin = next * BLOCK; send(W.frame('Request', { index, begin, length: Math.min(BLOCK, pieceLen - begin) })); next++; inflight++; } };
  dc.onopen = () => { set('t-dc', 'open', 'ok'); log('data channel open: sending our handshake and extended handshake'); send(W.handshake({ info_hash: torrent.infohash, peer_id: PEER_ID })); send(W.extendedHandshake({ m: { ut_metadata: 1, ut_pex: 2 }, v: 'torrent-schema/0.0.3' })); $('state').textContent = 'handshaking…'; };
  dc.onmessage = async (ev) => {
    const chunk = new Uint8Array(ev.data); const joined = new Uint8Array(buf.length + chunk.length); joined.set(buf); joined.set(chunk, buf.length); buf = joined;
    if (!handshaken) { if (buf.length < 68) return; const h = W.readHandshake(buf); if (h.error || h.handshake.info_hash !== torrent.infohash) return stop('bad handshake: ' + (h.error ?? 'another infohash')); handshaken = true; buf = buf.subarray(68);
      set('t-hs', `peer ${h.handshake.peer_id} (${esc(new TextDecoder().decode(hexToBytes(h.handshake.peer_id)).slice(0, 8))}) · supports: ${Object.entries(h.supports).filter(([, v]) => v).map(([k]) => k).join(', ') || 'nothing beyond BEP 3'}`); log('their handshake: ok, same infohash'); }
    const { messages, rest, error } = W.feed(buf); buf = rest; if (error) return stop('wire: ' + error);
    for (const m of messages) {
      if (m.name === 'Bitfield') { const p = W.pieces(m.bits, torrent.pieceCount); if (p.error) return stop('wire-bad-bitfield'); set('t-bits', `${m.bits.length / 2} bytes · has ${fmt(p.have.length)} of ${fmt(torrent.pieceCount)} pieces${p.have.includes(index) ? '' : ' · <span class="bad">not the one we want</span>'}`); log(`bitfield: ${p.have.length}/${torrent.pieceCount}`); if (p.have.includes(index)) { send(W.frame('interested')); log('sent: interested'); } }
      else if (m.name === 'Extended') { const x = W.readExtended(m, names); if (x.kind === 'handshake') { names = Object.fromEntries(Object.entries(x.value.m ?? {}).map(([n, id]) => [id, n])); set('t-ext', `${esc(x.value.v ?? 'no version given')} · m ${esc(JSON.stringify(x.value.m))} · metadata_size ${fmt(x.value.metadata_size ?? 0)}`); log('their extended handshake: ' + (x.value.v ?? '')); } else log('extended: ' + x.kind); }
      else if (m.name === 'unchoke') { unchoked = true; log('unchoked: requesting ' + nBlocks + ' blocks, 8 in flight'); $('state').textContent = `fetching piece ${index}…`; ask(); }
      else if (m.name === 'choke') { unchoked = false; log('choked'); }
      else if (m.name === 'Piece') { if (m.index !== index) continue; inflight--; const data = hexToBytes(m.block); blocks.set(m.begin, data); received += data.length; $('bar').value = received / pieceLen; set('t-blocks', `${blocks.size} of ${nBlocks} · ${mb(received)} · ${(received / 1048576 / ((Date.now() - t0) / 1000)).toFixed(2)} MB/s since start`);
        if (blocks.size === nBlocks) { const piece = new Uint8Array(pieceLen); for (const [b, d] of blocks) piece.set(d, b); const h = bytesToHex(await sha1(piece)); const ok = h === info.pieces[index];
          set('t-piece', ok ? `<span class="ok">sha1 ${h} = pieces[${index}] ✓</span>${index === 0 ? ` · the first bytes are <span class="mono">${bytesToHex(piece.subarray(0, 7))}</span>: 'utxo' 0xff, format 2 — the UTXO snapshot's own header` : ''}` : `<span class="bad">sha1 ${h} ≠ pieces[${index}] ${info.pieces[index]}</span>`, '');
          log(`piece ${index}: ${piece.length} bytes, sha1 ${ok ? 'matches' : 'DOES NOT MATCH'} pieces[${index}]`); stop(`done: piece ${index} ${ok ? 'verified' : 'FAILED'} in ${((Date.now() - t0) / 1000).toFixed(1)} s`); return; }
        ask(); }
      else if (m.name === 'keep-alive' || m.name === 'Have' || m.name === 'Port') { /* noted */ }
      else log('message: ' + m.name);
    }
  };
  dc.onclose = () => { if (!stopped) stop('the data channel closed'); };
  }
  setTimeout(() => { if (!answered && !stopped) stop(answers ? `${answers} answer(s) in 60 s but no connection opened: every pair failed to traverse NAT (no TURN server here)` : 'no answer within 60 s: no peer in this swarm took any of our offers, and none offered to us'); }, 60000);
};
