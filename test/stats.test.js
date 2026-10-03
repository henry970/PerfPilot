'use strict';
// Unit tests for the results diagnostics (stats.js). Run with: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const { parsePctls, errorKey, breakdown, sla, DEF_PCTLS } = require('../stats.js');

test('parsePctls cleans and caps the percentile list', () => {
  assert.deepEqual(parsePctls('50,90,95,99'), [50, 90, 95, 99]);
  assert.deepEqual(parsePctls(' 99 , 50 '), [99, 50]);
  assert.deepEqual(parsePctls('90,90,abc,0,120'), [90]);   // dupes / invalid / out-of-range dropped
  assert.deepEqual(parsePctls(''), DEF_PCTLS);
  assert.deepEqual(parsePctls(null), DEF_PCTLS);
  assert.equal(parsePctls('1,2,3,4,5,6').length, 4);       // capped at 4 columns
});

test('errorKey keeps status codes distinct but groups varying numbers', () => {
  assert.equal(errorKey('status 404'), 'status 404');
  assert.equal(errorKey('status 500'), 'status 500');
  assert.notEqual(errorKey('status 404'), errorKey('status 500'));
  assert.equal(errorKey('slower than 2500 ms'), errorKey('slower than 900 ms'));
  assert.equal(errorKey(''), 'unknown error');
});

test('breakdown groups failures by reason and counts statuses', () => {
  const b = breakdown([
    { status: 200, ok: true, err: '' },
    { status: 200, ok: true, err: '' },
    { status: 404, ok: false, err: 'status 404' },
    { status: 500, ok: false, err: 'status 500' },
    { status: 500, ok: false, err: 'status 500' }
  ]);
  assert.equal(b.total, 5);
  assert.equal(b.failed, 3);
  assert.equal(b.byError[0].label, 'status 500');
  assert.equal(b.byError[0].count, 2);
  assert.ok(Math.abs(b.byError[0].pct - 200 / 3) < 1e-9);
  const s200 = b.byStatus.find(x => x.status === 200), s500 = b.byStatus.find(x => x.status === 500);
  assert.equal(s200.count, 2); assert.equal(s200.ok, true);
  assert.equal(s500.count, 2); assert.equal(s500.ok, false);
});

test('breakdown on an empty run is safe', () => {
  assert.deepEqual(breakdown([]), { total: 0, failed: 0, byError: [], byStatus: [] });
});

test('sla passes when every set target is met', () => {
  const r = sla({ errRate: 0.4, p95: 300, thr: 12 }, { maxErrPct: '1', maxP95Ms: '1000', minRps: '5' });
  assert.equal(r.pass, true);
  assert.equal(r.checks.length, 3);
  assert.ok(r.checks.every(c => c.ok));
});

test('sla fails and names the checks that broke', () => {
  const r = sla({ errRate: 8, p95: 300, thr: 2 }, { maxErrPct: 1, minRps: 5 });
  assert.equal(r.pass, false);
  assert.equal(r.checks.length, 2);
  assert.equal(r.checks.find(c => c.label === 'Error rate').ok, false);
  assert.equal(r.checks.find(c => c.label === 'Throughput').ok, false);
});

test('sla is null (not a failure) when no targets are set', () => {
  assert.deepEqual(sla({ errRate: 9, p95: 9999, thr: 0 }, {}), { pass: null, checks: [] });
  assert.deepEqual(sla({ errRate: 9, p95: 9999, thr: 0 }, { maxErrPct: '', maxP95Ms: null, minRps: undefined }), { pass: null, checks: [] });
});

test('sla treats a zero target as a real target', () => {
  const r = sla({ errRate: 0, p95: 10, thr: 1 }, { maxErrPct: 0 });
  assert.equal(r.checks.length, 1);
  assert.equal(r.pass, true);
});