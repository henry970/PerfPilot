'use strict';
// Unit tests for the results diagnostics (stats.js). Run with: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const { parsePctls, errorKey, breakdown, sla, compareRuns, DEF_PCTLS } = require('../stats.js');

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
test('compareRuns flags regressions and improvements against a baseline', () => {
  const row = (name, avg, n = 10) => ({ name, method: 'GET', url: 'https://x.io/' + name, n, avg });
  const base = { threads: 10, cfg: { mode: 'duration', duration: 30 }, avg: 200, p95: 400, errRate: 1, thr: 50, rows: [row('a', 100), row('b', 300)] };
  const cur = { threads: 10, cfg: { mode: 'duration', duration: 30 }, avg: 260, p95: 402, errRate: 0.2, thr: 60, rows: [row('a', 150), row('b', 302), row('c', 80)] };
  const c = compareRuns(base, cur);
  const m = Object.fromEntries(c.metrics.map(x => [x.key, x]));
  assert.equal(m.avg.status, 'worse'); assert.equal(Math.round(m.avg.pct), 30);
  assert.equal(m.p95.status, 'same');                 // +2 ms is noise
  assert.equal(m.errRate.status, 'better'); assert.ok(Math.abs(m.errRate.delta + 0.8) < 1e-9);
  assert.equal(m.thr.status, 'better');               // higher throughput is better
  assert.equal(c.overall, 'worse');
  assert.deepEqual(c.rows.map(r => [r.name, r.status]), [['a', 'worse'], ['b', 'same'], ['c', 'new']]);
  assert.deepEqual(c.notes, []);
});

test('compareRuns warns when the runs are set up differently', () => {
  const S = (threads, duration) => ({ threads, cfg: { mode: 'duration', duration }, avg: 100, p95: 100, errRate: 0, thr: 10, rows: [] });
  const c = compareRuns(S(10, 30), S(50, 60));
  assert.equal(c.overall, 'same');
  assert.equal(c.notes.length, 2);
  assert.match(c.notes[0], /10 vs 50/);
});
