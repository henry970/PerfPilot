'use strict';
// Unit tests for token correlation (correlate.js). Run with: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const { pickToken, detectCorrelation, applyCorrelation } = require('../correlate.js');
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig123abc';

test('picks an access token out of a JSON login response', () => {
  assert.equal(pickToken(JSON.stringify({ access_token: 'abc123XYZdef456', user: { id: 3 } }), {}), 'abc123XYZdef456');
});

test('picks a nested, well-named token', () => {
  assert.equal(pickToken(JSON.stringify({ data: { csrfToken: 'tok_9f8e7d6c5b4a3210' } }), {}), 'tok_9f8e7d6c5b4a3210');
});

test('picks an x-csrf-token response header', () => {
  const h = { get: n => (n.toLowerCase() === 'x-csrf-token' ? 'hdr-token-123456' : null) };
  assert.equal(pickToken('<html></html>', h), 'hdr-token-123456');
});

test('extracts a Bearer token from an authorization header', () => {
  const h = { get: n => (n.toLowerCase() === 'authorization' ? 'Bearer ' + JWT : null) };
  assert.equal(pickToken('', h), JWT);
});

test('reads a hidden CSRF input or meta tag from HTML', () => {
  assert.equal(pickToken('<input type="hidden" name="csrf_token" value="html-token-777">', {}), 'html-token-777');
  assert.equal(pickToken('<meta name="csrf-token" content="meta-token-888">', {}), 'meta-token-888');
});

test('finds a JWT anywhere in the body', () => {
  assert.equal(pickToken('prefix ' + JWT + ' suffix', {}), JWT);
});

test('returns null when there is no token', () => {
  assert.equal(pickToken('hello world', {}), null);
  assert.equal(pickToken('', {}), null);
});

test('detects a CSRF token reused by a later request', () => {
  const plan = [
    { name: 'GET /login', method: 'GET', url: 'https://shop.example.com/login', headers: '', body: '' },
    { name: 'POST /login', method: 'POST', url: 'https://shop.example.com/login', headers: 'Content-Type: application/x-www-form-urlencoded', body: 'username=a&password=b&csrf_token=9f8e7d6c5b4a32109f8e' }
  ];
  const c = detectCorrelation(plan);
  assert.ok(c);
  assert.equal(c.value, '9f8e7d6c5b4a32109f8e');
  assert.equal(c.producer, 0);
  assert.deepEqual(c.consumers, [1]);
});

test('detects a bearer token reused by a later request', () => {
  const plan = [
    { name: 'POST /login', method: 'POST', url: 'https://api.example.com/login', headers: '', body: '{}' },
    { name: 'GET /me', method: 'GET', url: 'https://api.example.com/me', headers: 'Authorization: Bearer ' + JWT, body: '' }
  ];
  const c = detectCorrelation(plan);
  assert.ok(c);
  assert.equal(c.value, JWT);
  assert.equal(c.producer, 0);
  assert.deepEqual(c.consumers, [1]);
});

test('returns null when nothing looks like a shared token', () => {
  const plan = [
    { name: 'a', method: 'GET', url: 'https://x.test/a?page=2', headers: '', body: '' },
    { name: 'b', method: 'GET', url: 'https://x.test/b', headers: 'Accept: application/json', body: '' }
  ];
  assert.equal(detectCorrelation(plan), null);
});

test('reads an input token even when value comes before name', () => {
  assert.equal(pickToken('<form><input type="hidden" value="abc123XYZ456def789" name="_csrf"></form>', {}), 'abc123XYZ456def789');
});

test('reads a meta token even when content comes before name', () => {
  assert.equal(pickToken('<meta content="abc123XYZ456def789" name="csrf-token">', {}), 'abc123XYZ456def789');
});

test('reads a token embedded in an inline script', () => {
  assert.equal(pickToken('<script>window.csrfToken = "abc123XYZ456def789";</script>', {}), 'abc123XYZ456def789');
  assert.equal(pickToken('<script>{"authenticity_token":"abc123XYZ456def789"}</script>', {}), 'abc123XYZ456def789');
});

test('detects a percent-encoded CSRF token reused by a later request', () => {
  const enc = 'a%2Fb%2Bc%3D123456';                   // decodes to "a/b+c=123456"
  const plan = [
    { name: 'GET /login', method: 'GET', url: 'https://shop.example.com/login', headers: '', body: '' },
    { name: 'POST /login', method: 'POST', url: 'https://shop.example.com/login', headers: 'Content-Type: application/x-www-form-urlencoded', body: 'csrf_token=' + enc + '&username=a&password=b' }
  ];
  const c = detectCorrelation(plan);
  assert.ok(c, 'encoded tokens must still be detected');
  assert.equal(c.value, 'a/b+c=123456');
  assert.equal(c.producer, 0);
  assert.deepEqual(c.consumers, [1]);
  assert.ok(c.raws.includes(enc), 'the raw encoded form must be remembered');
});

test('detects a token carried in a URL query parameter', () => {
  const plan = [
    { name: 'GET /', method: 'GET', url: 'https://x.test/', headers: '', body: '' },
    { name: 'GET /api', method: 'GET', url: 'https://x.test/api?csrf_token=9f8e7d6c5b4a32109f8e', headers: '', body: '' }
  ];
  const c = detectCorrelation(plan);
  assert.ok(c);
  assert.equal(c.value, '9f8e7d6c5b4a32109f8e');
  assert.deepEqual(c.consumers, [1]);
});

test('applyCorrelation keeps a percent-encoded token encoded in the body', () => {
  const enc = 'a%2Fb%2Bc%3D123456';
  const plan = [
    { name: 'GET /login', method: 'GET', url: 'https://shop.example.com/login', headers: '', body: '', extract: '' },
    { name: 'POST /login', method: 'POST', url: 'https://shop.example.com/login', headers: 'Content-Type: application/x-www-form-urlencoded', body: 'csrf_token=' + enc + '&username=a&password=b', extract: '' }
  ];
  applyCorrelation(plan, detectCorrelation(plan));
  assert.equal(plan[0].extract, 'csrf_token = auto');
  assert.equal(plan[1].body, 'csrf_token=${__urlencode:csrf_token}&username=a&password=b');
});

test('applyCorrelation rewrites a raw token with a plain placeholder', () => {
  const plan = [
    { name: 'POST /login', method: 'POST', url: 'https://api.example.com/login', headers: '', body: '{}', extract: '' },
    { name: 'GET /me', method: 'GET', url: 'https://api.example.com/me', headers: 'Authorization: Bearer ' + JWT, body: '', extract: '' }
  ];
  applyCorrelation(plan, detectCorrelation(plan));
  assert.equal(plan[0].extract, 'Authorization = auto');
  assert.equal(plan[1].headers, 'Authorization: Bearer ${Authorization}');
});
test('turns a recorded Authorization header into a reusable variable', () => {
  const { authToVariable } = require('../correlate.js');
  const reqs = [
    { headers: 'Content-Type: application/json\nAuthorization: Bearer abc123def456ghi' },
    { headers: 'authorization: Bearer abc123def456ghi' },
    { headers: 'Accept: */*' }
  ];
  const a = authToVariable(reqs);
  assert.deepEqual(a, { name: 'auth_token', value: 'abc123def456ghi' });
  assert.equal(reqs[0].headers, 'Content-Type: application/json\nAuthorization: Bearer ${auth_token}');
  assert.equal(reqs[1].headers, 'authorization: Bearer ${auth_token}');
  assert.equal(authToVariable(reqs), null);
});
