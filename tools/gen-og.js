#!/usr/bin/env node
// An Open Graph card per class page, drawn from the island: the label, its kind and module, the first sentence, the
// field names, and for a captured instance a strip of its bytes. Rendered as HTML and screenshotted by Chromium.
//   node tools/gen-og.js [Label ...]   -> og/<Label>.png (1200×630)
import { writeFile, mkdir, rm, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from './gen-class-pages.js';
const run = promisify(execFile); const root = new URL('..', import.meta.url);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const short = (id) => String(id).replace(/^bt:/, '');
const chrome = process.env.CHROME ?? (await (async () => { for (const c of ['chromium', 'chromium-browser', 'google-chrome']) { try { await run('which', [c]); return c; } catch {} } throw new Error('no chromium'); })());
const { nodes } = await build(); const only = process.argv.slice(2);
await mkdir(new URL('og/', root), { recursive: true }); const tmp = new URL('og/_cards/', root); await mkdir(tmp, { recursive: true });
const card = ({ node, type, module, inst, id }) => {
  const sentences = String(node.comment ?? '').split(/(?<=\.)\s/); let text = sentences[0]; for (const s of sentences.slice(1)) { if ((text + ' ' + s).length > 230) break; text += ' ' + s; } if (text.length > 230) text = text.slice(0, 227) + '…';
  const own = node.fields ?? node.members ?? node.rules; const related = type === 'Module' ? nodes.filter((x) => x.module === module && x.id !== id).map((x) => ({ label: x.label })) : type === 'Encoding' ? nodes.filter((x) => String(x.node.encoding ?? '').replace(/^bt:/, '') === id).map((x) => ({ label: x.label })) : [];
  const chips = (own ?? related).slice(0, 9).map((f) => `<span class="chip">${esc(f.label)}</span>`).join('');
  const hex = inst?.bytes ? inst.bytes.slice(0, 2 * 96).match(/../g).map((b, i) => b + ((i + 1) % 16 ? ' ' : '\n')).join('') : '';
  const meta = [short(type), `${module} module`, node.encoding ? short(node.encoding) : '', node.wireSize ? `${node.wireSize} bytes on the wire` : '', node.kind ? `kind ${node.kind}` : '', node.bep ? `BEP ${[].concat(node.bep).join(', ')}` : ''].filter(Boolean).join(' · ');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;width:1200px;height:630px;overflow:hidden;background:#fbfaf7;color:#1e1d1a;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  .wrap{position:relative;width:1200px;height:630px;box-sizing:border-box;padding:56px 64px}
  .site{font:600 22px/1 ui-monospace,Menlo,Consolas,monospace;color:#6b675f;letter-spacing:.02em}.site b{color:#c2410c;font-weight:600}
  h1{font-size:${node.label.length > 18 ? 72 : 96}px;line-height:1.05;margin:26px 0 10px;letter-spacing:-.02em;color:#1e1d1a}
  .meta{font:500 26px/1.3 ui-monospace,Menlo,Consolas,monospace;color:#c2410c;margin:0 0 22px;max-width:1060px}
  .text{font-size:30px;line-height:1.35;color:#3b3934;max-width:${hex ? 680 : 1060}px;margin:0}
  .chips{position:absolute;left:64px;bottom:52px;right:64px;display:flex;flex-wrap:wrap;gap:10px}.chip{font:500 22px/1 ui-monospace,Menlo,Consolas,monospace;border:2px solid #ddd8cc;border-radius:999px;padding:9px 16px;color:#6b675f;background:#fff}
  pre.hex{position:absolute;right:64px;top:300px;width:330px;margin:0;font:20px/1.5 ui-monospace,Menlo,Consolas,monospace;color:#b8b2a4;white-space:pre}
  .bar{position:absolute;left:0;top:0;width:1200px;height:12px;background:#c2410c}
  </style></head><body><div class="wrap"><div class="bar"></div><div class="site">Torrent <b>Schema</b> · BitTorrent as JSON-LD</div><h1>${esc(node.label)}</h1><p class="meta">${esc(meta)}</p><p class="text">${esc(text)}</p>${hex ? `<pre class="hex">${esc(hex)}</pre>` : ''}<div class="chips">${chips}</div></div></body></html>`;
};
let n = 0;
for (const x of nodes) { if (only.length && !only.includes(x.id)) continue;
  const html = new URL(`${x.id}.html`, tmp); await writeFile(html, card(x));
  await run(chrome, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--window-size=1200,630', '--force-device-scale-factor=1', `--screenshot=${new URL(`og/${x.id}.png`, root).pathname}`, html.href], { timeout: 60000 }); n++; }
await rm(tmp, { recursive: true, force: true });
console.log(`${n} cards in og/`);
