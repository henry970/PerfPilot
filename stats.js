// PerfPilot result diagnostics: percentile-list parsing, error breakdown, SLA pass/fail and run comparison.
// Pure functions, also unit-tested under Node.
(function (root) {
  const DEF_PCTLS = [50, 90, 95, 99];
  // "50,90,95,99" -> [50,90,95,99]; blanks/dupes/invalid values are dropped, capped at 4 columns.
  function parsePctls(v) {
    const list = String(v == null ? '' : v).split(/[,\s]+/)
      .map(s => Math.round(Number(s)))
      .filter(n => Number.isFinite(n) && n > 0 && n <= 100);
    const uniq = [...new Set(list)];
    return (uniq.length ? uniq : DEF_PCTLS).slice(0, 4);
  }
  // Groups failed samples into human reasons. Status codes stay distinct (404 and 500 are
  // different problems) but embedded numbers are collapsed so "slower than 2500 ms" and
  // "slower than 900 ms" group together.
  function errorKey(err) {
    const t = String(err == null ? '' : err).trim();
    if (!t) return 'unknown error';
    if (/^status \d{3}$/i.test(t)) return t.toLowerCase();
    return t.replace(/\d+/g, 'N').toLowerCase();
  }
  function breakdown(samples) {
    const all = samples || [], byError = new Map(), byStatus = new Map();
    let failed = 0;
    for (const s of all) {
      const status = Number(s && s.status) || 0;
      const st = byStatus.get(status) || { status, count: 0 };
      st.count++; byStatus.set(status, st);
      if (s && s.ok) continue;
      failed++;
      const key = errorKey(s && s.err);
      const e = byError.get(key) || { label: String(((s && s.err) || 'status ' + status)).trim(), count: 0 };
      e.count++; byError.set(key, e);
    }
    const rank = m => [...m.values()].sort((a, b) => b.count - a.count);
    return {
      total: all.length, failed,
      byError: rank(byError).map(e => ({ label: e.label, count: e.count, pct: failed ? e.count / failed * 100 : 0 })),
      byStatus: rank(byStatus).map(e => ({ status: e.status, count: e.count, pct: all.length ? e.count / all.length * 100 : 0, ok: e.status >= 200 && e.status < 400 }))
    };
  }
  // Compares a finished run against the user's targets. Blank targets are skipped;
  // pass is null when nothing was set to check.
  function sla(S, limits) {
    const lim = limits || {}, checks = [];
    const num = v => (v === '' || v == null || !Number.isFinite(+v)) ? null : +v;
    const maxErr = num(lim.maxErrPct), maxP95 = num(lim.maxP95Ms), minRps = num(lim.minRps);
    if (maxErr != null) checks.push({ label: 'Error rate', value: S.errRate, limit: maxErr, unit: '%', dir: 'max', ok: S.errRate <= maxErr });
    if (maxP95 != null) checks.push({ label: 'P95 response', value: S.p95, limit: maxP95, unit: ' ms', dir: 'max', ok: S.p95 <= maxP95 });
    if (minRps != null) checks.push({ label: 'Throughput', value: S.thr, limit: minRps, unit: ' req/s', dir: 'min', ok: S.thr >= minRps });
    return { pass: checks.length ? checks.every(c => c.ok) : null, checks };
  }

  // Compares a run (cur) against a baseline run (base). Small wobbles count as "same" so normal
  // network noise is not reported as a regression: under 5% (or under 5 ms) for times and
  // throughput, under 0.5 percentage points for the error rate.
  function judge(b, c, lowerBetter, kind) {
    const delta = c - b, pct = b ? delta / b * 100 : (c ? Infinity : 0);
    const same = kind === 'pts' ? Math.abs(delta) < 0.5 : kind === 'ms' ? (Math.abs(delta) < 5 || Math.abs(pct) < 5) : Math.abs(pct) < 5;
    return { delta, pct, status: same ? 'same' : (delta < 0) === lowerBetter ? 'better' : 'worse' };
  }
  function compareRuns(base, cur) {
    const M = [['avg', 'Avg response', ' ms', true, 'ms'], ['p95', 'P95 response', ' ms', true, 'ms'], ['errRate', 'Error rate', '%', true, 'pts'], ['thr', 'Throughput', ' req/s', false, 'rate']];
    const metrics = M.map(([key, label, unit, lowerBetter, kind]) => Object.assign({ key, label, unit, base: +base[key] || 0, cur: +cur[key] || 0 }, judge(+base[key] || 0, +cur[key] || 0, lowerBetter, kind)));
    const keyOf = r => (r.method || 'GET') + ' ' + (r.url || r.name);
    const baseRows = new Map((base.rows || []).filter(r => r.n).map(r => [keyOf(r), r]));
    const rows = (cur.rows || []).filter(r => r.n).map(r => {
      const b = baseRows.get(keyOf(r));
      return { name: r.name, method: r.method, url: r.url, base: b ? b.avg : null, cur: r.avg, ...(b ? judge(b.avg, r.avg, true, 'ms') : { delta: null, pct: null, status: 'new' }) };
    });
    const notes = [];
    if (base.threads !== cur.threads) notes.push(`Different user counts (${base.threads} vs ${cur.threads}), so the runs are not directly comparable.`);
    const bc = base.cfg || {}, cc = cur.cfg || {};
    if (bc.mode && cc.mode && (bc.mode !== cc.mode || (cc.mode === 'duration' ? bc.duration !== cc.duration : bc.loops !== cc.loops)))
      notes.push('The runs used a different length (duration or loops).');
    const worse = metrics.filter(m => m.status === 'worse').length, better = metrics.filter(m => m.status === 'better').length;
    return { metrics, rows, notes, overall: worse ? 'worse' : better ? 'better' : 'same' };
  }

  root.parsePctls = parsePctls;
  root.errorKey = errorKey;
  root.breakdown = breakdown;
  root.sla = sla;
  root.compareRuns = compareRuns;
  if (typeof module !== 'undefined') module.exports = { parsePctls, errorKey, breakdown, sla, compareRuns, DEF_PCTLS };
})(typeof window !== 'undefined' ? window : globalThis);