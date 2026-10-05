// Hashes and hex, on WebCrypto so the same file runs in Node and the browser. SHA-1 is what BitTorrent v1 names pieces
// and torrents by; SHA-256 is what BEP 52 (v2) uses and what a content's own checksum usually is.
const subtle = globalThis.crypto.subtle;
export const sha1 = async (bytes) => new Uint8Array(await subtle.digest('SHA-1', bytes));
export const sha256 = async (bytes) => new Uint8Array(await subtle.digest('SHA-256', bytes));
export const bytesToHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
export const hexToBytes = (h) => Uint8Array.from(String(h).match(/../g) ?? [], (x) => parseInt(x, 16));
export const utf8 = { encode: (s) => new TextEncoder().encode(s), decode: (b) => new TextDecoder('utf-8', { fatal: false }).decode(b) };
export const compareBytes = (a, b) => { const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] - b[i]; return a.length - b.length; };
