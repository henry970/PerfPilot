'use strict';
// Unit tests for variable extraction (extract.js) plus an end-to-end recorded-login regression.
// Run with: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseExtractSpec, jsonPath, runExtract } = require('../extract.js');
const { pickToken, detectCorrelation, applyCorrelation } = require('../correlate.js');

test('parses every extractor kind', () => {
  assert.deepEqual(parseExtractSpec('token = auto'), { name: 'token', kind: 'auto', arg: '' });
  assert.deepEqual(parseExtractSpec('token=auto'), { name: 'token', kind: 'auto', arg: '' });
  assert.deepEqual(parseExtractSpec('id = json:data.id'), { name: 'id', kind: 'json', arg: 'data.id' });
  assert.deepEqual(parseExtractSpec('csrf = regex:name="([^"]+)"'), { name: 'csrf', kind: 'regex', arg: 'name="([^"]+)"' });
  assert.deepEqual(parseExtractSpec('auth = header:Authorization'), { name: 'auth', kind: 'header', arg: 'Authorization' });
  assert.deepEqual(parseExtractSpec('xsrf = cookie:XSRF-TOKEN'), { name: 'xsrf', kind: 'cookie', arg: 'XSRF-TOKEN' });
});

test('ignores blank and nameless rules', () => {
  assert.equal(parseExtractSpec(''), null);
  assert.equal(parseExtractSpec('nonsense'), null);
  assert.equal(parseExtractSpec('=auto'), null);
});

test('resolves json paths, including array indexes', () => {
  assert.equal(jsonPath({ data: { items: [{ token: 'abc' }] } }, 'data.items[0].token'), 'abc');
  assert.equal(jsonPath({ a: [{ b: 1 }] }, 'a[0].b'), 1);
  assert.equal(jsonPath({ data: {} }, 'data.missing'), undefined);
});

test('resolves every kind into variables', async () => {
  const ctx = {
    text: JSON.stringify({ data: { token: 'jsonTok123456' } }),
    header: n => (n === 'X-Token' ? 'hdrTok123456' : undefined),
    cookie: async n => (n === 'XSRF-TOKEN' ? 'cookieTok123456' : undefined),
    auto: async () => 'autoTok123456'
  };
  const { vars, miss } = await runExtract(
    ['a = json:data.token', 'b = header:X-Token', 'c = cookie:XSRF-TOKEN', 'd = auto', 'e = regex:(jsonTok\\d+)'], ctx);
  assert.deepEqual(miss, []);
  assert.equal(vars.a, 'jsonTok123456');
  assert.equal(vars.b, 'hdrTok123456');
  assert.equal(vars.c, 'cookieTok123456');
  assert.equal(vars.d, 'autoTok123456');
  assert.equal(vars.e, 'jsonTok123456');
});

test('the "auto" rule written by correlation actually resolves', async () => {
  // Regression: "auto" used to be parsed as the kind "aut", so every correlated login missed its token.
  const { vars, miss } = await runExtract(['csrf_token = auto'], { text: '', auto: async () => 'tok_9f8e7d6c5b4a3210' });
  assert.deepEqual(miss, []);
  assert.equal(vars.csrf_token, 'tok_9f8e7d6c5b4a3210');
});

test('reports missing variables instead of throwing', async () => {
  const { vars, miss } = await runExtract(['token = auto', 'x = header:Nope'], { text: '{}', header: () => undefined });
  assert.deepEqual(miss, ['token', 'x']);
  assert.deepEqual(vars, {});
});

test('a bad regex or non-JSON body is reported as missing', async () => {
  assert.deepEqual((await runExtract(['a = regex:('], { text: 'x' })).miss, ['a']);
  assert.deepEqual((await runExtract(['a = json:data.token'], { text: '<html>nope</html>' })).miss, ['a']);
});

test('stringifies object results', async () => {
  const { vars } = await runExtract(['o = json:data'], { text: JSON.stringify({ data: { a: 1 } }) });
  assert.equal(vars.o, '{"a":1}');
});

test('end-to-end: a recorded base64 CSRF login is linked and re-used on replay', async () => {
  const enc = 'a%2Fb%2Bc%3D123456';                    // as it travels on the wire
  const dec = 'a/b+c=123456';                          // what the login page renders
  const plan = [
    { name: 'GET /login', method: 'GET', url: 'https://shop.example.com/login', headers: '', body: '', extract: '' },
    { name: 'POST /login', method: 'POST', url: 'https://shop.example.com/login', headers: 'Content-Type: application/x-www-form-urlencoded', body: 'csrf_token=' + enc + '&username=a&password=b', extract: '' }
  ];
  applyCorrelation(plan, detectCorrelation(plan));

  // replay: the login page renders the token before its name (the old parser returned null here)
  const html = '<form><input type="hidden" value="' + dec + '" name="csrf_token"></form>';
  const { vars, miss } = await runExtract(plan[0].extract.split('\n'), { text: html, auto: () => pickToken(html, {}) });
  assert.deepEqual(miss, []);
  assert.equal(vars.csrf_token, dec);

  // substituting the extracted value back must reproduce the exact wire form
  const body = plan[1].body.replace('${__urlencode:csrf_token}', encodeURIComponent(vars.csrf_token));
  assert.equal(body, 'csrf_token=' + enc + '&username=a&password=b');
});