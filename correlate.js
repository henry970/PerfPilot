// PerfPilot correlation: capture an auth/CSRF token from a response and reuse it in
// later requests. Pure functions, also unit-tested under Node.
(function (root) {
  const NAME_RE = /(csrf|xsrf|token|auth|jwt|session)/i;
  const JWT_RE = /eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{2,}/;
  const dec = s => { try { return decodeURIComponent(s); } catch { return s; } };
  const safe = s => { const n = String(s).replace(/[^A-Za-z0-9_]/g, '_').replace(/^[^A-Za-z_]+/, ''); return n || 'token'; };
  const unentity = s => String(s).replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

  function hget(headers, name) {
    if (!headers) return null;
    try { if (typeof headers.get === 'function') return headers.get(name); } catch { /* plain object */ }
    const k = Object.keys(headers).find(k => k.toLowerCase() === name.toLowerCase());
    return k ? headers[k] : null;
  }
  function scanJson(o, d) {
    if (!o || typeof o !== 'object' || d > 4) return null;
    const keys = Object.keys(o);
    for (const p of ['access_token', 'accessToken', 'token', 'csrfToken', 'csrf_token', 'xsrfToken', 'jwt', 'id_token', 'authToken', 'auth_token']) {
      const k = keys.find(k => k.toLowerCase() === p.toLowerCase());
      if (k && typeof o[k] === 'string') return o[k];
    }
    for (const k of keys) if (NAME_RE.test(k) && typeof o[k] === 'string') return o[k];
    for (const k of keys) { const r = scanJson(o[k], d + 1); if (r) return r; }
    return null;
  }
  // Reads a tag's attributes regardless of their order, quotes or entity escaping.
  const ATTR_RE = /([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  function attrs(tag) {
    const o = {}; ATTR_RE.lastIndex = 0; let m;
    while ((m = ATTR_RE.exec(tag))) o[m[1].toLowerCase()] = unentity(m[2] ?? m[3] ?? m[4] ?? '');
    return o;
  }
  // Scans <input>/<meta> tags for a token-carrying attribute, in any attribute order.
  function htmlToken(s) {
    const re = /<(input|meta)\b[^>]*>/gi; let m;
    while ((m = re.exec(s))) {
      const a = attrs(m[0]), name = a.name || '', value = a.value ?? a.content;
      if (name && value && NAME_RE.test(name)) return value;
    }
    return null;
  }
  // Tokens embedded in inline scripts / JSON blobs, e.g. csrfToken:"..." or window.token = "...".
  const JS_TOK_RE = /["']?[A-Za-z0-9_$]*(?:csrf|xsrf|token|authenticity)[A-Za-z0-9_$]*["']?\s*[:=]\s*["']([A-Za-z0-9._~+\/=-]{12,})["']/i;

  // Find the most likely auth/CSRF token in a response body + headers.
  function pickToken(text, headers) {
    for (const h of ['x-csrf-token', 'x-xsrf-token', 'csrf-token', 'x-token', 'authorization']) {
      const v = hget(headers, h);
      if (v) { const m = JWT_RE.exec(v); return m ? m[0] : (String(v).replace(/^Bearer\s+/i, '').trim() || null); }
    }
    const s = String(text ?? '');
    try { const t = scanJson(JSON.parse(s), 0); if (t) return t; } catch { /* not JSON */ }
    const tag = htmlToken(s); if (tag) return tag;
    const js = JS_TOK_RE.exec(s); if (js) return unentity(js[1]);
    const m = JWT_RE.exec(s); return m ? m[0] : null;
  }

  const isTok = v => !!v && v.length >= 12 && /^[A-Za-z0-9._~+\/=-]+$/.test(v) && /[0-9]/.test(v) && /[A-Za-z]/.test(v);
  function candidates(value) {
    const out = [], v = String(value ?? ''), j = JWT_RE.exec(v), b = /^Bearer\s+(.+)$/i.exec(v);
    if (j) out.push(j[0]);
    if (b) out.push(b[1].trim());
    if (isTok(v)) out.push(v);
    return out;
  }
  // Every name/value a request carries, keeping both the raw (wire) form and its decoded form.
  // Tokens are frequently percent-encoded in bodies/URLs (base64 "+", "/", "=" become %2B/%2F/%3D),
  // so detection must match either flavour while substitution must reuse the exact one seen.
  function fields(r) {
    const out = [];
    const add = (name, raw, decode) => out.push({ name, raw, value: decode ? dec(raw) : raw });
    String(r.headers || '').split('\n').forEach(l => { const i = l.indexOf(':'); if (i > 0) add(l.slice(0, i).trim(), l.slice(i + 1).trim(), false); });
    String(r.body || '').split(/[&\n]/).forEach(l => { const i = l.indexOf('='); if (i > 0) add(dec(l.slice(0, i)), l.slice(i + 1), true); });
    try { const q = new URL(r.url).search.replace(/^\?/, '');
      q.split('&').forEach(p => { if (!p) return; const i = p.indexOf('='); add(dec(i < 0 ? p : p.slice(0, i)), i < 0 ? '' : p.slice(i + 1), true); });
    } catch { /* relative or invalid */ }
    return out;
  }
  // Detect a token that a later request reuses, and which request produces it.
  function detectCorrelation(requests) {
    const c = new Map();
    (requests || []).forEach((r, i) => fields(r).forEach(f => candidates(f.value).forEach(v => {
      if (!(NAME_RE.test(f.name) || JWT_RE.test(v))) return;
      const e = c.get(v) || { name: safe(f.name), first: i, count: 0, jwt: JWT_RE.test(v), raws: new Set() };
      e.count++; e.first = Math.min(e.first, i);
      e.raws.add(f.value === v ? f.raw : v);           // remember the exact form used in this field
      c.set(v, e);
    })));
    let best = null;
    for (const [value, e] of c) {
      if (e.first < 1) continue;                       // needs a request before its first use
      const score = (e.jwt ? 100 : 0) + e.count * 10 + (value.length >= 20 ? 5 : 0);
      if (best && score <= best.score) continue;
      const raws = [...new Set([value, ...e.raws])].filter(Boolean).sort((a, b) => b.length - a.length);
      best = { value, name: e.name, producer: e.first - 1, score, raws };
    }
    if (!best) return null;
    const consumers = [];
    (requests || []).forEach((r, i) => { if (i === best.producer) return;
      const hay = (r.headers || '') + '\n' + (r.body || '') + '\n' + (r.url || '');
      if (best.raws.some(v => hay.includes(v))) consumers.push(i);
    });
    return consumers.length ? { name: best.name, value: best.value, raws: best.raws, producer: best.producer, consumers } : null;
  }

  // Applies a detected correlation to a plan in place: teaches the producer how to capture the
  // token, then replaces the value in every consumer while preserving the on-the-wire encoding
  // (a token that arrived percent-encoded is substituted back with ${__urlencode:name}).
  function applyCorrelation(requests, c) {
    const p = requests[c.producer];
    if (p) {
      const re = new RegExp('(^|\\n)\\s*' + c.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*=', 'm');
      if (!re.test(p.extract || '')) p.extract = ((p.extract || '').trim() + '\n' + c.name + ' = auto').trim();
    }
    const raws = (c.raws && c.raws.length ? c.raws : [c.value]).slice().sort((a, b) => b.length - a.length);
    for (const i of c.consumers) {
      const r = requests[i];
      for (const f of ['headers', 'body', 'url']) {
        let s = r[f] || '';
        for (const raw of raws) {
          if (!raw || !s.includes(raw)) continue;
          s = s.split(raw).join(raw === c.value ? '${' + c.name + '}' : '${__urlencode:' + c.name + '}');
        }
        r[f] = s;
      }
    }
    return c;
  }

  root.pickToken = pickToken;
  root.detectCorrelation = detectCorrelation;
  root.applyCorrelation = applyCorrelation;
  if (typeof module !== 'undefined') module.exports = { pickToken, detectCorrelation, applyCorrelation };
})(typeof window !== 'undefined' ? window : globalThis);