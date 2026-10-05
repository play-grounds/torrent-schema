#!/usr/bin/env node
// Generate the metainfo class diagram FROM the schema, so it can never drift (as bitcoin-desktop/schema does for its
// core). Emits Mermaid for the README (GitHub renders it inline) and a zero-dependency SVG for the site. Box content is
// schema-derived; the layout is hand-placed.
//   node tools/gen-class-diagram.js   -> docs/class-diagram.mmd, class-diagram.svg; prints the Mermaid block
import { readFile, writeFile, mkdir } from 'node:fs/promises';
const root = new URL('..', import.meta.url);
const docOf = async (m) => JSON.parse(await readFile(new URL(`schema/${m}.jsonld`, root), 'utf8'));
const doc = await docOf('metainfo');
const structsOf = (d) => new Map(d['@graph'].filter((n) => n['@type'] === 'Struct').map((n) => [n['@id'], n]));
const structs = structsOf(doc);
const short = (id) => String(id).replace('bt:', '');
const typeOf = (f) => f.wireType ? (f.wireType === 'struct' ? short(f.structType) : f.wireType) + (f.repeat === 'toEnd' ? '[]' : '') : f.valueType === 'list' ? `${String(f.itemType).replace('list:', '')}[]${String(f.itemType).startsWith('list:') ? '[]' : ''}` : f.valueType;
function model(node, structs) {
  const attrs = [], refs = [];
  for (const f of node.fields ?? []) {
    if ((f.valueType === 'struct' || f.wireType === 'struct') && structs.has(f.structType)) refs.push({ to: f.structType, mult: f.repeat === 'toEnd' ? '0..*' : '1', label: f.label });
    else if ((f.valueType === 'list' || f.valueType === 'dict') && f.itemType === 'struct' && structs.has(f.structType)) refs.push({ to: f.structType, mult: f.presentIf ? '0..*' : '1..*', label: f.label });
    else attrs.push({ name: f.label, type: typeOf(f), opt: f.wireType ? false : !f.required });
  }
  return { id: node['@id'], label: node.label, attrs, derived: (node.derived ?? []).map((d) => d.label), refs };
}
const models = [...structs.values()].map((n) => model(n, structs));
function mermaid(models) {
  const L = ['classDiagram', '  direction TB'];
  for (const m of models) { L.push(`  class ${m.label} {`); for (const a of m.attrs) L.push(`    +${a.type}${a.opt ? '?' : ''} ${a.name.replace(/ /g, '_')}`); for (const d of m.derived) L.push(`    +${d}() derived`); L.push('  }'); }
  for (const m of models) for (const r of m.refs) L.push(`  ${m.label} "1" *-- "${r.mult}" ${short(r.to)} : ${r.label}`);
  return L.join('\n');
}
const POS = { 'bt:MetaInfo': { x: 120, y: 20 }, 'bt:Info': { x: 520, y: 20 }, 'bt:FileEntry': { x: 920, y: 20 } };
const W = 320, HEAD = 34, LINE = 24, PAD = 10, MONO = 'ui-monospace, Menlo, Consolas, monospace', SANS = 'system-ui, sans-serif';
const C = { bg: '#ffffff', panel: '#f6f8fa', border: '#d0d7de', fg: '#1f2328', muted: '#57606a', accent: '#e8830c', link: '#0969da', edge: '#9aa3ad' };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const boxH = (m) => HEAD + PAD + (m.attrs.length + (m.derived.length ? 1 : 0)) * LINE + PAD;
function svg() {
  const box = new Map(models.map((m) => [m.id, { m, ...POS[m.id], h: boxH(m) }])); const boxes = [], edges = [];
  for (const { m, x, y, h } of box.values()) {
    let yy = y + HEAD + PAD + 16; const CHW = 8.1;
    const rows = m.attrs.map((a) => { const t = `<text x="${x + 14}" y="${yy}" font-family="${MONO}" font-size="13.5" fill="${C.fg}">${esc(a.name)}</text><text x="${x + 14 + (a.name.length + 1) * CHW}" y="${yy}" font-family="${MONO}" font-size="13.5" fill="${C.accent}">: ${esc(a.type)}${a.opt ? '?' : ''}</text>`; yy += LINE; return t; });
    if (m.derived.length) { const d = '/' + m.derived.join(' /'); rows.push(`<text x="${x + 14}" y="${yy}" font-family="${MONO}" font-size="${Math.min(12.5, (W - 28) / (d.length * 0.62)).toFixed(1)}" font-style="italic" fill="${C.link}">${esc(d)}</text>`); }
    boxes.push(`<g><rect x="${x}" y="${y}" width="${W}" height="${h}" rx="10" fill="${C.panel}" stroke="${C.border}"/><line x1="${x}" y1="${y + HEAD}" x2="${x + W}" y2="${y + HEAD}" stroke="${C.border}"/><text x="${x + W / 2}" y="${y + 23}" font-family="${SANS}" font-weight="700" font-size="16" fill="${C.fg}" text-anchor="middle">${esc(m.label)}</text>${rows.join('')}</g>`);
  }
  // composition edges, left to right: filled diamond at the whole's right edge, a straight line to the part's left edge
  for (const { m, x, y } of box.values()) for (const r of m.refs) { const t = box.get(r.to); if (!t) continue; const py = y + HEAD + 20, px = x + W, cx = t.x, cy = t.y + HEAD + 20;
    edges.push(`<path d="M${px + 18},${py} L${cx},${cy}" fill="none" stroke="${C.edge}" stroke-width="1.4"/><path d="M${px},${py} l9,-8 l9,8 l-9,8 z" fill="${C.fg}"/><text x="${px + 22}" y="${py - 8}" font-family="${MONO}" font-size="11" fill="${C.muted}">1</text><text x="${cx - 8}" y="${cy - 8}" font-family="${MONO}" font-size="11" fill="${C.muted}" text-anchor="end">${r.mult}</text><text x="${(px + cx) / 2}" y="${(py + cy) / 2 + 16}" font-family="${MONO}" font-size="12" fill="${C.muted}" text-anchor="middle">${esc(r.label)}</text>`); }
  const H = Math.max(...[...box.values()].map((b) => b.y + b.h)) + 56;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1360" height="${H}" viewBox="0 0 1360 ${H}"><rect width="1360" height="${H}" fill="${C.bg}"/><rect width="1360" height="8" fill="${C.accent}"/>${edges.join('')}${boxes.join('')}<text x="1344" y="${H - 16}" text-anchor="end" font-family="${MONO}" font-size="12.5" fill="${C.muted}">generated from schema/metainfo.jsonld  ·  ◆ composition  ·  /name = derived (computed, not stored)  ·  ? = optional</text></svg>`;
}
const mmd = mermaid(models); await mkdir(new URL('docs/', root), { recursive: true });
await writeFile(new URL('docs/class-diagram.mmd', root), mmd + '\n'); await writeFile(new URL('class-diagram.svg', root), svg() + '\n');
console.log('```mermaid\n' + mmd + '\n```');
// every other module: Mermaid only (no hand layout), one file each, printed after the first
for (const m of ['tracker']) { const d = await docOf(m); const st = structsOf(d); const mm = mermaid([...st.values()].map((n) => model(n, st))); await writeFile(new URL(`docs/class-diagram-${m}.mmd`, root), mm + '\n'); console.log(`\n<!-- ${m} -->\n\`\`\`mermaid\n${mm}\n\`\`\``); }
