// PerfPilot importers: turn pasted cURL commands or a HAR file into plan requests.
// Pure functions, also unit-tested under Node.
(function (root) {
  // Headers the browser sets itself (fetch refuses or overrides them), same list the recorder drops.
  const DROP_HEADERS = /^(host|cookie|content-length|origin|referer|user-agent|accept-encoding|accept-language|connection|upgrade-insecure-requests|priority|pragma|cache-control|sec-.*|:.*)$/i;
  const SKIP_HOSTS = /(google-analytics|googletagmanager|doubleclick|googlesyndication|facebook\.net|hotjar|segment\.io|mixpanel|sentry\.io|clarity\.ms|newrelic|datadoghq)/i;
  const STATIC_TYPES = /^(script|stylesheet|image|font|media|manifest|texttrack|ping|websocket|other)$/i;
  const STATIC_EXT = /\.(js|mjs|css|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|eot|mp4|webm|mp3|map)(\?|#|$)/i;
  const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'];

  const b64 = s => {
    if (typeof Buffer !== 'undefined') return Buffer.from(s, 'utf8').toString('base64');
    return btoa(String.fromCharCode(...new TextEncoder().encode(s)));
  };
  function reqName(method, url) {
    let path = url;
    try { const u = new URL(url); path = u.pathname.split('/').filter(Boolean).pop() || u.hostname; } catch {}
    return `${method} ${path}`.slice(0, 60);
  }
  function headerText(pairs) {
    return pairs.filter(([n]) => n && !DROP_HEADERS.test(n.trim())).map(([n, v]) => `${n.trim()}: ${String(v ?? '').trim()}`).join('\n');
  }
  function makeReq(method, url, headerPairs, body) {
    const m = String(method || 'GET').toUpperCase();
    return { name: reqName(m, url), method: METHODS.includes(m) ? m : 'GET', url, headers: headerText(headerPairs), body: body || '', recorded: true };
  }

  // ---- cURL ----------------------------------------------------------------------------------

  // Splits one shell command line into words, honouring bash quoting: '...', "...", $'...' and \x.
  function shellWords(src) {
    const out = []; let cur = null, i = 0;
    const push = c => { cur = (cur ?? '') + c; };
    while (i < src.length) {
      const c = src[i];
      if (/\s/.test(c)) { if (cur !== null) { out.push(cur); cur = null; } i++; continue; }
      if (c === '\\') { if (src[i + 1] === '\n') { i += 2; continue; } push(src[i + 1] ?? ''); i += 2; continue; }
      if (c === "'") { const j = src.indexOf("'", i + 1); push(src.slice(i + 1, j < 0 ? undefined : j)); i = j < 0 ? src.length : j + 1; continue; }
      if (c === '$' && src[i + 1] === "'") {
        i += 2; let s = '';
        while (i < src.length && src[i] !== "'") {
          if (src[i] === '\\' && i + 1 < src.length) {
            const n = src[i + 1], map = { n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"', '0': '\0' };
            if (n === 'x') { s += String.fromCharCode(parseInt(src.substr(i + 2, 2), 16)); i += 4; continue; }
            if (n === 'u') { s += String.fromCharCode(parseInt(src.substr(i + 2, 4), 16)); i += 6; continue; }
            s += map[n] ?? n; i += 2; continue;
          }
          s += src[i++];
        }
        push(s); i++; continue;
      }
      if (c === '"') {
        i++; let s = '';
        while (i < src.length && src[i] !== '"') {
          if (src[i] === '\\' && /["\\$`\n]/.test(src[i + 1] || '')) { if (src[i + 1] !== '\n') s += src[i + 1]; i += 2; continue; }
          s += src[i++];
        }
        push(s); i++; continue;
      }
      push(c); i++;
    }
    if (cur !== null) out.push(cur);
    return out;
  }

  // Chrome's "Copy as cURL (cmd)" escapes with ^ and continues lines with ^<newline>.
  function fromCmd(src) {
    if (!/\^"/.test(src)) return src;
    return src.replace(/\^\r?\n/g, ' ').replace(/\^(.)/g, '$1');
  }

  // Splits "Copy all as cURL" output (one command per "curl ..." line, optionally joined by ; or &).
  function splitCommands(src) {
    const text = fromCmd(String(src || '').replace(/\r\n/g, '\n')).replace(/\\\n/g, ' ');
    return text.split(/(?:^|\n|;|&)\s*(?=curl(?:\.exe)?\s)/).map(s => s.trim().replace(/[;&]\s*$/, '')).filter(s => /^curl(\.exe)?\s/.test(s));
  }

  const WITH_ARG = new Set(['-o', '--output', '-m', '--max-time', '--connect-timeout', '-w', '--write-out', '--retry', '-x', '--proxy',
    '-c', '--cookie-jar', '-T', '--upload-file', '-r', '--range', '--cacert', '--cert', '--key', '-E', '--resolve', '--limit-rate', '-y', '-Y']);

  // Parses one cURL command. Returns { request, warnings } or throws when there is no URL.
  function parseCurl(cmd) {
    const w = shellWords(cmd), warnings = [];
    let method = '', url = '', head = false, get = false; const headers = [], data = [];
    for (let i = w[0] && /^curl(\.exe)?$/i.test(w[0]) ? 1 : 0; i < w.length; i++) {
      let a = w[i], v;
      const eq = a.startsWith('--') ? a.indexOf('=') : -1;
      if (eq > 0) { v = a.slice(eq + 1); a = a.slice(0, eq); }
      const next = () => (v !== undefined ? v : w[++i] ?? '');
      if (/^-X./.test(a)) { method = a.slice(2); continue; }
      if (/^-H./.test(a)) { v = a.slice(2); a = '-H'; }
      switch (a) {
        case '-X': case '--request': method = next(); break;
        case '-H': case '--header': { const h = next(), k = h.indexOf(':'); if (k > 0) headers.push([h.slice(0, k), h.slice(k + 1)]); break; }
        case '-d': case '--data': case '--data-raw': case '--data-binary': case '--data-ascii': data.push(next()); break;
        case '--data-urlencode': { const d = next(), k = d.indexOf('='); data.push(k >= 0 ? d.slice(0, k + 1) + encodeURIComponent(d.slice(k + 1)) : encodeURIComponent(d)); break; }
        case '--json': data.push(next()); headers.push(['Content-Type', 'application/json'], ['Accept', 'application/json']); break;
        case '-u': case '--user': headers.push(['Authorization', 'Basic ' + b64(next())]); break;
        case '-b': case '--cookie': next(); warnings.push('cookies were left out - the browser sends its own'); break;
        case '-A': case '--user-agent': case '-e': case '--referer': next(); break;
        case '-F': case '--form': next(); warnings.push('multipart form fields (-F) are not supported and were skipped'); break;
        case '-I': case '--head': head = true; break;
        case '-G': case '--get': get = true; break;
        case '--url': url = next(); break;
        default:
          if (WITH_ARG.has(a)) { next(); break; }
          if (a.startsWith('-') && a.length > 1) break; // flags without a value: -s, -L, -k, --compressed ...
          if (!url) url = a;
      }
    }
    if (!url) throw new Error('no URL found in the cURL command');
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    let body = data.join('&');
    if (get && body) { url += (url.includes('?') ? '&' : '?') + body; body = ''; }
    if (!method) method = head ? 'HEAD' : body ? 'POST' : 'GET';
    if (body && data.length && !headers.some(([n]) => /^content-type$/i.test(n.trim())))
      headers.push(['Content-Type', /^\s*[[{]/.test(body) ? 'application/json' : 'application/x-www-form-urlencoded']);
    return { request: makeReq(method, url, headers, ['GET', 'HEAD'].includes(method.toUpperCase()) ? '' : body), warnings };
  }

  // ---- HAR -----------------------------------------------------------------------------------

  // Parses a HAR file (DevTools > Network > Save all as HAR). Options: { statics, firstParty, host }.
  function parseHar(src, opts = {}) {
    const har = typeof src === 'string' ? JSON.parse(src) : src;
    const entries = har && har.log && Array.isArray(har.log.entries) ? har.log.entries : null;
    if (!entries) throw new Error('this is not a HAR file (no log.entries)');
    const seen = new Set(), out = []; let skipped = 0;
    let host = opts.host || '';
    if (opts.firstParty && !host) { const doc = entries.find(e => e._resourceType === 'document') || entries[0]; try { host = new URL(doc.request.url).hostname; } catch {} }
    const bare = h => String(h || '').replace(/^www\./, '');
    const sameSite = h => { const x = bare(h), y = bare(host); return !y || x === y || x.endsWith('.' + y) || y.endsWith('.' + x); };
    for (const e of entries) {
      const r = e && e.request; if (!r || !r.url || !/^https?:/i.test(r.url)) { skipped++; continue; }
      const method = String(r.method || 'GET').toUpperCase();
      const mime = (e.response && e.response.content && e.response.content.mimeType) || '';
      const isStatic = (e._resourceType && STATIC_TYPES.test(e._resourceType)) || STATIC_EXT.test(r.url) || /^(image|font|video|audio)\/|javascript|text\/css/i.test(mime);
      let h = ''; try { h = new URL(r.url).hostname; } catch {}
      if (method === 'OPTIONS' || SKIP_HOSTS.test(r.url) || (!opts.statics && isStatic) || (opts.firstParty && !sameSite(h))) { skipped++; continue; }
      const pd = r.postData || {};
      let body = pd.text || '';
      if (!body && Array.isArray(pd.params) && pd.params.length) body = pd.params.map(p => encodeURIComponent(p.name) + '=' + encodeURIComponent(p.value ?? '')).join('&');
      const key = method + ' ' + r.url + ' ' + body;
      if (seen.has(key)) { skipped++; continue; }
      seen.add(key);
      const pairs = (r.headers || []).map(x => [x.name, x.value]);
      if (body && pd.mimeType && !pairs.some(([n]) => /^content-type$/i.test(n))) pairs.push(['Content-Type', pd.mimeType]);
      out.push(makeReq(method, r.url, pairs, ['GET', 'HEAD'].includes(method) ? '' : body));
    }
    return { requests: out, skipped };
  }

  // Accepts whatever the user pasted: HAR JSON or one or more cURL commands.
  function importText(text, opts = {}) {
    const t = String(text || '').trim();
    if (!t) throw new Error('nothing to import - paste a cURL command or HAR JSON');
    if (t.startsWith('{')) { const r = parseHar(t, opts); return { kind: 'HAR', requests: r.requests, skipped: r.skipped, warnings: [] }; }
    const cmds = splitCommands(t);
    if (!cmds.length) {
      if (/Invoke-WebRequest|Invoke-RestMethod/i.test(t)) throw new Error('PowerShell copies are not supported - use "Copy as cURL (bash)" or "(cmd)"');
      throw new Error('no cURL command found - it should start with "curl"');
    }
    const requests = [], warnings = new Set();
    for (const c of cmds) { const r = parseCurl(c); requests.push(r.request); r.warnings.forEach(x => warnings.add(x)); }
    return { kind: 'cURL', requests, skipped: 0, warnings: [...warnings] };
  }

  root.parseCurl = parseCurl;
  root.parseHar = parseHar;
  root.importText = importText;
  if (typeof module !== 'undefined') module.exports = { shellWords, splitCommands, parseCurl, parseHar, importText, DROP_HEADERS };
})(typeof window !== 'undefined' ? window : globalThis);
