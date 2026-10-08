// A class page's live part: read the island, decode the instance's bytes again through the codec in this browser,
// and say whether it agrees with what the page was built with; highlight byte spans from field rows and back; for a
// TorrentEvent, fetch the event from a relay and recompute its id.
import { BinaryCodec } from '../codec/binary.js';
import { TorrentCodec } from '../codec/codec.js';
import { NostrCodec } from '../codec/nostr.js';
import { hexToBytes, bytesToHex, sha1 } from '../codec/hash.js';
const island = JSON.parse(document.getElementById('island').textContent); const [def, inst] = island['@graph'];
const out = document.getElementById('verify'); const say = (html, cls = 'mut') => { if (out) { out.className = 'tiny ' + cls; out.innerHTML = html; } };
const json = (v) => JSON.stringify(v, (k, x) => typeof x === 'bigint' ? x.toString() : x);
// field row ↔ byte span highlighting
for (const row of document.querySelectorAll('td.val')) { const f = row.dataset.f; const tr = row.parentElement; const on = (v) => { tr.classList.toggle('hl', v); for (const s of document.querySelectorAll(`span.f[data-f="${CSS.escape(f)}"], span.f[data-f^="${CSS.escape(f)}."], span.f[data-f^="${CSS.escape(f)}["]`)) s.classList.toggle('hl', v); }; tr.addEventListener('mouseenter', () => on(true)); tr.addEventListener('mouseleave', () => on(false)); }
for (const s of document.querySelectorAll('span.f[data-f]')) { const f = s.dataset.f.split(/[.[]/)[0]; const on = (v) => { s.classList.toggle('hl', v); document.querySelector(`td.val[data-f="${CSS.escape(f)}"]`)?.parentElement.classList.toggle('hl', v); }; s.addEventListener('mouseenter', () => on(true)); s.addEventListener('mouseleave', () => on(false)); }
if (inst) try {
  const enc = String(def.encoding ?? '').replace(/^bt:/, ''); const name = String(def['@id']).replace(/^bt:/, '');
  const docs = await Promise.all(['bencode', 'metainfo', 'tracker', 'wire', 'webseed', 'webtorrent', 'nostr'].map(async (m) => (await fetch(`schema/${m}.jsonld`)).json()));
  if (enc === 'binary' && inst.bytes) {
    const v = new BinaryCodec(...docs).decode(name, hexToBytes(inst.bytes)); const same = json(v) === json(inst.value);
    say(same ? `<span class="ok">verified in this browser</span>: the ${inst.bytes.length / 2} bytes decode through schema/${def.module.replace('bt:', '')}.jsonld to the values shown.` : `<span class="bad">mismatch</span>: this browser decoded <code>${json(v)}</code>.`, '');
  } else if (name === 'MetaInfo' || name === 'Info') {
    const T = new TorrentCodec(...docs); const bytes = hexToBytes(inst.bytes);
    if (name === 'MetaInfo') { const r = await T.parse(bytes); say(r.infohash === inst.computed.infohash ? `<span class="ok">verified in this browser</span>: the ${bytes.length} bytes decode, and SHA-1 over the 'info' dictionary's bytes is <code>${r.infohash}</code>, the infohash every tracker and client computes for this torrent.${r.error ? ` Rules: <span class="bad">${r.error}</span>.` : ' Rules: all pass.'}` : `<span class="bad">mismatch</span>: this browser computed ${r.infohash}.`, ''); }
    else { const h = bytesToHex(await sha1(bytes)); say(h === inst.computed['sha1 of these bytes'] ? `<span class="ok">verified in this browser</span>: SHA-1 of these ${bytes.length} bytes is <code>${h}</code>, the infohash.` : `<span class="bad">mismatch</span>: SHA-1 here is ${h}.`, ''); }
  } else if (name === 'NostrEvent' || name === 'TorrentEvent') {
    const N = new NostrCodec(...docs); const ev = name === 'NostrEvent' ? inst.value : null;
    if (ev) { const id = await N.id(ev); const idOk = id === ev.id; let live = '';
      try { live = await new Promise((resolve) => { const ws = new WebSocket('wss://relay.damus.io'); const t = setTimeout(() => { ws.close(); resolve(' The relay did not answer in time.'); }, 8000); ws.onopen = () => ws.send(JSON.stringify(['REQ', 'x', { ids: [ev.id] }])); ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d[0] === 'EVENT') { clearTimeout(t); ws.close(); resolve(json(d[2]) === json(ev) ? ' relay.damus.io holds this exact event right now.' : ' relay.damus.io returned an event that differs from this one.'); } if (d[0] === 'EOSE') { clearTimeout(t); ws.close(); resolve(' relay.damus.io does not have it (relays prune).'); } }; ws.onerror = () => { clearTimeout(t); resolve(' Could not reach relay.damus.io from here.'); }; }); } catch { live = ''; }
      say(`${idOk ? '<span class="ok">verified in this browser</span>: SHA-256 of the NIP-01 serialisation is the id' : '<span class="bad">the id does not match</span>'} <code>${id}</code>.${live}`, ''); }
    else { const r = N.read({ tags: inst.value.extra ? [...N.toTags('TorrentEvent', inst.value)] : [] }); say(`<span class="ok">verified in this browser</span>: the tags re-read through the schema give magnet <code>${N.magnet(r)}</code>.`, ''); }
  } else if (inst.bytes && (enc === 'bencode')) { const T = new TorrentCodec(...docs); try { const v = T.decode(name, hexToBytes(inst.bytes), { strict: false }); say(json(v) === json(inst.value) ? `<span class="ok">verified in this browser</span>: the ${inst.bytes.length / 2} bytes decode through the schema to the values shown.` : `<span class="bad">mismatch</span>: this browser decoded <code>${json(v)}</code>.`, ''); } catch (e) { say(`This instance is read by a codec with its own parse step (${e.message}); shown as built.`); } }
  else say('This instance has no bytes to re-decode; the values are as built, from ' + inst.source + '.');
} catch (e) { say(`Could not verify here: ${e.message}`); }
