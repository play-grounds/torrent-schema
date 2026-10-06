// One tracker's page: its entry from data/trackers.jsonld (also embedded as JSON-LD in the page), and what it answers
// live through the webtorrent module's messages: an announce for the snapshot, a scrape with no infohash (allowed or
// refused), a scrape of the torrents data/torrents.jsonld can name, and an announce per named torrent for the counts.
import { WebTorrentCodec, toBinary, fromBinary } from '../codec/webtorrent.js';
const $ = (id) => document.getElementById(id); const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const X = new WebTorrentCodec(); const OURS = '242e9b7dcba15cc0ed8f1bc5f06b68da008f87c0', BYTES = 869836053;
const [tdoc, kdoc] = await Promise.all(['../data/trackers.jsonld', '../data/torrents.jsonld'].map((p) => fetch(p).then((r) => r.json())));
const trackers = tdoc['@graph'].filter((n) => n['@type'] === 'bt:Tracker'), known = kdoc['@graph'].filter((n) => n['@type'] === 'bt:KnownTorrent');
const want = new URLSearchParams(location.search).get('t') ?? ''; const entry = trackers.find((t) => t.url === want || t.url.replace(/^wss?:\/\//, '').split(/[/:]/)[0] === want) ?? trackers[0];
const host = entry.url.replace(/^wss?:\/\//, '');
document.title = `${host} — Torrent Schema`; $('title').firstChild.textContent = host + ' '; $('sub').textContent = `${entry.transport} tracker · ${entry.operator ?? 'operator unknown'}${entry.since ? ` · since ${entry.since}` : ''}. ${entry.notes ?? ''}`;
$('others').innerHTML = trackers.filter((t) => t.transport === 'websocket' && t !== entry).map((t) => `<a href="tracker.html?t=${encodeURIComponent(t.url.replace(/^wss?:\/\//, '').split(/[/:]/)[0])}">${esc(t.url.replace(/^wss?:\/\//, ''))}</a>`).join('');
$('entry').innerHTML = Object.entries(entry).filter(([k]) => !k.startsWith('@')).map(([k, v]) => `<tr><th style="width:9rem">${esc(k)}</th><td class="${k === 'url' ? 'mono wrap' : ''}">${esc(v)}</td></tr>`).join('');
const ld = document.createElement('script'); ld.type = 'application/ld+json'; ld.textContent = JSON.stringify({ '@context': 'https://play-grounds.github.io/torrent-schema/context.jsonld', ...entry }, null, 1); document.head.appendChild(ld);
if (entry.transport !== 'websocket') { for (const id of ['l-conn', 'l-ann', 'l-all', 'l-scr']) $(id).textContent = 'not a WebSocket tracker: a browser cannot ask it'; $('known').innerHTML = ''; }
else {
  const peerId = '2d5453303030312d' + Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
  // one socket, several questions: replies are matched to questions by info_hash (announce) or by action (scrape)
  const session = () => new Promise((resolve) => {
    const t0 = Date.now(); let ws; const waiting = new Map(); let closed = false; const self = { dead: false };
    const fail = (why) => { if (closed) return; closed = true; for (const [, w] of waiting) w.resolve({ error: why }); resolve({ error: why, ms: Date.now() - t0 }); };
    try { ws = new WebSocket(entry.url); } catch (e) { return fail('bad URL'); }
    const timer = setTimeout(() => fail('could not connect in 8 s'), 8000);
    ws.onopen = () => { clearTimeout(timer); Object.assign(self, { ms: Date.now() - t0, ask: (msg, key) => new Promise((res) => { const t = setTimeout(() => { waiting.delete(key); res({ error: 'no reply in 8 s' }); }, 8000); waiting.set(key, { resolve: (v) => { clearTimeout(t); waiting.delete(key); res(v); } }); ws.send(JSON.stringify(msg)); }), close: () => { closed = true; try { ws.close(); } catch {} } }); resolve(self); };
    ws.onmessage = (m) => { let d; try { d = JSON.parse(m.data); } catch { return; } const r = X.read(d);
      if (r.kind === 'scrape') { const w = waiting.get('scrape:' + (d.files && Object.keys(d.files).length === 0 ? 'all' : 'named')) ?? waiting.get('scrape:all') ?? waiting.get('scrape:named'); if (w) w.resolve({ files: d.files ?? {} }); return; }
      if (r.kind === 'failure') { const w = waiting.get('scrape:all') ?? waiting.get('scrape:named') ?? [...waiting.values()][0]; if (w) w.resolve({ error: r.reason }); return; }
      if (r.kind === 'reply') { const w = waiting.get('announce:' + r.info_hash); if (w) w.resolve({ seeders: r.complete, leechers: r.incomplete, interval: r.interval }); else if (r.error) { const any = [...waiting.values()][0]; any?.resolve({ error: r.error }); } } };
    ws.onerror = () => { self.dead = true; if (waiting.size) { for (const [, w] of waiting) w.resolve({ error: 'the tracker closed the connection' }); waiting.clear(); } else fail('refused'); };
    ws.onclose = () => { self.dead = true; if (!closed) fail('refused'); };
  });
  async function run() {
    $('again').disabled = true; $('when').textContent = 'asking…'; for (const id of ['l-conn', 'l-ann', 'l-all', 'l-scr']) { $(id).textContent = '…'; $(id).className = 'mut'; }
    $('known').innerHTML = known.map((k, i) => `<tr id="k${i}"><td>${esc(k.name)}<div class="tiny mut">${esc(k.about ?? '')}</div></td><td class="mono tiny">${k.infohash.slice(0, 16)}…</td><td class="n mut">…</td><td class="n"></td><td class="n"></td><td class="tiny mut"></td></tr>`).join('');
    let s = await session();
    if (s.error) { $('l-conn').innerHTML = `<span class="bad">${esc(s.error)}</span>`; for (const id of ['l-ann', 'l-all', 'l-scr']) $(id).textContent = '—'; $('again').disabled = false; $('when').textContent = 'asked at ' + new Date().toLocaleTimeString(); return; }
    $('l-conn').innerHTML = `<span class="ok">open</span> in ${s.ms} ms`;
    const a = await s.ask(X.announce({ info_hash: OURS, peer_id: peerId, numwant: 0, left: BYTES, event: 'started' }), 'announce:' + OURS);
    $('l-ann').innerHTML = a.error ? `<span class="bad">${esc(a.error)}</span>` : `${a.seeders} seeder(s), ${a.leechers} leecher(s) (this page is one), interval ${a.interval} s`;
    // a scrape of the named torrents; absent entries are ones it has never heard of
    const named = await s.ask(X.scrape(known.map((k) => k.infohash)), 'scrape:named');
    $('l-scr').innerHTML = named.error ? `<span class="bad">${esc(named.error)}</span>${s.dead ? ' <span class="tiny mut">— and closed the connection: reconnecting for the rest</span>' : ''}` : `answered for ${Object.keys(named.files).length} of ${known.length} asked`;
    if (s.dead) { s = await session(); if (s.error) { $('l-all').textContent = '—'; $('again').disabled = false; return; } }
    // counts per named torrent: from the scrape where present, else an announce each
    for (let i = 0; i < known.length; i++) { const k = known[i]; const row = $('k' + i).children; const f = named.files?.[toBinary(k.infohash)];
      if (f) { row[2].textContent = f.complete ?? 0; row[3].textContent = f.incomplete ?? 0; row[4].textContent = f.downloaded ?? 0; row[5].textContent = 'scrape'; row[2].className = 'n'; continue; }
      const r = await s.ask(X.announce({ info_hash: k.infohash, peer_id: peerId, numwant: 0, left: 1, event: 'started' }), 'announce:' + k.infohash);
      if (r.error) { row[2].innerHTML = `<span class="bad tiny">${esc(r.error)}</span>`; continue; } row[2].textContent = r.seeders ?? 0; row[3].textContent = Math.max(0, (r.leechers ?? 1) - 1); row[4].textContent = '—'; row[5].textContent = 'announce (less this page)'; row[2].className = 'n'; }
    // last, because a tracker that forbids it may close the connection (openwebtorrent does): a scrape with no infohash, every torrent it knows
    if (s.dead) s = await session();
    const all = s.error ? { error: s.error } : await s.ask({ action: 'scrape' }, 'scrape:all');
    $('l-all').innerHTML = all.error ? `<span class="bad">${esc(all.error)}</span> <span class="tiny mut">— the tracker keeps its list to itself</span>` : `${Object.keys(all.files).length} torrent(s) known · ${Object.values(all.files).reduce((n, f) => n + (f.complete ?? 0), 0)} seeders in all`;
    if (!s.error) s.close(); $('again').disabled = false; $('when').textContent = 'asked at ' + new Date().toLocaleTimeString();
  }
  $('again').onclick = run; run();
}
