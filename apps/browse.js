// The schema browser: every document in schema/ rendered from the JSON-LD itself — modules, structs (fields with their
// bencode key, value type, BEP and description; derived values with their derivation), enumerations, rulesets with
// error codes. Nothing on this page is written by hand; add a document to MODULES and it appears.
const MODULES = ['bencode', 'metainfo', 'tracker', 'wire', 'webseed', 'webtorrent', 'nostr'];
const short = (id) => String(id).replace(/^bt:/, '');
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const typeOf = (f) => f.valueType === 'list' ? `list&lt;${String(f.itemType).startsWith('list:') ? `list&lt;${esc(String(f.itemType).slice(5))}&gt;` : f.itemType === 'struct' ? short(f.structType) : esc(f.itemType)}&gt;` : f.valueType === 'struct' ? short(f.structType) : esc(f.valueType);
const main = document.getElementById('classes'); main.innerHTML = '';
document.getElementById('version').textContent = 'v' + (await (await fetch('package.json')).json()).version;
const wireRows = (fields) => fields.map((f) => `<tr><td class="name">${esc(f.label)}</td><td class="type">${f.wireType === 'struct' ? short(f.structType) : esc(f.wireType)}${f.repeat === 'toEnd' ? ' …to end' : ''}</td><td class="type">${f.constValue !== undefined ? '= ' + esc(f.constValue) : ''}</td><td class="desc">${esc(f.comment)}${f.enumType ? ` <span style="color:var(--mut)">(${esc(short(f.enumType))})</span>` : ''}</td></tr>`).join('');
const rows = (fields) => fields.map((f) => `<tr><td class="name">${esc(f.label)}</td><td class="type">${f.position !== undefined ? `[${esc(f.position)}]` : esc(f.key ?? '')}</td><td class="type">${typeOf(f)}${f.required ? '' : '?'}</td><td class="desc">${f.presentIf ? `<b style="color:var(--accent)">if ${esc(f.presentIf)}:</b> ` : ''}${esc(f.comment)}${f.bep ? ` <span style="color:var(--mut)">(BEP ${esc(f.bep)})</span>` : ''}</td></tr>`).join('');
const derivedRows = (d) => d.map((f) => `<tr><td class="name">${esc(f.label)}</td><td class="desc" colspan="3"><code>${esc(f.derivation)}</code>${f.comment ? `<br>${esc(f.comment)}` : ''}${f.bep ? ` <span style="color:var(--mut)">(BEP ${esc(f.bep)})</span>` : ''}</td></tr>`).join('');
for (const name of MODULES) {
  const doc = await (await fetch(`schema/${name}.jsonld`)).json(); const nodes = doc['@graph']; const mod = nodes.find((n) => n['@type'] === 'Module');
  const h = document.createElement('h2'); h.className = 'module'; h.innerHTML = `module: <a href="schema/${name}.jsonld" style="color:var(--accent)">${esc(name)}</a> · layer: ${esc(mod.layer)}${mod.bep ? ` · BEP ${esc([].concat(mod.bep).join(', '))}` : ''} · v${esc(mod.version)}`; main.appendChild(h);
  const intro = document.createElement('p'); intro.className = 'comment'; intro.style.color = 'var(--mut)'; intro.textContent = mod.comment; main.appendChild(intro);
  for (const node of nodes.filter((n) => n !== mod)) {
    const card = document.createElement('section'); card.className = 'card'; const type = node['@type'];
    const binary = String(node.encoding ?? '').endsWith('binary'), query = String(node.encoding ?? '').endsWith('urlquery') || String(node.encoding ?? '').endsWith('json');
    if (type === 'Struct') card.innerHTML = `<h2>${esc(node.label)}</h2><div class="meta">struct · encoding ${esc(short(node.encoding))}${node.wireSize ? ` · <b>${esc(node.wireSize)} bytes</b> on the wire` : ''} · ${node.fields.length} fields${node.kind ? ` · <b>kind ${esc(node.kind)}</b>` : ''}${node.bep ? ` · BEP ${esc([].concat(node.bep).join(', '))}` : ''}</div><p class="comment">${esc(node.comment)}</p>
      ${binary ? `<table><tr><th>field</th><th>wire type</th><th>constant</th><th>description</th></tr>${wireRows(node.fields)}</table>` : `<table><tr><th>field</th><th>${String(node.encoding ?? '').endsWith('nostrTag') ? 'tag' : String(node.encoding ?? '').endsWith('json') ? 'JSON key' : query ? 'query key' : 'bencode key'}</th><th>type</th><th>description</th></tr>${rows(node.fields)}</table>`}
      ${node.derived ? `<div class="derived-label">derived (computed, never stored)</div><table><tr><th>value</th><th colspan="3">derivation</th></tr>${derivedRows(node.derived)}</table>` : ''}`;
    else if (type === 'Enumeration') card.innerHTML = `<h2>${esc(node.label)}</h2><div class="meta">enumeration · ${node.members.length} members</div><p class="comment">${esc(node.comment)}</p>
      <table><tr>${node.members[0].code !== undefined ? '<th>code</th>' : ''}<th>member</th><th>description</th></tr>${node.members.map((m) => `<tr>${m.code !== undefined ? `<td class="type">${esc(m.code)}</td>` : ''}<td class="name">${esc(m.label)}</td><td class="desc">${esc(m.comment)}</td></tr>`).join('')}</table>`;
    else if (type === 'Encoding') card.innerHTML = `<h2>${esc(node.label)}</h2><div class="meta">encoding</div><p class="comment">${esc(node.comment)}</p>`;
    else if (type === 'RuleSet') card.innerHTML = `<h2>${esc(node.label)}</h2><div class="meta">ruleset · scope: <b>${esc(node.scope)}</b> · ${node.rules.length} rules · each with the error code the codec reports</div><p class="comment">${esc(node.comment)}</p>
      <table><tr><th>#</th><th>rule</th><th>error code</th><th>check</th></tr>${node.rules.map((r, i) => `<tr><td class="name">${i + 1}</td><td class="desc">${esc(r.label)}</td><td class="type">${esc(r.errorCode)}</td><td class="desc"><code>${esc(r.check)}</code></td></tr>`).join('')}</table>`;
    else card.innerHTML = `<h2>${esc(node.label)}</h2><div class="meta">${esc(short(type))}</div><p class="comment">${esc(node.comment)}</p>`;
    main.appendChild(card);
  }
}
