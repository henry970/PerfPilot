'use strict';
// Unit tests for the per-user session helpers (session.js). Run with: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const { newUser, bindRow, cookieWarning } = require('../session.js');

test('newUser gives each user its own variables with a 1-based id', () => {
  const base = { host: 'https://x.test' };
  const a = newUser(base, 0), b = newUser(base, 1);
  assert.equal(a.__userId, 1);
  assert.equal(b.__userId, 2);
  assert.equal(a.host, 'https://x.test');
  assert.notEqual(a, b);
});

test('users do not share variables, so extracted tokens never leak', () => {
  const base = {};
  const a = newUser(base, 0), b = newUser(base, 1);
  a.token = 'AAA';
  b.token = 'BBB';
  assert.equal(a.token, 'AAA');
  assert.equal(b.token, 'BBB');
  assert.equal('token' in base, false);        // the shared base is never mutated
});

test('bindRow pins one CSV row per user in peruser mode', () => {
  const rows = [{ u: 'a' }, { u: 'b' }, { u: 'c' }];
  const v = {};
  bindRow(v, rows, 0, 0, 'peruser', 3); assert.equal(v.u, 'a');
  bindRow(v, rows, 0, 5, 'peruser', 3); assert.equal(v.u, 'a');   // stable across loops
  bindRow(v, rows, 1, 0, 'peruser', 3); assert.equal(v.u, 'b');
  bindRow(v, rows, 4, 0, 'peruser', 3); assert.equal(v.u, 'b');   // wraps by user index
});

test('bindRow rotates rows across users in rotate mode', () => {
  const rows = [{ u: 'a' }, { u: 'b' }, { u: 'c' }, { u: 'd' }];
  const v = {};
  bindRow(v, rows, 0, 0, 'rotate', 2); assert.equal(v.u, 'a');    // (0 + 0*2) % 4
  bindRow(v, rows, 1, 0, 'rotate', 2); assert.equal(v.u, 'b');    // (1 + 0*2) % 4
  bindRow(v, rows, 0, 1, 'rotate', 2); assert.equal(v.u, 'c');    // (0 + 1*2) % 4
  bindRow(v, rows, 1, 1, 'rotate', 2); assert.equal(v.u, 'd');    // (1 + 1*2) % 4
});

test('bindRow leaves variables untouched when there is no test data', () => {
  const v = { u: 'keep' };
  bindRow(v, [], 0, 0, 'rotate', 2);
  assert.equal(v.u, 'keep');
});

test('cookieWarning explains the shared jar only when it matters', () => {
  assert.equal(cookieWarning({ cookies: false, threads: 10 }), '');
  assert.equal(cookieWarning({ cookies: true, threads: 1 }), '');
  assert.equal(cookieWarning(null), '');
  const w = cookieWarning({ cookies: true, threads: 10 });
  assert.match(w, /share this browser's cookie jar/);
  assert.match(w, /10 users/);
});