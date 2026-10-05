// bencode: the BEP 3 examples, canonical form enforced on input, byte-exact round trips, every rule's error code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decode, encode } from '../codec/bencode.js';
const b = (s) => new TextEncoder().encode(s), s = (u) => new TextDecoder().decode(u);
const dec = (str, opts) => decode(b(str), opts).value;

test('the four types decode as BEP 3 says', () => {
  assert.equal(dec('i42e'), 42); assert.equal(dec('i-3e'), -3); assert.equal(dec('i0e'), 0);
  assert.equal(s(dec('4:spam')), 'spam'); assert.equal(dec('0:').length, 0);
  assert.deepEqual(dec('l4:spam4:eggse').map(s), ['spam', 'eggs']);
  const d = dec('d3:cow3:moo4:spam4:eggse'); assert.equal(s(d.get('cow')), 'moo'); assert.equal(s(d.get('spam')), 'eggs');
  assert.equal(typeof dec('i9999999999999999999e'), 'bigint');
});
test('canonical form is enforced: each rule by its error code', () => {
  for (const [input, code] of [['i03e', 'bencode-bad-integer'], ['i-0e', 'bencode-bad-integer'], ['i-e', 'bencode-bad-integer'], ['04:spam', 'bencode-bad-string'], ['5:spam', 'bencode-truncated'], ['d4:spam4:eggs3:cow3:mooe', 'bencode-keys-unsorted'], ['d1:a1:b1:a1:ce', 'bencode-keys-unsorted'], ['i1ei2e', 'bencode-trailing-bytes'], ['di1e1:ae', 'bencode-bad-key'], ['x', 'bencode-bad-token'], ['l1:a', 'bencode-truncated']])
    assert.throws(() => dec(input), (e) => e.code === code, `${input} → ${code}`);
});
test('lenient decoding accepts unsorted keys and trailing bytes when asked; encoding sorts anyway', () => {
  const d = dec('d4:spam4:eggs3:cow3:mooe', { strict: false }); assert.equal(s(encode(d)), 'd3:cow3:moo4:spam4:eggse');
  assert.equal(dec('i1ei2e', { strict: false }), 1);
});
test('encode(decode(x)) == x for canonical input, with strings, bigints, nested lists and dictionaries', () => {
  for (const x of ['d3:cow3:moo4:spam4:eggse', 'li1ei-2e3:abcli0eee', 'd1:ad1:bli9223372036854775807eeee', 'de', 'le', '0:'])
    assert.equal(s(encode(dec(x))), x);
});
test('encode takes plain objects and strings too, sorting keys by their bytes (not by JavaScript insertion order)', () => {
  assert.equal(s(encode({ spam: 'eggs', cow: 'moo', n: 7, l: [1, 'a'] })), 'd3:cow3:moo1:lli1e1:ae1:ni7e4:spam4:eggse');
  assert.equal(s(encode({ b: 1, B: 2, a: 3 })), 'd1:Bi2e1:ai3e1:bi1ee'); // uppercase sorts before lowercase in bytes
});
test('a decoded dictionary remembers its byte span, so a nested dictionary can be hashed as it stood in the file', () => {
  const r = decode(b('d4:infod6:lengthi5e4:name1:xe5:other1:ye')); const span = r.raw(r.value.get('info'));
  assert.equal(s(span), 'd6:lengthi5e4:name1:xe');
});
