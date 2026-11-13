'use strict';
// Unit tests for cURL / HAR import (importers.js). Run with: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const { shellWords, splitCommands, parseCurl, parseHar, importText } = require('../importers.js');

const hdr = r => Object.fromEntries(r.headers.split('\n').filter(Boolean).map(l => { const i = l.indexOf(':'); return [l.slice(0, i), l.slice(i + 1).trim()]; }));

test('shellWords handles bash quoting styles', () => {
  assert.deepEqual(shellWords(`curl 'a b' "c \\"d\\"" e\\ f`), ['curl', 'a b', 'c "d"', 'e f']);
  assert.deepEqual(shellWords(`x $'line1\\nit\\'s'`), ['x', "line1\nit's"]);
  assert.deepEqual(shellWords(`x 'a'"b"c`), ['x', 'abc']);
});

test('parses a Chrome "Copy as cURL (bash)" POST', () => {
  const cmd = `curl 'https://api.example.com/login' \\
  -H 'accept: application/json' \\
  -H 'content-type: application/json' \\
  -H 'cookie: sid=abc' \\
  -H 'sec-ch-ua: "Chromium"' \\
  -H 'user-agent: Mozilla/5.0' \\
  --data-raw '{"user":"alice","pw":"x"}' \\
  --compressed`;
  const { request: r, warnings } = parseCurl(cmd);
  assert.equal(r.method, 'POST');
  assert.equal(r.url, 'https://api.example.com/login');
  assert.equal(r.body, '{"user":"alice","pw":"x"}');
  assert.deepEqual(hdr(r), { accept: 'application/json', 'content-type': 'application/json' }); // cookie / sec-* / UA dropped
  assert.equal(r.recorded, true);
  assert.equal(r.name, 'POST login');
  assert.deepEqual(warnings, []);
});

test('parses a Chrome "Copy as cURL (cmd)" command', () => {
  const cmd = 'curl ^"https://example.com/api/items?q=1^" ^\n  -H ^"accept: */*^" ^\n  --data-raw ^"^{^\\^"a^\\^":1^}^"';
  const { request: r } = parseCurl(splitCommands(cmd)[0]);
  assert.equal(r.url, 'https://example.com/api/items?q=1');
  assert.equal(r.method, 'POST');
  assert.equal(r.body, '{"a":1}');
  assert.equal(hdr(r).accept, '*/*');
});

test('handles -X, -u, -G, -I, --json and attached flag values', () => {
  assert.equal(parseCurl(`curl -XDELETE https://x.io/a/1`).request.method, 'DELETE');
  assert.equal(parseCurl(`curl -X PUT https://x.io/a -d 'n=1'`).request.method, 'PUT');
  assert.equal(hdr(parseCurl(`curl -u alice:pw https://x.io/`).request).Authorization, 'Basic ' + Buffer.from('alice:pw').toString('base64'));
  const g = parseCurl(`curl -G https://x.io/search -d q=shoes -d page=2`).request;
  assert.equal(g.method, 'GET'); assert.equal(g.url, 'https://x.io/search?q=shoes&page=2'); assert.equal(g.body, '');
  assert.equal(parseCurl(`curl -I https://x.io/`).request.method, 'HEAD');
  const j = parseCurl(`curl --json '{"a":1}' https://x.io/j`).request;
  assert.equal(j.method, 'POST'); assert.equal(hdr(j)['Content-Type'], 'application/json');
  assert.equal(hdr(parseCurl(`curl -H'X-Key: k1' https://x.io/`).request)['X-Key'], 'k1');
  assert.equal(parseCurl(`curl --url=https://x.io/u -o out.txt -m 5`).request.url, 'https://x.io/u');
});

test('form data gets a content type and skipped flags are reported', () => {
  const r = parseCurl(`curl https://x.io/f -d 'a=1' -d 'b=2'`).request;
  assert.equal(r.body, 'a=1&b=2'); assert.equal(hdr(r)['Content-Type'], 'application/x-www-form-urlencoded');
  assert.match(parseCurl(`curl https://x.io/ -b 'a=b'`).warnings[0], /cookies/);
  assert.match(parseCurl(`curl https://x.io/ -F 'f=@x.png'`).warnings[0], /multipart/);
  assert.throws(() => parseCurl('curl -s -L'), /no URL/);
});

test('importText splits "Copy all as cURL" into several requests', () => {
  const r = importText(`curl 'https://x.io/a' ;\ncurl 'https://x.io/b' -X POST --data-raw 'x=1&y=2' ;\ncurl 'https://x.io/c'`);
  assert.equal(r.kind, 'cURL');
  assert.deepEqual(r.requests.map(q => q.method + ' ' + q.url), ['GET https://x.io/a', 'POST https://x.io/b', 'GET https://x.io/c']);
  assert.equal(r.requests[1].body, 'x=1&y=2');
  assert.throws(() => importText('Invoke-WebRequest -Uri https://x.io'), /PowerShell/);
  assert.throws(() => importText('   '), /nothing to import/);
});

const HAR = {
  log: {
    entries: [
      { _resourceType: 'document', request: { method: 'GET', url: 'https://shop.example.com/', headers: [{ name: ':authority', value: 'shop.example.com' }, { name: 'accept', value: 'text/html' }] }, response: { content: { mimeType: 'text/html' } } },
      { _resourceType: 'script', request: { method: 'GET', url: 'https://shop.example.com/app.js', headers: [] }, response: { content: { mimeType: 'application/javascript' } } },
      { _resourceType: 'fetch', request: { method: 'OPTIONS', url: 'https://api.shop.example.com/cart', headers: [] } },
      { _resourceType: 'fetch', request: { method: 'POST', url: 'https://api.shop.example.com/cart', headers: [{ name: 'Authorization', value: 'Bearer abc' }], postData: { mimeType: 'application/json', text: '{"sku":1}' } } },
      { _resourceType: 'fetch', request: { method: 'POST', url: 'https://api.shop.example.com/cart', headers: [], postData: { mimeType: 'application/json', text: '{"sku":1}' } } },
      { _resourceType: 'xhr', request: { method: 'POST', url: 'https://shop.example.com/login', headers: [], postData: { mimeType: 'application/x-www-form-urlencoded', params: [{ name: 'u', value: 'a b' }, { name: 'p', value: '1' }] } } },
      { _resourceType: 'xhr', request: { method: 'GET', url: 'https://cdn.other.net/data.json', headers: [] } },
      { _resourceType: 'ping', request: { method: 'POST', url: 'https://www.google-analytics.com/collect', headers: [] } }
    ]
  }
};

test('parseHar keeps API traffic and drops statics, preflights, trackers and duplicates', () => {
  const { requests, skipped } = parseHar(JSON.stringify(HAR), { firstParty: true });
  assert.deepEqual(requests.map(r => r.method + ' ' + r.url), [
    'GET https://shop.example.com/', 'POST https://api.shop.example.com/cart', 'POST https://shop.example.com/login'
  ]);
  assert.equal(skipped, 5);
  assert.deepEqual(hdr(requests[0]), { accept: 'text/html' });                    // HTTP/2 pseudo-headers dropped
  assert.equal(hdr(requests[1]).Authorization, 'Bearer abc');
  assert.equal(hdr(requests[1])['Content-Type'], 'application/json');
  assert.equal(requests[2].body, 'u=a%20b&p=1');
});

test('parseHar options: statics and other domains can be included', () => {
  const { requests } = parseHar(HAR, { statics: true, firstParty: false });
  const urls = requests.map(r => r.url);
  assert.ok(urls.includes('https://shop.example.com/app.js'));
  assert.ok(urls.includes('https://cdn.other.net/data.json'));
  assert.ok(!urls.some(u => u.includes('google-analytics')));
  assert.throws(() => parseHar('{"foo":1}'), /not a HAR/);
  assert.equal(importText(JSON.stringify(HAR), { firstParty: true }).kind, 'HAR');
});
