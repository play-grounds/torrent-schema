#!/usr/bin/env node
// The whole schema in one figure: the seven modules as layers, from the encoding under everything to the index that
// finds a torrent, with the messages that flow between them. Box contents — module, layer, struct names and counts —
// come from schema/*.jsonld so the figure cannot drift; the placement and the flow labels are hand-written here.
//   node tools/gen-layers-diagram.js   -> layers.svg
import { readFile, writeFile } from 'node:fs/promises';
const root = new URL('..', import.meta.url);
const docOf = async (m) => JSON.parse(await readFile(new URL(`schema/${m}.jsonld`, root), 'utf8'));
const MONO = 'ui-monospace, Menlo, Consolas, monospace', SANS = 'system-ui, sans-serif';
const C = { bg: '#ffffff', panel: '#f6f8fa', border: '#d0d7de', fg: '#1f2328', muted: '#57606a', accent: '#e8830c', link: '#0969da', edge: '#9aa3ad', data: '#fff4e5' };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const mods = {}; for (const m of ['bencode', 'metainfo', 'tracker', 'wire', 'webseed', 'webtorrent', 'nostr']) { const d = await docOf(m); const g = d['@graph']; mods[m] = { mod: g[0], structs: g.filter((n) => n['@type'] === 'Struct').map((n) => n.label), enums: g.filter((n) => n['@type'] === 'Enumeration').length, rules: g.filter((n) => n['@type'] === 'RuleSet').flatMap((n) => n.rules).length }; }

// placement: rows top to bottom, the thing found at the top, the bytes at the bottom
const W = 1360, BW = 400, GAP = 40; const L1 = 60, L2 = L1 + BW + GAP, L3 = L2 + BW + GAP;
const ROWS = [
  [{ m: 'nostr', x: L2, w: BW, title: 'find a torrent', how: 'a signed kind 2003 event on a relay' }],
  [{ m: 'metainfo', x: L2, w: BW, title: 'the .torrent file', how: 'data at rest: the one thing a swarm agrees on', data: true }],
  [{ m: 'tracker', x: L1, w: BW, title: 'find peers', how: 'HTTP or UDP announce; compact peer lists' }, { m: 'webtorrent', x: L3, w: BW, title: 'find peers from a browser', how: 'WebSocket announce carrying WebRTC offers' }],
  [{ m: 'wire', x: L1, w: BW, title: 'exchange pieces', how: 'TCP or uTP — or an RTCDataChannel, unchanged' }, { m: 'webseed', x: L3, w: BW, title: 'fetch pieces from a web server', how: 'HTTP Range requests, verified like any peer' }],
  [{ m: 'bencode', x: L1, w: L3 + BW - L1, title: 'the encoding under everything', how: 'four value types, one canonical byte form' }],
];
const colsOf = (b) => b.w > 500 ? 4 : 2;
const boxH = (b) => { const n = mods[b.m].structs.length; return 112 + (n ? Math.ceil(n / colsOf(b)) * 20 + 6 : 0); };
const BOX = []; let y = 60; for (const row of ROWS) { let h = 0; for (const b of row) { b.y = y; h = Math.max(h, boxH(b)); } y += h + 80; for (const b of row) BOX.push(b); }
const flows = [ // from, to, label (hand-written: what goes between the layers), side
  ['nostr', 'metainfo', 'x = the infohash, trackers, file list → a magnet; the info dictionary comes from the swarm (BEP 9)'],
  ['metainfo', 'tracker', 'infohash → announce'],
  ['metainfo', 'webtorrent', 'infohash → announce + offers'],
  ['tracker', 'wire', 'peers → handshake, bitfield, request, piece'],
  ['webtorrent', 'webseed', 'url-list → Range for a block'],
  ['webtorrent', 'wire', 'answer → data channel; then the wire protocol byte for byte', 'cross'],
];
const svg = [];
const boxes = Object.fromEntries(BOX.map((b) => [b.m, { ...b, h: boxH(b) }]));
for (const b of Object.values(boxes)) { const M = mods[b.m]; const fill = b.data ? C.data : C.panel;
  svg.push(`<a href="${b.m}"><g><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="10" fill="${fill}" stroke="${C.border}"/>`);
  svg.push(`<text x="${b.x + 16}" y="${b.y + 28}" font-family="${SANS}" font-size="17" font-weight="600" fill="${C.fg}">${esc(b.title)}</text>`);
  svg.push(`<text x="${b.x + 16}" y="${b.y + 48}" font-family="${MONO}" font-size="13" fill="${C.link}">module ${esc(b.m)} · layer ${esc(M.mod.layer)}</text>`);
  svg.push(`<text x="${b.x + 16}" y="${b.y + 68}" font-family="${SANS}" font-size="13" fill="${C.muted}">${esc(b.how)}</text>`);
  svg.push(`<text x="${b.x + 16}" y="${b.y + 88}" font-family="${MONO}" font-size="12" fill="${C.muted}">${M.structs.length} structs · ${M.enums} enumerations · ${M.rules} rules${M.mod.bep ? ` · BEP ${[].concat(M.mod.bep).join(', ')}` : M.mod.seeAlso ? ' · NIP-35' : ''}</text>`);
  const cols = colsOf(b); M.structs.forEach((s, i) => { const col = i % cols, row = Math.floor(i / cols); svg.push(`<text x="${b.x + 16 + col * ((b.w - 32) / cols)}" y="${b.y + 112 + row * 20}" font-family="${MONO}" font-size="12.5" fill="${C.fg}">${esc(s)}</text>`); });
  svg.push('</g></a>'); }
const mid = (b) => b.x + b.w / 2;
for (const [from, to, label, kind] of flows) { const a = boxes[from], b = boxes[to];
  if (kind === 'cross') { const x1 = a.x, y1 = a.y + a.h - 20, x2 = b.x + b.w, y2 = b.y + 30; svg.push(`<path d="M${x1},${y1} C${x1 - 60},${y1 + 40} ${x2 + 60},${y2 - 40} ${x2},${y2}" fill="none" stroke="${C.accent}" stroke-width="1.6" stroke-dasharray="5 4" marker-end="url(#arrow)"/><text x="${(x1 + x2) / 2 + 40}" y="${(y1 + y2) / 2 - 22}" text-anchor="middle" font-family="${SANS}" font-size="12" fill="${C.accent}">${esc(label)}</text>`); continue; }
  const sameCol = Math.abs(mid(a) - mid(b)) < 1; const x1 = sameCol ? mid(a) : (mid(b) < mid(a) ? a.x + 40 : a.x + a.w - 40), y1 = a.y + a.h, x2 = sameCol ? mid(b) : mid(b), y2 = b.y;
  svg.push(`<path d="M${x1},${y1} C${x1},${y1 + 30} ${x2},${y2 - 30} ${x2},${y2}" fill="none" stroke="${C.edge}" stroke-width="1.6" marker-end="url(#arrow)"/>`);
  svg.push(`<text x="${sameCol ? x1 + 12 : (x1 + x2) / 2 + (mid(b) < mid(a) ? -10 : 10)}" y="${(y1 + y2) / 2 + 4}" text-anchor="${sameCol ? 'start' : mid(b) < mid(a) ? 'end' : 'start'}" font-family="${SANS}" font-size="12.5" fill="${C.muted}">${esc(label)}</text>`); }
const H = boxes.bencode.y + boxes.bencode.h + 44;
const out = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${SANS}"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${C.edge}"/></marker></defs><rect width="${W}" height="${H}" fill="${C.bg}"/><rect width="${W}" height="8" fill="${C.accent}"/>${svg.join('')}<text x="${W - 24}" y="${H - 16}" text-anchor="end" font-family="${MONO}" font-size="11.5" fill="${C.muted}">boxes generated from schema/*.jsonld · flow labels hand-written · the shaded box is the only data at rest; every other box is messages about it</text></svg>`;
await writeFile(new URL('layers.svg', root), out + '\n'); console.log(`layers.svg: ${Object.keys(boxes).length} modules, ${Object.values(mods).reduce((n, m) => n + m.structs.length, 0)} structs`);
