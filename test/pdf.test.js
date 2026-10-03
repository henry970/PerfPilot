'use strict';
// Unit tests for the dependency-free PDF writer (pdf.js). Run with: node --test test/
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPdf } = require('../pdf.js');

function summary(over = {}) {
  return Object.assign({
    id: 1,
    name: 'My test plan',
    date: new Date('2026-01-02T03:04:05Z').toISOString(),
    threads: 10,
    secs: 30,
    active: 0,
    total: 100,
    ok: 98,
    failed: 2,
    avg: 120.5,
    p95: 300.2,
    thr: 3.33,
    errRate: 2,
    cfg: { rampUp: 5, mode: 'duration', loops: 10, duration: 30, think: 0, thinkMax: 0, cookies: true, targets: ['example.com'] },
    pctls: [50, 90, 95, 99],
    pcts: [120, 150, 180, 240],
    breakdown: { total: 100, failed: 2, byError: [{ label: 'status 500', count: 2, pct: 100 }], byStatus: [{ status: 200, count: 98, pct: 98, ok: true }, { status: 500, count: 2, pct: 2, ok: false }] },
    sla: { pass: true, checks: [{ label: 'Error rate', value: 2, limit: 5, unit: '%', dir: 'max', ok: true }] },
    rows: [
      { name: 'Home', method: 'GET', url: 'https://example.com/home', n: 60, avg: 100, min: 50, max: 200, pcts: [100, 150, 180, 210], err: 0 },
      { name: 'Search', method: 'GET', url: 'https://example.com/search?q=shoes', n: 40, avg: 150, min: 80, max: 400, pcts: [150, 300, 350, 390], err: 5 }
    ]
  }, over);
}
function plan() {
  return { name: 'My test plan', rampUp: 5, mode: 'duration', loops: 10, duration: 30, think: 0, thinkMax: 0, cookies: true, requests: [{ url: 'https://example.com/' }] };
}
const text = u => Buffer.from(u).toString('latin1');

test('returns a PDF byte stream', () => {
  const out = buildPdf(summary(), plan(), null);
  assert.ok(out instanceof Uint8Array);
  assert.ok(out.length > 800);
  const s = text(out);
  assert.ok(s.startsWith('%PDF-1.4'));
  assert.ok(s.trimEnd().endsWith('%%EOF'));
});

test('includes the required PDF object types', () => {
  const s = text(buildPdf(summary(), plan(), null));
  assert.ok(s.includes('/Type /Catalog'));
  assert.ok(s.includes('/Type /Pages'));
  assert.ok(s.includes('/Type /Page '));
  assert.ok(s.includes('/BaseFont /Helvetica '));
  assert.ok(s.includes('/BaseFont /Helvetica-Bold '));
});

test('brands the cover page and titles the report', () => {
  const s = text(buildPdf(summary(), plan(), null));
  assert.ok(s.includes('ConfixHub'));
  assert.ok(s.includes('Performance Report'));
  assert.ok(s.includes('MY TEST PLAN'));
  assert.ok(s.includes('Performance Test Report'));
});

test('shows a plain-language verdict and rating for a healthy run', () => {
  const s = text(buildPdf(summary({ errRate: 0.5, failed: 0, ok: 100, breakdown: { total: 100, failed: 0, byError: [], byStatus: [] } }), plan(), null));
  assert.ok(s.includes('HEALTHY'));
  assert.ok(!s.includes('FAILING'));
  assert.ok(s.includes('RATING'));
  assert.ok(s.includes('Excellent'));
});

test('shows a failing verdict when the error rate is high', () => {
  const s = text(buildPdf(summary({ errRate: 12, failed: 12, ok: 88 }), plan(), null));
  assert.ok(s.includes('FAILING'));
  assert.ok(s.includes('12 of 100 requests failed')); // parens are escaped in the PDF stream
  assert.ok(s.includes('12.0%'));
});

test('flags a middling run as needing attention', () => {
  const s = text(buildPdf(summary({ errRate: 3, failed: 3, ok: 97 }), plan(), null));
  assert.ok(s.includes('NEEDS ATTENTION'));
  assert.ok(s.includes('Good'));
});

test('renders a plain-language configuration block', () => {
  const s = text(buildPdf(summary(), plan(), null));
  assert.ok(s.includes('What we tested'));
  assert.ok(s.includes('Visitors at once'));
  assert.ok(s.includes('Time to reach full load'));
  assert.ok(s.includes('5 s'));               // ramp-up
  assert.ok(s.includes('actual 30 s'));       // duration run length (parens are escaped)
  assert.ok(s.includes('Sent'));              // cookies are sent
});

test('lists every request in the detailed table', () => {
  const s = text(buildPdf(summary(), plan(), null));
  assert.ok(s.includes('Detailed results'));
  assert.ok(s.includes('Home'));
  assert.ok(s.includes('Search'));
});

test('shows the endpoint (method + url) for every request', () => {
  const s = text(buildPdf(summary(), plan(), null));
  assert.ok(s.includes('Request / endpoint'));
  assert.ok(s.includes('GET  https://example.com/home'));
  assert.ok(s.includes('GET  https://example.com/search?q=shoes'));
});

test('explains the report in plain language', () => {
  const s = text(buildPdf(summary(), plan(), null));
  assert.ok(s.includes('What the numbers mean'));
  assert.ok(s.includes('Endpoint'));
  assert.ok(s.includes('Rating:'));
  assert.ok(s.includes('Requests per second'));
});

test('still renders a detailed row that has no url', () => {
  const s = text(buildPdf(summary({ rows: [{ name: 'NoUrl', n: 1, avg: 1, min: 1, max: 1, p90: 1, p95: 1, err: 0 }] }), plan(), null));
  assert.ok(s.includes('NoUrl'));
  assert.ok(s.includes('Request / endpoint'));
});

test('shows the configured percentiles as table columns', () => {
  const s = text(buildPdf(summary(), plan(), null));
  assert.ok(s.includes('P50'));
  assert.ok(s.includes('P99'));
});

test('renders a summary line for the pass/fail targets', () => {
  const s = text(buildPdf(summary(), plan(), null));
  assert.ok(s.includes('Against your targets: PASS'));
  assert.ok(s.includes('Error rate <= 5%'));
});

test('groups failures by reason when there are errors', () => {
  const s = text(buildPdf(summary(), plan(), null));
  assert.ok(s.includes('What went wrong'));
  assert.ok(s.includes('status 500'));
  assert.ok(s.includes('2 of 100 requests failed'));
});

test('leads with a plain-language summary and rating', () => {
  const s = text(buildPdf(summary(), plan(), null));
  assert.ok(s.includes('SUMMARY'));
  assert.ok(s.includes('At a glance'));
});

test('explains the results in plain English', () => {
  const s = text(buildPdf(summary(), plan(), null));
  assert.ok(s.includes('What this means'));
  assert.ok(s.includes('Reliability:'));
  assert.ok(s.includes('Speed:'));
  assert.ok(s.includes('Capacity:'));
});

test('gives plain-language next steps and calls out the worst areas', () => {
  const s = text(buildPdf(summary(), plan(), null));
  assert.ok(s.includes('What to do next'));
  assert.ok(s.includes('Slowest page:'));
  assert.ok(s.includes('Most failures:'));
  assert.ok(s.includes('Apache JMeter'));
});

test('embeds the chart image when one is supplied', () => {
  const s = text(buildPdf(summary(), plan(), { data: 'x'.repeat(128), w: 720, h: 300 }));
  assert.ok(s.includes('/Subtype /Image'));
  assert.ok(s.includes('/DCTDecode'));
  assert.ok(s.includes('/Width 720'));
  assert.ok(s.includes('/Height 300'));
  assert.ok(s.includes('How the load behaved over time'));
});

test('omits the chart section when no image is supplied', () => {
  const s = text(buildPdf(summary(), plan(), null));
  assert.ok(!s.includes('/Subtype /Image'));
  assert.ok(!s.includes('How the load behaved over time'));
});

test('handles a run with no samples without throwing', () => {
  let s;
  assert.doesNotThrow(() => { s = text(buildPdf(summary({ total: 0, ok: 0, failed: 0, errRate: 0, avg: 0, p95: 0, thr: 0, rows: [], breakdown: { total: 0, failed: 0, byError: [], byStatus: [] } }), plan(), null)); });
  assert.ok(s.includes('NO DATA'));
  assert.ok(s.includes('0.0%'));
});

test('sanitises non-WinAnsi characters instead of producing junk', () => {
  const s = text(buildPdf(summary({ name: 'Café ☕ test' }), plan(), null));
  assert.ok(s.startsWith('%PDF-1.4'));
  assert.ok(s.includes('CAF? ? TEST')); // accents/emoji collapse to '?'
});

test('cross-reference offsets point at their objects', () => {
  const s = text(buildPdf(summary(), plan(), { data: 'y'.repeat(96), w: 600, h: 300 }));
  const m = /\nxref\n0 (\d+)\n/.exec(s);
  assert.ok(m, 'expected an xref table');
  const count = Number(m[1]);
  const start = m.index + 1; // index of the literal "xref"
  const tail = s.slice(start).split('\n');
  const xr = Number(s.slice(s.lastIndexOf('startxref') + 'startxref'.length).trim().split(/\s+/)[0]);
  assert.equal(xr, start, 'startxref must point at the xref table');
  for (let i = 1; i < count; i++) {
    const off = Number(tail[2 + i].slice(0, 10));
    assert.ok(s.startsWith(`${i} 0 obj`, off), `object ${i} offset ${off} is wrong`);
  }
});