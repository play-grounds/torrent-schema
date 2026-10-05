// The decoder page: the schema-driven codec in the browser, on a dropped .torrent. Nothing leaves the page.
import { TorrentCodec } from '../codec/codec.js';
const $ = (id) => document.getElementById(id); const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const fmt = (n) => Number(n).toLocaleString('en-US');
const [bencodeDoc, metainfoDoc] = await Promise.all(['../schema/bencode.jsonld', '../schema/metainfo.jsonld'].map((p) => fetch(p).then((r) => r.json())));
const codec = new TorrentCodec(bencodeDoc, metainfoDoc);
const fields = (name) => codec.struct(name).fields;
async function show(bytes, label) {
  let t; try { t = await codec.parse(bytes); } catch (e) { $('out').hidden = false; $('infohash').textContent = ''; $('valid').innerHTML = `<span class="bad">could not decode: ${esc(e.message)}</span>`; return; }
  $('out').hidden = false; $('infohash').textContent = t.infohash; $('magnet').textContent = t.magnet;
  $('valid').innerHTML = t.error ? `<span class="bad">${esc(t.error)}</span>` : `<span class="ok">passes every metainfo rule</span> · ${fmt(t.pieceCount)} pieces · ${fmt(t.totalLength)} bytes · last piece ${fmt(t.lastPieceLength)} bytes`;
  const row = (f, v) => `<tr><th title="${esc(f.comment ?? '')}">${esc(f.label)}<div class="tiny mut">${esc(f.valueType)}${f.bep ? ' · BEP ' + f.bep : ''}</div></th><td class="mono wrap">${v === undefined ? '<span class="mut">—</span>' : esc(typeof v === 'object' ? JSON.stringify(v) : v)}</td></tr>`;
  $('meta').innerHTML = fields('MetaInfo').filter((f) => f.key !== 'info').map((f) => row(f, t.meta[f.label])).join('') + (t.meta.extra ? `<tr><th>extra<div class="tiny mut">keys the schema does not name, kept for the round trip</div></th><td class="mono">${esc(Object.keys(t.meta.extra).join(', '))}</td></tr>` : '');
  $('info').innerHTML = fields('Info').filter((f) => f.key !== 'pieces').map((f) => row(f, t.meta.info[f.label])).join('');
  $('pieces').textContent = t.meta.info.pieces.map((h, i) => `${String(i).padStart(5)} ${h}`).join('\n');
  const again = codec.encode('MetaInfo', t.meta); const same = again.length === bytes.length && again.every((b, i) => b === bytes[i]);
  $('rt').innerHTML = same ? `<span class="ok">encode(decode(${esc(label)})) is the file, byte for byte (${fmt(bytes.length)} bytes)</span>` : `<span class="bad">re-encoding differs from the file (${again.length} vs ${bytes.length} bytes): the file is not canonical bencode</span>`;
}
const read = async (file) => show(new Uint8Array(await file.arrayBuffer()), file.name);
$('pick').onclick = (e) => { e.preventDefault(); $('file').click(); }; $('file').onchange = () => $('file').files[0] && read($('file').files[0]);
$('sample').onclick = async (e) => { e.preventDefault(); show(new Uint8Array(await (await fetch('../test/vectors/utxo-knots-150307.torrent')).arrayBuffer()), 'utxo-knots-150307.torrent'); };
const drop = $('drop'); drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); }; drop.ondragleave = () => drop.classList.remove('over');
drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) read(f); };
