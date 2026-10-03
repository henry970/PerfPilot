// PerfPilot variable extraction: turns "name = json:path | regex:pattern | header:Name | cookie:Name | auto"
// rules into variable values after a sample. Pure functions, also unit-tested under Node.
(function (root) {
  // Parses one rule line. The kind defaults to "auto" when no ":" is present,
  // so the "token = auto" rule that correlation writes is understood correctly.
  function parseExtractSpec(line) {
    const i = String(line ?? '').indexOf('=');
    if (i < 1) return null;
    const name = String(line).slice(0, i).trim();
    if (!name) return null;
    const spec = String(line).slice(i + 1).trim();
    const j = spec.indexOf(':');
    const kind = (j < 0 ? spec : spec.slice(0, j)).trim().toLowerCase();
    return { name, kind: kind || 'auto', arg: j < 0 ? '' : spec.slice(j + 1).trim() };
  }
  // dot/bracket path lookup, e.g. "[0].data.token" or "data[0].token".
  function jsonPath(o, p) {
    return String(p).replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean)
      .reduce((a, k) => (a == null ? undefined : a[k]), o);
  }
  // Runs every rule against one response. ctx = { text, header(n), cookie(n), auto() }.
  // cookie()/auto() may be async; returns { vars, miss } where miss lists unresolved names.
  async function runExtract(rules, ctx) {
    const vars = {}, miss = [];
    for (const line of (rules || [])) {
      const s = parseExtractSpec(line);
      if (!s) continue;
      let v;
      try {
        if (s.kind === 'json') v = jsonPath(JSON.parse(ctx.text), s.arg);
        else if (s.kind === 'regex') { const m = new RegExp(s.arg).exec(ctx.text); v = m ? (m[1] ?? m[0]) : undefined; }
        else if (s.kind === 'header') v = ctx.header(s.arg);
        else if (s.kind === 'cookie') v = ctx.cookie ? await ctx.cookie(s.arg) : undefined;
        else if (s.kind === 'auto') v = ctx.auto ? await ctx.auto() : undefined;
      } catch { /* leave v undefined -> reported as missing */ }
      if (v === undefined || v === null) miss.push(s.name);
      else vars[s.name] = typeof v === 'object' ? JSON.stringify(v) : String(v);
    }
    return { vars, miss };
  }

  root.parseExtractSpec = parseExtractSpec;
  root.jsonPath = jsonPath;
  root.runExtract = runExtract;
  if (typeof module !== 'undefined') module.exports = { parseExtractSpec, jsonPath, runExtract };
})(typeof window !== 'undefined' ? window : globalThis);