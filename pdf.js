// Minimal dependency-free PDF writer + PerfPilot report layout (cover page + overview pages).
(function (root) {
  const PW = 595, PH = 842;
  const W = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
  const clean = s => String(s ?? '').replace(/[\u00a0\u202f\u2009\u2007]/g, ' ').replace(/[\u00b7\u2022]/g, '-').replace(/[\u2013\u2014]/g, '-').replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[^\x20-\x7e]/g, '?');
  const tw = (s, size, bold) => { let w = 0; for (const ch of clean(s)) { const c = ch.charCodeAt(0); w += W[c - 32] * (bold && /[A-Za-z]/.test(ch) ? 1.06 : 1); } return w * size / 1000; };
  const esc = s => clean(s).replace(/[\\()]/g, m => '\\' + m);
  const rgb = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => (v / 255).toFixed(3)).join(' '); };
  const f = n => (+n).toFixed(2);
  function fit(s, size, bold, maxW) { s = clean(s); if (tw(s, size, bold) <= maxW) return s; while (s.length > 1 && tw(s + '...', size, bold) > maxW) s = s.slice(0, -1); return s + '...'; }
  function wrap(s, size, bold, maxW) { const out = []; let cur = ''; for (const w of clean(s).split(' ')) { const t = cur ? cur + ' ' + w : w; if (tw(t, size, bold) > maxW && cur) { out.push(cur); cur = w; } else cur = t; } if (cur) out.push(cur); return out; }

  class Page {
    constructor() { this.o = []; this.img = false; }
    rect(x, y, w, h, o = {}) {
      const Y = PH - y - h, r = Math.min(o.r || 0, w / 2, h / 2), p = this.o; p.push('q');
      if (o.fill) p.push(rgb(o.fill) + ' rg'); if (o.stroke) { p.push(rgb(o.stroke) + ' RG'); p.push((o.lw || 1) + ' w'); }
      if (!r) p.push(`${f(x)} ${f(Y)} ${f(w)} ${f(h)} re`);
      else { const k = .5523 * r, X = x + w, T = Y + h;
        p.push(`${f(x + r)} ${f(Y)} m ${f(X - r)} ${f(Y)} l ${f(X - r + k)} ${f(Y)} ${f(X)} ${f(Y + r - k)} ${f(X)} ${f(Y + r)} c ${f(X)} ${f(T - r)} l ${f(X)} ${f(T - r + k)} ${f(X - r + k)} ${f(T)} ${f(X - r)} ${f(T)} c ${f(x + r)} ${f(T)} l ${f(x + r - k)} ${f(T)} ${f(x)} ${f(T - r + k)} ${f(x)} ${f(T - r)} c ${f(x)} ${f(Y + r)} l ${f(x)} ${f(Y + r - k)} ${f(x + r - k)} ${f(Y)} ${f(x + r)} ${f(Y)} c h`); }
      p.push(o.fill && o.stroke ? 'B' : o.fill ? 'f' : 'S'); p.push('Q'); }
    poly(pts, o = {}) { const p = this.o; p.push('q'); if (o.fill) p.push(rgb(o.fill) + ' rg'); if (o.stroke) { p.push(rgb(o.stroke) + ' RG'); p.push((o.lw || 1) + ' w'); p.push('1 j 1 J'); }
      p.push(pts.map(([x, y], i) => `${f(x)} ${f(PH - y)} ${i ? 'l' : 'm'}`).join(' ') + (o.close === false ? '' : ' h')); p.push(o.fill && o.stroke ? 'B' : o.fill ? 'f' : 'S'); p.push('Q'); }
    line(x1, y1, x2, y2, w, c) { this.o.push(`q ${rgb(c)} RG ${w} w ${f(x1)} ${f(PH - y1)} m ${f(x2)} ${f(PH - y2)} l S Q`); }
    text(s, x, y, o = {}) { const size = o.size || 10, bold = !!o.bold; if (o.maxW) s = fit(s, size, bold, o.maxW); const w = tw(s, size, bold);
      if (o.align === 'right') x -= w; else if (o.align === 'center') x -= w / 2;
      this.o.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${rgb(o.color || '#000000')} rg ${f(x)} ${f(PH - y)} Td (${esc(s)}) Tj ET`); }
    image(x, y, w, h) { this.img = true; this.o.push(`q ${f(w)} 0 0 ${f(h)} ${f(x)} ${f(PH - y - h)} cm /Im1 Do Q`); }
  }

  function serialize(pages, image) {
    const objs = []; const res = () => (objs.push(null), objs.length);
    const cat = res(), pgs = res(), f1 = res(), f2 = res(); const im = image ? res() : 0; const ids = [];
    pages.forEach(p => { const c = res(), g = res(); ids.push(g);
      const body = p.o.join('\n'); objs[c - 1] = `<< /Length ${body.length} >>\nstream\n${body}\nendstream`;
      objs[g - 1] = `<< /Type /Page /Parent ${pgs} 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >>${p.img && im ? ` /XObject << /Im1 ${im} 0 R >>` : ''} >> /Contents ${c} 0 R >>`; });
    objs[cat - 1] = `<< /Type /Catalog /Pages ${pgs} 0 R >>`;
    objs[pgs - 1] = `<< /Type /Pages /Kids [${ids.map(i => i + ' 0 R').join(' ')}] /Count ${ids.length} >>`;
    objs[f1 - 1] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
    objs[f2 - 1] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
    if (image) objs[im - 1] = `<< /Type /XObject /Subtype /Image /Width ${image.w} /Height ${image.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.data.length} >>\nstream\n${image.data}\nendstream`;
    let out = '%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n'; const off = [];
    objs.forEach((o, i) => { off.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xr = out.length; out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + off.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
    out += `trailer\n<< /Size ${objs.length + 1} /Root ${cat} 0 R >>\nstartxref\n${xr}\n%%EOF`;
    const u = new Uint8Array(out.length); for (let i = 0; i < out.length; i++) u[i] = out.charCodeAt(i) & 255; return u;
  }

  function buildPdf(S, plan, chart) {
    const navy = '#0f2744', cyan = '#1aa3e8', muted = '#6b7280', ink = '#1f2937', rule = '#e5e7eb', M = 48, CW = PW - 2 * M;
    const cfg = S.cfg || { rampUp: plan.rampUp, mode: plan.mode, loops: plan.loops, duration: plan.duration, think: plan.think, thinkMax: plan.thinkMax, cookies: plan.cookies, targets: [] };
    const targets = (cfg.targets && cfg.targets.length) ? cfg.targets : [...new Set(plan.requests.map(r => { try { return new URL(r.url.replace(/\$\{[^}]*\}/g, 'x')).host; } catch { return r.url; } }))].filter(Boolean);
    const when = new Date(S.date).toLocaleString('en-GB');
    const pages = [];

    // ---- cover page
    const c = new Page(); pages.push(c);
    c.rect(0, 0, PW, PH, { fill: navy });
    c.poly([[48, 40], [66, 40], [66, 52], [57, 62], [48, 52]], { stroke: cyan, lw: 1.6 });
    c.poly([[51, 50], [55, 50], [57, 45], [60, 55], [62, 50], [64, 50]], { stroke: '#ffffff', lw: 1.2, close: false });
    c.text('ConfixHub', 78, 57, { size: 17, bold: true, color: '#ffffff' });
    c.text('Performance Testing', M, 205, { size: 11, color: '#7f9bbd' });
    c.text('Performance Report', M, 245, { size: 34, bold: true, color: '#ffffff' });
    c.rect(M, 262, 96, 3, { fill: cyan });
    c.text((S.name || 'Test plan').toUpperCase(), M, 296, { size: 11, bold: true, color: '#ffffff', maxW: CW });
    c.text('Target: ' + (targets.join(', ') || '-'), M, 316, { size: 9.5, color: '#9fb3cc', maxW: CW });
    c.text('Generated: ' + when, M, 332, { size: 9.5, color: '#9fb3cc' });
    c.text(`${S.threads} users, ${S.total} requests`, M, 348, { size: 9.5, color: '#9fb3cc' });
    c.rect(48, 640, 150, 134, { fill: '#1b5fc4', r: 8 });
    c.rect(48, 628, 62, 24, { fill: '#1b5fc4', r: 6 });
    c.rect(86, 680, 170, 94, { fill: '#2f88e6', r: 8 });
    c.rect(0, PH - 7, PW, 7, { fill: '#e5254f' });

    // ---- content pages
    let pg, y;
    const newPage = first => { pg = new Page(); pages.push(pg);
      if (first) { pg.text('Performance Test Report', M, 54, { size: 19, bold: true, color: navy }); pg.text('Target: ' + (targets.join(', ') || '-'), M, 72, { size: 9, color: muted, maxW: CW }); pg.text('Generated: ' + when, M, 85, { size: 9, color: muted }); pg.rect(M, 94, CW, 1.5, { fill: cyan }); y = 120; }
      else { pg.text('Performance Test Report (continued)', M, 44, { size: 9, color: muted }); pg.rect(M, 52, CW, 1, { fill: rule }); y = 76; } };
    const ensure = h => { if (y + h > 790) newPage(false); };
    const h1 = t => { pg.text(t, M, y, { size: 14, bold: true, color: cyan }); y += 24; };
    const h2 = t => { ensure(40); pg.text(t, M, y, { size: 11, bold: true, color: navy }); y += 16; };
    newPage(true);

    const pass = S.total > 0 && S.errRate <= 1;
    const status = !S.total ? 'NO DATA' : S.errRate <= 1 ? 'HEALTHY' : S.errRate <= 5 ? 'NEEDS ATTENTION' : 'FAILING';
    const sc = !S.total ? muted : S.errRate <= 1 ? '#15803d' : S.errRate <= 5 ? '#b45309' : '#dc2626';
    const sBg = !S.total ? '#f8fafc' : S.errRate <= 1 ? '#f0fdf4' : S.errRate <= 5 ? '#fffbeb' : '#fef2f2';
    const sBd = !S.total ? rule : S.errRate <= 1 ? '#86efac' : S.errRate <= 5 ? '#fcd34d' : '#fca5a5';
    const grade = S.errRate <= 1 ? 'A' : S.errRate <= 3 ? 'B' : S.errRate <= 5 ? 'C' : S.errRate <= 10 ? 'D' : 'F';
    const gradeWord = { A: 'Excellent', B: 'Good', C: 'Fair', D: 'Poor', F: 'Failing' }[grade];
    const gc = { A: '#16a34a', B: '#65a30d', C: '#d97706', D: '#ea580c', F: '#dc2626' }[grade];
    const successPct = S.total ? (S.ok / S.total * 100) : 0;
    const slowest = S.rows.filter(r => r.n).slice().sort((a, b) => b.avg - a.avg)[0];
    const worst = S.rows.filter(r => r.err > 0).slice().sort((a, b) => b.err - a.err)[0];
    const writeLines = (txt, gap) => { wrap(txt, 9, false, CW - 24).forEach(l => { ensure(18); pg.text(l, M + 14, y, { size: 9, color: ink }); y += 12; }); y += gap; };
    const bullet = (t, gap) => writeLines('- ' + t, gap);

    h1('1  SUMMARY');
    const sumText = !S.total
      ? 'No requests were recorded for this run, so there is nothing to grade yet.'
      : pass
        ? `Good news: ${successPct.toFixed(1)}% of requests worked, and pages responded in about ${S.avg.toFixed(0)} ms on average.`
        : `Attention needed: ${S.failed} of ${S.total} requests failed (${S.errRate.toFixed(1)}%), which is above the 1% target.`;
    pg.rect(M, y, CW - 82, 66, { fill: sBg, stroke: sBd, r: 6 });
    pg.text(status, M + 16, y + 26, { size: 16, bold: true, color: sc });
    wrap(sumText, 8.5, false, CW - 124).slice(0, 3).forEach((l, i) => pg.text(l, M + 16, y + 42 + i * 11, { size: 8.5, color: muted }));
    pg.rect(M + CW - 70, y, 70, 66, { stroke: gc, lw: 2, r: 8 });
    pg.text('RATING', M + CW - 35, y + 13, { size: 7, bold: true, color: muted, align: 'center' });
    pg.text(grade, M + CW - 35, y + 45, { size: 30, bold: true, color: gc, align: 'center' });
    pg.text(gradeWord, M + CW - 35, y + 59, { size: 8, color: muted, align: 'center' });
    y += 66 + 22;

    h2('What this means');
    if (S.total) {
      bullet(`Reliability: ${successPct.toFixed(1)}% of requests worked (${S.ok} of ${S.total}).`, 5);
      bullet(`Speed: pages replied in about ${S.avg.toFixed(0)} ms on average; the slowest 5% took ${S.p95.toFixed(0)} ms or more.`, 5);
      bullet(`Capacity: the site handled about ${S.thr.toFixed(1)} requests every second.`, 5);
      if (slowest) bullet(`Slowest page: "${slowest.name}" averaged ${slowest.avg.toFixed(0)} ms.`, 5);
      if (worst) bullet(`Most failures: "${worst.name}" failed ${worst.err.toFixed(1)}% of the time.`, 5);
    } else bullet('There was no traffic in this run, so no reliability or speed figures are available.', 5);
    if (S.sla && S.sla.pass !== null) {
      const detail = S.sla.checks.map(c => `${c.label} ${c.dir === 'max' ? '<=' : '>='} ${c.limit}${c.unit} (actual ${(c.unit === '%' ? c.value.toFixed(1) : c.value.toFixed(0)) + c.unit})`).join('; ');
      bullet(`Against your targets: ${S.sla.pass ? 'PASS' : 'FAIL'}. ${detail}.`, 5);
    }
    y += 8;

    h2('What to do next');
    if (!S.total) bullet('Run the test again and make sure the requests actually reach the target.', 5);
    else {
      if (worst) bullet(`Look at "${worst.name}" first - it failed ${worst.err.toFixed(1)}% of requests.`, 5);
      if (S.p95 > 1000) bullet(`Some pages felt slow (the slowest 5% took ${S.p95.toFixed(0)} ms). Try caching, fewer calls per page, or more server capacity.`, 5);
      else if (!worst) bullet('No obvious problems at this level of traffic.', 5);
      bullet(`This run used ${S.threads} simulated visitors. To push further, open the exported .jmx file in Apache JMeter.`, 5);
    }
    y += 12;

    if (S.breakdown && S.breakdown.failed) {
      ensure(70); h2('What went wrong');
      writeLines(`${S.breakdown.failed} of ${S.breakdown.total} requests failed. They are grouped by reason below - fix the biggest group first.`, 6);
      S.breakdown.byError.slice(0, 8).forEach((e, i) => {
        ensure(18); if (i % 2 === 0) pg.rect(M, y - 12, CW, 18, { fill: '#f8fafc' });
        pg.text(e.label, M + 8, y, { size: 9, color: ink, maxW: CW - 190 });
        pg.text(String(e.count), M + CW - 96, y, { size: 9, color: ink, align: 'right', maxW: 80 });
        pg.text(e.pct.toFixed(0) + '%', M + CW - 8, y, { size: 9, bold: true, color: '#dc2626', align: 'right' });
        y += 18;
      });
      y += 12;
    }

    h2('What the numbers mean');
    bullet('Requests made: how many requests your visitors sent during the run.', 4);
    bullet('Average speed: the typical time one request took, in milliseconds (ms). Lower is better.', 4);
    bullet('Slowest 5% took (P95): 95 out of every 100 requests finished within this time, so it shows the worst experience rather than the average.', 4);
    bullet('Requests per second (throughput): how much traffic the site actually handled each second.', 4);
    bullet('Error rate: the share of requests that failed - a wrong status code, missing expected text, slower than the limit, or a login/token that could not be captured.', 4);
    bullet('Rating: A = up to 1% errors, B = up to 3%, C = up to 5%, D = up to 10%, F = more than 10%. The headline verdict uses the same thresholds: healthy, needs attention, failing.', 4);
    bullet('Endpoint: the HTTP method and URL that each row of the detailed table (section 5) was sent to.', 4);
    y += 8;

    h2('2  At a glance');
    const cx = M + 52, cy = y + 56, R = 46, okFrac = S.total ? S.ok / S.total : 0;
    const slice = (a0, a1, col) => { const pts = [[cx, cy]]; const n = Math.max(2, Math.ceil((a1 - a0) / (Math.PI / 30))); for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; pts.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]); } pg.poly(pts, { fill: col }); };
    const A0 = -Math.PI / 2;
    if (!S.total) slice(A0, A0 + 2 * Math.PI, '#d1d5db'); else if (okFrac >= 1) slice(A0, A0 + 2 * Math.PI, '#16a34a'); else if (okFrac <= 0) slice(A0, A0 + 2 * Math.PI, '#dc2626');
    else { slice(A0, A0 + 2 * Math.PI * okFrac, '#16a34a'); slice(A0 + 2 * Math.PI * okFrac, A0 + 2 * Math.PI, '#dc2626'); }
    const bx = M + 130, bw = CW - 130 - 90;
    [['Successful', S.ok, '#16a34a'], ['Failed', S.failed, '#dc2626']].forEach(([l, v, col], i) => { const by = y + 26 + i * 34;
      pg.text(l, bx, by - 4, { size: 9, color: ink }); pg.rect(bx, by, bw, 10, { fill: '#e5e7eb', r: 2 }); if (S.total && v) pg.rect(bx, by, Math.max(3, bw * v / S.total), 10, { fill: col, r: 2 });
      pg.text(`${v}  (${S.total ? (v / S.total * 100).toFixed(1) : '0.0'}%)`, M + CW, by + 9, { size: 9, bold: true, color: ink, align: 'right' }); });
    y += 124;
    const tiles = [['Requests made', String(S.total)], ['Average speed', S.avg.toFixed(0) + ' ms'], ['Slowest 5% took', S.p95.toFixed(0) + ' ms'], ['Requests per second', S.thr.toFixed(1)]], tw4 = (CW - 30) / 4;
    tiles.forEach(([l, v], i) => { const x = M + i * (tw4 + 10); pg.rect(x, y, tw4, 48, { stroke: rule, r: 6 }); pg.text(l, x + 10, y + 16, { size: 8, color: muted }); pg.text(v, x + 10, y + 37, { size: 15, bold: true, color: navy }); });
    y += 48 + 26;

    h2('3  What we tested');
    const think = cfg.thinkMax > cfg.think ? `${cfg.think}-${cfg.thinkMax} ms (random)` : `${cfg.think || 0} ms`;
    const kv = [['Test name', S.name], ['Website', targets.join(', ') || '-'], ['Run date', when], ['Visitors at once', String(S.threads)], ['Time to reach full load', cfg.rampUp + ' s'],
      ['Test length', cfg.mode === 'loops' ? `${cfg.loops} rounds per visitor` : `${cfg.duration} s (actual ${S.secs.toFixed(0)} s)`], ['Pause between pages', think], ['Cookies', cfg.cookies ? 'Sent' : 'Not sent']];
    kv.forEach(([k, v], i) => { ensure(20); if (i % 2 === 0) pg.rect(M, y - 12, CW, 18, { fill: '#f8fafc' }); pg.text(k, M + 8, y, { size: 9, bold: true, color: navy }); pg.text(v, M + 150, y, { size: 9, color: ink, maxW: CW - 160 }); y += 18; });
    y += 14;

    if (chart) {
      const ch = CW * chart.h / chart.w; ensure(ch + 60); h2('4  How the load behaved over time');
      pg.rect(M - 1, y - 1, CW + 2, ch + 2, { stroke: rule }); pg.image(M, y, CW, ch); y += ch + 14;
      pg.text('Blue line: how long pages took on average, in milliseconds. Purple bars: requests handled per second. Red bars: errors per second.', M, y, { size: 8, color: muted }); y += 26;
    }

    const endpoint = r => (r.url ? (r.method || 'GET') + '  ' + r.url : '');
    const P = (S.pctls && S.pctls.length) ? S.pctls.slice(0, 4) : [90, 95];
    const pctW = Math.floor((CW - 346 - 46) / P.length);
    const cols = [['Request / endpoint', 196, 'left'], ['Samples', 42, 'right'], ['Avg ms', 40, 'right'], ['Min', 34, 'right'], ['Max', 34, 'right']]
      .concat(P.map(p => ['P' + p, pctW, 'right']))
      .concat([['Err %', CW - 346 - pctW * P.length, 'right']]);
    const errK = cols.length - 1;
    const head = () => { ensure(24); pg.rect(M, y - 12, CW, 19, { fill: navy }); let x = M; cols.forEach(([l, w, al]) => { pg.text(l, al === 'right' ? x + w - 8 : x + 8, y + 2, { size: 8.5, bold: true, color: '#ffffff', align: al }); x += w; }); y += 20; };
    ensure(110); h2('5  Detailed results (for engineers)');
    writeLines('Every endpoint that was called is listed below. Endpoint = the HTTP method and full URL. Samples = how many requests were sent to it. Avg / Min / Max = response time in milliseconds. Each Pxx column is the time that xx% of its requests finished within. Err % = the share of its requests that failed.', 6);
    head();
    S.rows.forEach((r, i) => { if (y + 27 > 790) { newPage(false); head(); }
      if (i % 2 === 0) pg.rect(M, y - 13, CW, 27, { fill: '#f8fafc' });
      const vals = [r.name, String(r.n), r.n ? r.avg.toFixed(0) : '-', r.n ? r.min.toFixed(0) : '-', r.n ? r.max.toFixed(0) : '-']
        .concat(P.map((_, k) => (r.n && r.pcts && r.pcts[k] != null) ? r.pcts[k].toFixed(0) : '-'))
        .concat([r.n ? r.err.toFixed(1) : '-']);
      let x = M; cols.forEach(([, w, al], k) => { pg.text(vals[k], al === 'right' ? x + w - 8 : x + 8, y, { size: 8.5, color: k === errK && r.err > 0 ? '#dc2626' : ink, align: al, maxW: w - 14 }); x += w; });
      const ep = endpoint(r); if (ep) pg.text(ep, M + 8, y + 11, { size: 7.5, color: muted, maxW: cols[0][1] - 14 });
      y += 27; });

    pages.forEach((p, i) => { if (!i) return; p.rect(M, 806, CW, 0.8, { fill: rule }); p.text('ConfixHub  |  PerfPilot performance test report', M, 824, { size: 8, color: muted }); p.text(`Page ${i + 1} of ${pages.length}`, M + CW, 824, { size: 8, color: muted, align: 'right' }); });
    return serialize(pages, chart);
  }
  root.buildPdf = buildPdf; if (typeof module !== 'undefined') module.exports = { buildPdf };
})(typeof window !== 'undefined' ? window : globalThis);
