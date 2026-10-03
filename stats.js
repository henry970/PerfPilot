// PerfPilot result diagnostics: percentile-list parsing, error breakdown and SLA pass/fail.
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

  root.parsePctls = parsePctls;
  root.errorKey = errorKey;
  root.breakdown = breakdown;
  root.sla = sla;
  if (typeof module !== 'undefined') module.exports = { parsePctls, errorKey, breakdown, sla, DEF_PCTLS };
})(typeof window !== 'undefined' ? window : globalThis);