// The known-trackers page: data/trackers.jsonld rendered, and every WebSocket tracker asked live with an announce as a
// leecher wanting no peers (the webtorrent module's message), for the snapshot's infohash.
import { WebTorrentCodec } from '../codec/webtorrent.js';
const INFOHASH = '242e9b7dcba15cc0ed8f1bc5f06b68da008f87c0', BYTES = 869836053;
const $ = (id) => document.getElementById(id); const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const X = new WebTorrentCodec();
const doc = await (await fetch('../data/trackers.jsonld')).json(); const entries = doc['@graph'].filter((n) => n['@type'] === 'bt:Tracker');
const ws = entries.filter((t) => t.transport === 'websocket'), others = entries.filter((t) => t.transport !== 'websocket');
const peerId = '2d5453303030312d' + Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
const who = (t) => `${esc(t.operator ?? 'unknown')}${t.since ? ` · since ${esc(t.since)}` : ''}<div class="tiny mut">${esc(t.source)}${t.notes ? ` — ${esc(t.notes)}` : ''}</div>`;
$('udp').innerHTML = others.map((t) => `<tr><td class="mono wrap">${esc(t.url)}</td><td>${who(t)}</td><td class="tiny">${esc(t.notes ?? '')}</td></tr>`).join('');
const ask = (url) => new Promise((resolve) => {
  const t0 = Date.now(); let sock; const done = (r) => { try { sock.close(); } catch {} resolve({ ms: Date.now() - t0, ...r }); };
  const timer = setTimeout(() => done({ error: 'no answer in 8 s' }), 8000);
  try { sock = new WebSocket(url); } catch (e) { clearTimeout(timer); return done({ error: 'bad URL' }); }
  sock.onopen = () => sock.send(JSON.stringify(X.announce({ info_hash: INFOHASH, peer_id: peerId, numwant: 0, left: BYTES, event: 'started' })));
  sock.onmessage = (m) => { let d; try { d = JSON.parse(m.data); } catch { return; } const r = X.read(d); if (r.kind === 'reply' && !r.error) { clearTimeout(timer); done({ seeders: r.complete, leechers: r.incomplete, interval: r.interval }); } else if (r.kind === 'failure') { clearTimeout(timer); done({ error: r.reason }); } else if (r.kind === 'reply') { clearTimeout(timer); done({ error: r.error }); } };
  sock.onerror = () => { clearTimeout(timer); done({ error: 'refused' }); };
});
async function run() {
  $('again').disabled = true; $('when').textContent = 'asking…';
  $('ws').innerHTML = ws.map((t, i) => `<tr id="r${i}"><td class="mono wrap">${esc(t.url)}</td><td>${who(t)}</td><td class="mut">asking…</td><td class="n"></td><td class="n"></td><td class="n"></td></tr>`).join('');
  const results = await Promise.all(ws.map((t) => ask(t.url)));
  let alive = 0;
  results.forEach((r, i) => { const row = $('r' + i).children; if (r.error) { row[2].innerHTML = `<span class="bad">${esc(r.error)}</span>`; row[5].textContent = r.ms; } else { alive++; row[2].innerHTML = `<span class="ok">alive</span> <span class="tiny mut">· interval ${r.interval} s</span>`; row[3].textContent = r.seeders; row[4].textContent = r.leechers; row[5].textContent = r.ms; } });
  $('summary').innerHTML = `<b>${alive} of ${ws.length}</b> answered just now.`; $('when').textContent = 'asked at ' + new Date().toLocaleTimeString(); $('again').disabled = false;
}
$('again').onclick = run; run();
