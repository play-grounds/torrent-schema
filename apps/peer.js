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
// the files in piece-stream order with their byte offsets: a file is the bytes [offset, offset + length) of the stream
const FILES = []; { let off = 0; for (const f of info.files ?? [{ path: [info.name], length: info.length }]) { FILES.push({ path: f.path.join('/'), length: Number(f.length), offset: off }); off += Number(f.length); } }
const pieceLen = (i) => (i === torrent.pieceCount - 1 ? torrent.lastPieceLength : PIECE_LENGTH);
{ const sel = $('file'); FILES.forEach((f, i) => { const o = document.createElement('option'); o.value = i; o.textContent = `${f.path} (${fmt(f.length)} bytes)`; sel.appendChild(o); }); const best = FILES.map((f, i) => [f, i]).filter(([f]) => /\.(mp4|webm|m4v|mp3|ogg|m4a|wav)$/i.test(f.path)).sort((a, b) => b[0].length - a[0].length)[0]; sel.value = best ? best[1] : 0;
  const note = () => { const f = FILES[sel.value]; const a = Math.floor(f.offset / PIECE_LENGTH), z = Math.floor((f.offset + f.length - 1) / PIECE_LENGTH); $('file-note').textContent = `pieces ${a}–${z} (${z - a + 1} of them)`; }; sel.onchange = note; note(); }
set('t-torrent', `<a href="torrent.html?h=${torrent.infohash}">${esc(info.name)}</a> · infohash ${torrent.infohash} · ${fmt(torrent.pieceCount)} pieces of ${fmt(PIECE_LENGTH)} bytes${info.files ? ` · ${info.files.length} files` : ''}`);
{ const pn = document.getElementById('piece-note'); if (pn) pn.textContent = `of ${fmt(torrent.pieceCount)}, ${fmt(PIECE_LENGTH)} bytes each (the last is ${fmt(torrent.lastPieceLength)} bytes)`; }
const rand = (n) => bytesToHex(crypto.getRandomValues(new Uint8Array(n)));
const PEER_ID = bytesToHex(new TextEncoder().encode('-TS0001-')) + rand(12); set('t-ourid', PEER_ID + ' (' + esc('-TS0001-…') + ')');

let pc = null, dc = null, sockets = [], stopped = false, t0 = 0;
function stop(why) { stopped = true; for (const s of sockets) { try { s.close(); } catch {} } sockets = []; try { dc?.close(); } catch {} try { pc?.close(); } catch {} $('go').disabled = false; $('stop').disabled = true; if (why) { $('state').textContent = why; log(why); } }
$('stop').onclick = () => stop('stopped');
let JOB = null; // { pieces: [index…], play: file | null }
$('gofile').onclick = () => { const f = FILES[$('file').value]; const a = Math.floor(f.offset / PIECE_LENGTH), z = Math.floor((f.offset + f.length - 1) / PIECE_LENGTH); JOB = { pieces: Array.from({ length: z - a + 1 }, (_, i) => a + i), play: f }; $('go').click(); };
$('go').onclick = async () => {
  $('go').disabled = true; $('stop').disabled = false; stopped = false; $('log').textContent = ''; t0 = Date.now(); for (const id of ['t-reply', 't-answer', 't-dc', 't-hs', 't-ext', 't-bits', 't-blocks', 't-piece']) set(id, '—', 'mut'); $('bar').value = 0;
  const clamp = (n) => Math.max(0, Math.min(torrent.pieceCount - 1, Number(n) || 0)); const range = String($('piece').value).match(/^\s*(\d+)\s*-\s*(\d+)\s*$/); // "2-4" fetches several pieces, no file
  const job = JOB ?? { pieces: range ? Array.from({ length: clamp(range[2]) - clamp(range[1]) + 1 }, (_, i) => clamp(range[1]) + i) : [clamp($('piece').value)], play: null }; JOB = null; $('play-card').hidden = true;
  const index = job.pieces[0]; const totalBytes = job.pieces.reduce((n, i) => n + pieceLen(i), 0); const nBlocksOf = (i) => Math.ceil(pieceLen(i) / BLOCK);
  const store = new Map(); // piece index → Map(begin → bytes)
  const verified = new Map(); // piece index → Uint8Array once its SHA-1 matched
  const queue = []; for (const i of job.pieces) for (let b = 0; b < nBlocksOf(i); b++) queue.push({ index: i, begin: b * BLOCK, length: Math.min(BLOCK, pieceLen(i) - b * BLOCK) });
  const want = new Set(job.pieces);
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
  const answering = []; const closeOthers = (keep) => { for (const list of attempts.values()) for (const a of list) if (a !== keep) { try { a.pc.close(); } catch {} } for (const a of answering) if (a !== keep) { try { a.pc.close(); } catch {} } };
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
        a.dc.onopen = () => { if (answered) return; log(`${a.via.replace('wss://', '')}/${a.peer.slice(0, 8)}: data channel open, handshaking to see what it has`); wire(a); a.dc.onopen(); };
        try { await a.pc.setRemoteDescription(r.answer); } catch (e) { log('setRemoteDescription: ' + e.message); } }
      else if (r.kind === 'offer' && !answered) { log(`${url}: peer ${r.peer_id.slice(0, 8)}… offered to us: answering`); try {
          const c = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }); let channel = null; c.ondatachannel = (ev) => { channel = ev.channel; channel.binaryType = 'arraybuffer'; const a = { pc: c, dc: channel, peer: r.peer_id, via: url + ' (their offer)' }; answering.push(a); const take = () => { if (answered) return; log('their data channel opened: we are the answerer; handshaking'); wire(a); a.dc.onopen(); }; if (channel.readyState === 'open') take(); else channel.onopen = take; };
          await c.setRemoteDescription(r.offer); await c.setLocalDescription(await c.createAnswer());
          await new Promise((res) => { if (c.iceGatheringState === 'complete') return res(); c.addEventListener('icegatheringstatechange', () => c.iceGatheringState === 'complete' && res()); setTimeout(res, 3000); });
          ws.send(JSON.stringify(X.answer({ info_hash: torrent.infohash, peer_id: PEER_ID, to_peer_id: r.peer_id, offer_id: r.offer_id, answer: { type: 'answer', sdp: c.localDescription.sdp } }))); answering.push(c);
        } catch (e) { log('answering failed: ' + e.message); } }
      else if (r.kind === 'offer') log(`${url}: another offer to us, not needed`);
      else if (r.error && r.kind === 'answer' && r.error === 'ws-unknown-offer') log(`${url}: an answer for an offer that is not this tracker's: ignored (the rule)`);
      else if (r.error) log(`${url}: ${r.kind} refused: ${r.error}`); };
    ws.onerror = () => log(`${url}: socket error`);
  }
  let next = 0, inflight = 0, received = 0, t1 = Date.now(); let active = null; // the connection the job runs on, once one has what we need
  function wire(a) {
  let buf = new Uint8Array(0), handshaken = false, names = {}, unchoked = false; const dc = a.dc, pc = a.pc;
  pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed' && active === a) stop('the WebRTC connection failed after opening'); };
  // ---- the data channel: the wire protocol, byte for byte as over TCP
  const send = (b) => { try { dc.send(b); } catch {} };
  const ask = () => { if (active !== a) return; while (unchoked && inflight < 12 && next < queue.length && !stopped) { send(W.frame('Request', queue[next])); next++; inflight++; } };
  dc.onopen = () => { if (a.greeted) return; a.greeted = true; log(`${a.peer?.slice(0, 8) ?? 'peer'}: sending our handshake and extended handshake`); send(W.handshake({ info_hash: torrent.infohash, peer_id: PEER_ID })); send(W.extendedHandshake({ m: { ut_metadata: 1, ut_pex: 2 }, v: 'torrent-schema/0.0.3' })); $('state').textContent = 'handshaking…'; };
  dc.onmessage = async (ev) => {
    const chunk = new Uint8Array(ev.data); const joined = new Uint8Array(buf.length + chunk.length); joined.set(buf); joined.set(chunk, buf.length); buf = joined;
    if (!handshaken) { if (buf.length < 68) return; const h = W.readHandshake(buf); if (h.error || h.handshake.info_hash !== torrent.infohash) return stop('bad handshake: ' + (h.error ?? 'another infohash')); handshaken = true; buf = buf.subarray(68);
      set('t-hs', `peer ${h.handshake.peer_id} (${esc(new TextDecoder().decode(hexToBytes(h.handshake.peer_id)).slice(0, 8))}) · supports: ${Object.entries(h.supports).filter(([, v]) => v).map(([k]) => k).join(', ') || 'nothing beyond BEP 3'}`); log('their handshake: ok, same infohash'); }
    const { messages, rest, error } = W.feed(buf); buf = rest; if (error) return stop('wire: ' + error);
    for (const m of messages) {
      if (m.name === 'Bitfield') { const p = W.pieces(m.bits, torrent.pieceCount); if (p.error) { log(`${a.peer.slice(0, 8)}: bad bitfield: dropped`); try { pc.close(); } catch {} return; } const hv = new Set(p.have); const has = job.pieces.every((i) => hv.has(i)); log(`${a.peer.slice(0, 8)}: bitfield ${p.have.length}/${torrent.pieceCount}${has ? ' — has everything we need' : ' — not enough, waiting for another peer'}`);
        if (!has) { if (!active) set('t-bits', `${a.peer.slice(0, 8)}… has ${fmt(p.have.length)} of ${fmt(torrent.pieceCount)} pieces: not all we need; waiting for a peer that has them`, 'mut'); try { pc.close(); } catch {} return; }
        if (active) return; active = a; answered = true; closeOthers(a); t1 = Date.now();
        set('t-answer', `${esc(a.via.replace('wss://', ''))}: peer ${a.peer} (${esc(new TextDecoder().decode(hexToBytes(a.peer)).slice(0, 8))}) — connected, and it has what we need`); set('t-dc', 'open', 'ok');
        set('t-hs', `peer ${a.peer} (${esc(new TextDecoder().decode(hexToBytes(a.peer)).slice(0, 8))})`); set('t-bits', `${m.bits.length / 2} bytes · has ${fmt(p.have.length)} of ${fmt(torrent.pieceCount)} pieces`); send(W.frame('interested')); log('sent: interested'); }
      else if (m.name === 'Extended') { const x = W.readExtended(m, names); if (x.kind === 'handshake') { names = Object.fromEntries(Object.entries(x.value.m ?? {}).map(([n, id]) => [id, n])); if (active === a || !active) set('t-ext', `${esc(x.value.v ?? 'no version given')} · m ${esc(JSON.stringify(x.value.m))} · metadata_size ${fmt(x.value.metadata_size ?? 0)}`); log('their extended handshake: ' + (x.value.v ?? '')); } else log('extended: ' + x.kind); }
      else if (m.name === 'unchoke') { unchoked = true; if (active !== a) continue; log(`unchoked: requesting ${queue.length} blocks of ${job.pieces.length} piece(s), 12 in flight`); $('state').textContent = job.play ? `fetching ${job.play.path}…` : `fetching piece ${index}…`; ask(); }
      else if (m.name === 'choke') { unchoked = false; log('choked'); }
      else if (m.name === 'Piece') { if (active !== a || !want.has(m.index)) continue; inflight--; const data = hexToBytes(m.block); if (!store.has(m.index)) store.set(m.index, new Map()); store.get(m.index).set(m.begin, data); received += data.length; $('bar').value = received / totalBytes;
        set('t-blocks', `${fmt(received)} of ${fmt(totalBytes)} bytes · ${verified.size} of ${job.pieces.length} piece(s) verified · ${(received / 1048576 / ((Date.now() - t1) / 1000)).toFixed(2)} MB/s`);
        if (store.get(m.index).size === nBlocksOf(m.index)) { const piece = new Uint8Array(pieceLen(m.index)); for (const [b, d] of store.get(m.index)) piece.set(d, b); store.delete(m.index); const h = bytesToHex(await sha1(piece)); const ok = h === info.pieces[m.index];
          if (!ok) { log(`piece ${m.index}: sha1 ${h} DOES NOT MATCH pieces[${m.index}]`); return stop(`piece ${m.index} failed its hash: the peer sent bad data`); } verified.set(m.index, piece); log(`piece ${m.index}: verified`); set('t-blocks', `${fmt(received)} of ${fmt(totalBytes)} bytes · ${verified.size} of ${job.pieces.length} piece(s) verified · ${(received / 1048576 / ((Date.now() - t1) / 1000)).toFixed(2)} MB/s`);
          if (job.pieces.length === 1) { set('t-piece', `<span class="ok">sha1 ${h} = pieces[${m.index}] ✓</span>${m.index === 0 && torrent.infohash === '242e9b7dcba15cc0ed8f1bc5f06b68da008f87c0' ? ` · the first bytes are <span class="mono">${bytesToHex(piece.subarray(0, 7))}</span>: 'utxo' 0xff, format 2 — the UTXO snapshot's own header` : ''}`, ''); }
          if (verified.size === job.pieces.length) { const secs = ((Date.now() - t0) / 1000).toFixed(1);
            if (job.play) { // the file is the bytes [offset, offset + length) of the verified piece stream
              const f = job.play; const out = new Uint8Array(f.length); let cursor = 0; for (const i of job.pieces) { const piece = verified.get(i); const pieceStart = i * PIECE_LENGTH; const from = Math.max(f.offset, pieceStart) - pieceStart, to = Math.min(f.offset + f.length, pieceStart + piece.length) - pieceStart; out.set(piece.subarray(from, to), cursor); cursor += to - from; }
              const ext = f.path.split('.').pop().toLowerCase(); const type = { mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', ogg: 'audio/ogg', m4a: 'audio/mp4', wav: 'audio/wav' }[ext]; const url = URL.createObjectURL(new Blob([out], { type: type ?? 'application/octet-stream' }));
              $('play-card').hidden = false; $('play').innerHTML = type ? (type.startsWith('video') ? `<video controls autoplay src="${url}" style="width:100%;max-height:60vh;background:#000;border-radius:8px"></video>` : `<audio controls autoplay src="${url}" style="width:100%"></audio>`) : `<a href="${url}" download="${esc(f.path.split('/').pop())}">save ${esc(f.path)}</a>`;
              $('play-note').textContent = `${f.path} · ${fmt(f.length)} bytes from ${job.pieces.length} pieces, each SHA-1 checked against the torrent, in ${secs} s from one peer over WebRTC`; set('t-piece', `<span class="ok">${job.pieces.length} pieces verified</span> · the file assembled and playing`, '');
              stop(`done: ${f.path} verified and playing, ${secs} s`); } else { if (job.pieces.length > 1) set('t-piece', `<span class="ok">pieces ${job.pieces[0]}–${job.pieces[job.pieces.length - 1]} all verified</span>`, ''); stop(`done: ${job.pieces.length === 1 ? `piece ${index}` : `pieces ${job.pieces[0]}–${job.pieces[job.pieces.length - 1]}`} verified in ${secs} s`); } return; } }
        ask(); }
      else if (m.name === 'keep-alive' || m.name === 'Have' || m.name === 'Port') { /* noted */ }
      else log('message: ' + m.name);
    }
  };
  dc.onclose = () => { if (!stopped && active === a) stop('the data channel closed'); };
  }
  setTimeout(() => { if (!active && !stopped) stop(answers ? `${answers} answer(s) in 60 s but none both connected and had every piece we need (NAT, or partial peers; a multi-peer fetch is not built yet)` : 'no answer within 60 s: no peer in this swarm took any of our offers, and none offered to us'); }, 60000);
};
