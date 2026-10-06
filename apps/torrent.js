// One torrent's page (or the list, with no ?h=): the entry from data/torrents.jsonld (embedded as JSON-LD), its .torrent
// decoded by the schema — name, size, files, pieces, trackers, web seeds, magnet — and every live WebSocket tracker
// from data/trackers.jsonld asked for its counts, through the webtorrent module's messages.
import { TorrentCodec } from '../codec/codec.js';
import { WebTorrentCodec } from '../codec/webtorrent.js';
const $ = (id) => document.getElementById(id); const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const fmt = (n) => Number(n).toLocaleString('en-US'); const size = (n) => n >= 1e9 ? (n / 1e9).toFixed(2) + ' GB' : n >= 1e6 ? (n / 1e6).toFixed(1) + ' MB' : fmt(n) + ' B';
const [bencodeDoc, metainfoDoc, tdoc, kdoc] = await Promise.all(['../schema/bencode.jsonld', '../schema/metainfo.jsonld', '../data/trackers.jsonld', '../data/torrents.jsonld'].map((p) => fetch(p).then((r) => r.json())));
const T = new TorrentCodec(bencodeDoc, metainfoDoc), X = new WebTorrentCodec();
const known = kdoc['@graph'].filter((n) => n['@type'] === 'bt:KnownTorrent'), trackers = tdoc['@graph'].filter((n) => n['@type'] === 'bt:Tracker' && n.transport === 'websocket');
const h = (new URLSearchParams(location.search).get('h') ?? '').toLowerCase(); const entry = known.find((k) => k.infohash === h);
$('others').innerHTML = known.filter((k) => k !== entry).map((k) => `<a href="torrent.html?h=${k.infohash}">${esc(k.name)}</a>`).join('');
if (!entry) {
  $('sub').textContent = `${known.length} torrents whose infohash we know and can name. A tracker knows only hashes; these names are what turn its counts into titles.`; $('list').hidden = false;
  $('list-rows').innerHTML = known.map((k) => `<tr><td><a href="torrent.html?h=${k.infohash}">${esc(k.name)}</a></td><td>${esc(k.kind ?? '')}</td><td class="tiny">${esc(k.about ?? '')}</td><td class="mono tiny">${k.infohash}</td></tr>`).join('');
} else {
  document.title = `${entry.name} — Torrent Schema`; $('title').firstChild.textContent = entry.name + ' '; $('sub').textContent = entry.about ?? ''; $('one').hidden = false;
  $('entry').innerHTML = Object.entries(entry).filter(([k]) => !k.startsWith('@')).map(([k, v]) => `<tr><th style="width:9rem">${esc(k)}</th><td class="${k === 'infohash' ? 'mono wrap' : ''}">${esc(v)}</td></tr>`).join('');
  const ld = document.createElement('script'); ld.type = 'application/ld+json'; ld.textContent = JSON.stringify({ '@context': 'https://torrent-schema.github.io/context.jsonld', ...entry }, null, 1); document.head.appendChild(ld);
  $('fetch').href = `peer.html?h=${entry.infohash}`;
  // the metainfo
  if (entry.file) {
    $('file-link').href = '../data/' + entry.file;
    try { const t = await T.parse(new Uint8Array(await (await fetch('../data/' + entry.file)).arrayBuffer())); const m = t.meta, info = m.info;
      const trs = m['announce-list']?.flat() ?? (m.announce ? [m.announce] : []); const ws = m['url-list'] ?? [];
      const rows = [['infohash from the file', `<span class="mono">${t.infohash}</span> ${t.infohash === entry.infohash ? '<span class="ok">= the entry</span>' : '<span class="bad">≠ the entry</span>'}`], ['name', esc(info.name)], ['size', `${fmt(t.totalLength)} bytes (${size(t.totalLength)})${info.files ? ` in ${info.files.length} files` : ', one file'}`], ['pieces', `${fmt(t.pieceCount)} × ${fmt(info['piece length'])} bytes, the last ${fmt(t.lastPieceLength)}`], ['private', info.private ? 'yes' : 'no'], ['created', `${m['created by'] ? esc(m['created by']) + ' · ' : ''}${m['creation date'] ? new Date(m['creation date'] * 1000).toISOString().slice(0, 10) : '—'}`], ['comment', esc(m.comment ?? '—')], ['trackers in the file', trs.length ? trs.map((u) => `<span class="mono tiny">${esc(u)}</span>`).join('<br>') : '—'], ['web seeds in the file', ws.length ? ws.map((u) => `<span class="mono tiny">${esc(u)}</span>`).join('<br>') : '—'], ['magnet', `<span class="mono tiny wrap">${esc(t.magnet)}</span>`], ['valid', t.error ? `<span class="bad">${esc(t.error)}</span>` : '<span class="ok">passes every metainfo rule</span>']];
      $('meta').innerHTML = rows.map(([k, v]) => `<tr><th style="width:11rem">${k}</th><td class="wrap">${v}</td></tr>`).join('');
      $('files').innerHTML = (info.files ?? [{ path: [info.name], length: info.length }]).map((f) => `<tr><td class="mono tiny wrap">${esc(f.path.join('/'))}</td><td class="n tiny">${fmt(f.length)}</td></tr>`).join('');
      $('pieces').textContent = info.pieces.map((p, i) => `${String(i).padStart(5)} ${p}`).join('\n');
      // a playable file behind a web seed: the URL the schema's web seed rules give, straight into a <video>
      const files = info.files ?? [{ path: [info.name], length: info.length }]; const playable = files.filter((f) => /\.(mp4|webm|m4v|ogv|mp3|ogg|m4a|wav)$/i.test(f.path[f.path.length - 1])).sort((a, b) => b.length - a.length)[0];
      if (ws.length && playable) { const base = ws[0]; const rel = (info.files ? [info.name, ...playable.path] : [info.name]).map(encodeURIComponent).join('/'); const url = base.endsWith('/') ? base + rel : base; const audio = /\.(mp3|ogg|m4a|wav)$/i.test(playable.path.join('/'));
        $('play-card').hidden = false; $('play').innerHTML = audio ? `<audio controls preload="metadata" src="${esc(url)}" style="width:100%"></audio>` : `<video controls preload="metadata" src="${esc(url)}" style="width:100%;max-height:60vh;background:#000;border-radius:8px"></video>`;
        $('play-note').innerHTML = `${esc(playable.path.join('/'))} · ${fmt(playable.length)} bytes · from <span class="mono">${esc(url)}</span>. The player asks for byte ranges as it goes, which is what a web seed is; a server that ignored Range would make it download everything first. For the same file from the swarm, verified piece by piece, use the <a href="peer.html?h=${entry.infohash}">peer</a>.${/\.(mp4|m4v|m4a)$/i.test(playable.path.join('/')) ? ' The MP4 is H.264/AAC: Firefox on Linux needs its OpenH264 plugin (about:addons → Plugins) or system ffmpeg, else it reports the file as corrupt; Chromium-based browsers decode it themselves.' : ''}`; }
    } catch (e) { $('meta').innerHTML = `<tr><td class="bad">could not read the file: ${esc(e.message)}</td></tr>`; }
  } else $('meta').innerHTML = '<tr><td class="mut">no .torrent file kept for this entry</td></tr>';
  // the trackers
  const peerId = '2d5453303030312d' + Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
  const ask = (url) => new Promise((resolve) => { const t0 = Date.now(); let sock, opened = false; const done = (r) => { try { sock.close(); } catch {} resolve({ ms: Date.now() - t0, ...r }); };
    const timer = setTimeout(() => done({ error: opened ? 'connected, no reply' : 'could not connect' }), 8000); try { sock = new WebSocket(url); } catch { clearTimeout(timer); return done({ error: 'bad URL' }); }
    sock.onopen = () => { opened = true; sock.send(JSON.stringify(X.announce({ info_hash: entry.infohash, peer_id: peerId, numwant: 0, left: 1, event: 'started' }))); };
    sock.onmessage = (m) => { let d; try { d = JSON.parse(m.data); } catch { return; } const r = X.read(d); if (r.kind === 'reply' && !r.error) { clearTimeout(timer); done({ seeders: r.complete ?? 0, leechers: Math.max(0, (r.incomplete ?? 1) - 1) }); } else if (r.kind === 'failure' || (r.kind === 'reply' && r.error)) { clearTimeout(timer); done({ error: r.reason ?? r.error }); } };
    sock.onerror = () => { if (!opened) { clearTimeout(timer); done({ error: 'refused' }); } }; sock.onclose = () => { if (!opened) { clearTimeout(timer); done({ error: 'refused' }); } }; });
  async function run() {
    $('again').disabled = true; $('when').textContent = 'asking…'; $('live').innerHTML = trackers.map((t, i) => `<tr id="t${i}"><td class="mono tiny wrap"><a href="tracker.html?t=${encodeURIComponent(t.url.replace(/^wss?:\/\//, '').split(/[/:]/)[0])}">${esc(t.url.replace(/^wss?:\/\//, ''))}</a></td><td class="mut">asking…</td><td class="n"></td><td class="n"></td><td class="n"></td></tr>`).join('');
    const rs = await Promise.all(trackers.map((t) => ask(t.url)));
    rs.forEach((r, i) => { const row = $('t' + i).children; if (r.error) { row[1].innerHTML = `<span class="bad tiny">${esc(r.error)}</span>`; } else { row[1].innerHTML = '<span class="ok">alive</span>'; row[2].textContent = r.seeders; row[3].textContent = r.leechers; } row[4].textContent = r.ms; });
    $('when').textContent = 'asked at ' + new Date().toLocaleTimeString(); $('again').disabled = false;
  }
  $('again').onclick = run; run();
}
