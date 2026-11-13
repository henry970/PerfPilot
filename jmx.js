// Builds an Apache JMeter .jmx file from a PerfPilot plan (pure function).
function buildJmx(plan) {
  const x = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const lines = t => String(t || '').split('\n').map(l => l.trim()).filter(Boolean);
  const vars = lines(plan.vars).map(l => { const i = l.indexOf('='); return i > 0 ? [l.slice(0, i).trim(), l.slice(i + 1).trim()] : null; }).filter(Boolean);
  // PerfPilot built-ins -> the equivalent JMeter functions, so exported plans run as written.
  const JM_FN = { '__random': '${__Random(1,1000000,)}', '__uuid': '${__UUID()}', '__timestamp': '${__time()}', '__userId': '${__threadNum}', '__loop': '${__counter(FALSE,)}' };
  const jm = s => String(s ?? '')
    .replace(/\$\{__urlencode:([^}]+)\}/g, (m, n) => '${__urlencode(' + n + ')}')
    .replace(/\$\{(__random|__uuid|__timestamp|__userId|__loop)\}/g, (m, k) => JM_FN[k]);
  const varXml = vars.map(([k, v]) => `<elementProp name="${x(k)}" elementType="Argument"><stringProp name="Argument.name">${x(k)}</stringProp><stringProp name="Argument.value">${x(jm(v))}</stringProp><stringProp name="Argument.metadata">=</stringProp></elementProp>`).join('');
  // One "name = kind:arg" rule -> a JMeter post-processor (JSON or Regular Expression extractor).
  const ruleParts = line => { const i = String(line).indexOf('='); if (i < 1) return null;
    const name = String(line).slice(0, i).trim(); if (!name) return null;
    const spec = String(line).slice(i + 1).trim(), j = spec.indexOf(':');
    return { name, kind: (j < 0 ? spec : spec.slice(0, j)).trim().toLowerCase() || 'auto', arg: j < 0 ? '' : spec.slice(j + 1).trim() }; };
  const esc = r => r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const postProc = extract => String(extract || '').split('\n').map(ruleParts).filter(Boolean).map(r => {
    const nm = x(r.name);
    if (r.kind === 'json') {
      const p = !r.arg ? '$' : (r.arg.startsWith('$') ? r.arg : '$.' + r.arg);
      return `<JSONPostProcessor guiclass="JSONPostProcessorGui" testclass="JSONPostProcessor" testname="Extract ${nm}" enabled="true"><stringProp name="JSONPostProcessor.referenceNames">${nm}</stringProp><stringProp name="JSONPostProcessor.jsonPathExprs">${x(p)}</stringProp><stringProp name="JSONPostProcessor.match_numbers">1</stringProp></JSONPostProcessor><hashTree/>`;
    }
    let re, hdr = 'false';
    if (r.kind === 'regex') re = r.arg;
    else if (r.kind === 'header') { hdr = 'true'; re = '(?i)' + esc(r.arg) + ':\\s*(.+?)\\r?\\n'; }
    else if (r.kind === 'cookie') { hdr = 'true'; re = '(?i)Set-Cookie:\\s*' + esc(r.arg) + '=([^;]+)'; }
    else re = 'eyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+';   // 'auto' -> JWT
    if (!re) return '';
    return `<RegexExtractor guiclass="RegexExtractorGui" testclass="RegexExtractor" testname="Extract ${nm}" enabled="true"><stringProp name="RegexExtractor.useHeaders">${hdr}</stringProp><stringProp name="RegexExtractor.refname">${nm}</stringProp><stringProp name="RegexExtractor.regex">${x(re)}</stringProp><stringProp name="RegexExtractor.template">$1$</stringProp><stringProp name="RegexExtractor.default"></stringProp><stringProp name="RegexExtractor.match_number">1</stringProp></RegexExtractor><hashTree/>`;
  }).join('');
  const safeName = n => (String(n || 'plan').replace(/[^\w-]+/g, '_') || 'plan');
  const loops = plan.mode === 'loops' ? plan.loops : -1;
  const timer = plan.thinkMax > plan.think
    ? `<UniformRandomTimer guiclass="UniformRandomTimerGui" testclass="UniformRandomTimer" testname="Think time" enabled="true"><stringProp name="ConstantTimer.delay">${plan.think}</stringProp><stringProp name="RandomTimer.range">${plan.thinkMax - plan.think}</stringProp></UniformRandomTimer><hashTree/>`
    : plan.think > 0 ? `<ConstantTimer guiclass="ConstantTimerGui" testclass="ConstantTimer" testname="Think time" enabled="true"><stringProp name="ConstantTimer.delay">${plan.think}</stringProp></ConstantTimer><hashTree/>` : '';
  const assertion = (name, field, type, val, i) => `<ResponseAssertion guiclass="AssertionGui" testclass="ResponseAssertion" testname="${x(name)}" enabled="true"><collectionProp name="Asserion.test_strings"><stringProp name="${1000 + i}">${x(jm(val))}</stringProp></collectionProp><stringProp name="Assertion.custom_message"></stringProp><stringProp name="Assertion.test_field">${field}</stringProp><boolProp name="Assertion.assume_success">false</boolProp><intProp name="Assertion.test_type">${type}</intProp></ResponseAssertion><hashTree/>`;
  const samplers = plan.requests.map((r, i) => {
    let u; try { u = new URL(r.url); } catch { u = { hostname: '', port: '', protocol: 'http:', pathname: r.url, search: '' }; }
    const hasBody = !['GET', 'HEAD'].includes(r.method) && r.body;
    const args = hasBody
      ? `<elementProp name="HTTPsampler.Arguments" elementType="Arguments" guiclass="HTTPArgumentsPanel" testclass="Arguments" testname="User Defined Variables" enabled="true"><collectionProp name="Arguments.arguments"><elementProp name="" elementType="HTTPArgument"><boolProp name="HTTPArgument.always_encode">false</boolProp><stringProp name="Argument.value">${x(jm(r.body))}</stringProp><stringProp name="Argument.metadata">=</stringProp></elementProp></collectionProp></elementProp>`
      : `<elementProp name="HTTPsampler.Arguments" elementType="Arguments" guiclass="HTTPArgumentsPanel" testclass="Arguments" testname="User Defined Variables" enabled="true"><collectionProp name="Arguments.arguments"/></elementProp>`;
    const hdrs = lines(r.headers).map(l => { const k = l.indexOf(':'); return k > 0 ? `<elementProp name="" elementType="Header"><stringProp name="Header.name">${x(jm(l.slice(0, k).trim()))}</stringProp><stringProp name="Header.value">${x(jm(l.slice(k + 1).trim()))}</stringProp></elementProp>` : ''; }).join('');
    const pp = postProc(r.extract);
    const kids = [
      hdrs ? `<HeaderManager guiclass="HeaderPanel" testclass="HeaderManager" testname="HTTP Header Manager" enabled="true"><collectionProp name="HeaderManager.headers">${hdrs}</collectionProp></HeaderManager><hashTree/>` : '',
      r.status && r.status.trim() ? assertion('Status code', 'Assertion.response_code', 8, r.status.trim(), i) : '',
      r.contains ? assertion('Response contains', 'Assertion.response_data', 2, r.contains, i + 500) : '',
      r.maxMs ? `<DurationAssertion guiclass="DurationAssertionGui" testclass="DurationAssertion" testname="Max response time" enabled="true"><stringProp name="DurationAssertion.duration">${x(r.maxMs)}</stringProp></DurationAssertion><hashTree/>` : '',
      pp
    ].join('');
    return `<HTTPSamplerProxy guiclass="HttpTestSampleGui" testclass="HTTPSamplerProxy" testname="${x(jm(r.name))}" enabled="true">${args}<stringProp name="HTTPSampler.domain">${x(jm(u.hostname))}</stringProp><stringProp name="HTTPSampler.port">${x(jm(u.port))}</stringProp><stringProp name="HTTPSampler.protocol">${x(u.protocol.replace(':', ''))}</stringProp><stringProp name="HTTPSampler.path">${x(jm(u.pathname + u.search))}</stringProp><stringProp name="HTTPSampler.method">${x(r.method)}</stringProp><boolProp name="HTTPSampler.follow_redirects">true</boolProp><boolProp name="HTTPSampler.auto_redirects">false</boolProp><boolProp name="HTTPSampler.use_keepalive">true</boolProp>${hasBody ? '<boolProp name="HTTPSampler.postBodyRaw">true</boolProp>' : ''}</HTTPSamplerProxy><hashTree>${kids}</hashTree>`;
  }).join('');
  // Configuration elements (cookies, CSV data) and a results listener, so JMeter collects output too.
  const fileName = safeName(plan.name);
  const csvLines = lines(plan.data), csvHeader = csvLines.length > 1 ? csvLines[0] : '';
  const csvSet = csvHeader ? `<CSVDataSet guiclass="TestBeanGUI" testclass="CSVDataSet" testname="Test data" enabled="true"><stringProp name="filename">${x(fileName)}.csv</stringProp><stringProp name="fileEncoding"></stringProp><stringProp name="delimiter">,</stringProp><boolProp name="quotedData">false</boolProp><boolProp name="recycle">true</boolProp><boolProp name="stopThread">false</boolProp><stringProp name="shareMode">shareMode.all</stringProp><stringProp name="variableNames">${x(csvHeader)}</stringProp><boolProp name="ignoreFirstLine">true</boolProp></CSVDataSet><hashTree/>` : '';
  const cookieMgr = plan.cookies ? `<CookieManager guiclass="CookiePanel" testclass="CookieManager" testname="HTTP Cookie Manager" enabled="true"><collectionProp name="CookieManager.cookies"/><boolProp name="CookieManager.clearEachIteration">false</boolProp><boolProp name="CookieManager.controlledByThreadGroup">false</boolProp></CookieManager><hashTree/>` : '';
  const results = `<ResultCollector guiclass="SimpleDataWriter" testclass="ResultCollector" testname="PerfPilot results" enabled="true"><boolProp name="ResultCollector.error_logging">false</boolProp><stringProp name="filename">${x(fileName)}.jtl</stringProp></ResultCollector><hashTree/>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<jmeterTestPlan version="1.2" properties="5.0" jmeter="5.6.3"><hashTree>
<TestPlan guiclass="TestPlanGui" testclass="TestPlan" testname="${x(plan.name)}" enabled="true"><boolProp name="TestPlan.functional_mode">false</boolProp><boolProp name="TestPlan.serialize_threadgroups">false</boolProp><boolProp name="TestPlan.tearDown_on_shutdown">true</boolProp><elementProp name="TestPlan.user_defined_variables" elementType="Arguments" guiclass="ArgumentsPanel" testclass="Arguments" testname="User Defined Variables" enabled="true"><collectionProp name="Arguments.arguments">${varXml}</collectionProp></elementProp></TestPlan>
<hashTree><ThreadGroup guiclass="ThreadGroupGui" testclass="ThreadGroup" testname="Thread Group" enabled="true"><stringProp name="ThreadGroup.on_sample_error">continue</stringProp><elementProp name="ThreadGroup.main_controller" elementType="LoopController" guiclass="LoopControlPanel" testclass="LoopController" testname="Loop Controller" enabled="true"><boolProp name="LoopController.continue_forever">false</boolProp><stringProp name="LoopController.loops">${loops}</stringProp></elementProp><stringProp name="ThreadGroup.num_threads">${plan.threads}</stringProp><stringProp name="ThreadGroup.ramp_time">${plan.rampUp}</stringProp><boolProp name="ThreadGroup.scheduler">${plan.mode === 'duration'}</boolProp><stringProp name="ThreadGroup.duration">${plan.mode === 'duration' ? plan.duration : ''}</stringProp><stringProp name="ThreadGroup.delay"></stringProp></ThreadGroup>
<hashTree>${csvSet}${cookieMgr}${samplers}${timer}${results}</hashTree></hashTree></hashTree></jmeterTestPlan>
`;
}
// ---- .jmx import: a tiny, dependency-free XML reader + a JMeter -> plan mapper ----
const XML_ENTS = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
function xmlUnesc(s) {
  return String(s).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, g) => {
    if (g[0] === '#') { const n = /^#x/i.test(g) ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
    return XML_ENTS[g] ?? m;
  });
}
function xmlAttrs(s) {
  const o = {}, re = /([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g; let m;
  while ((m = re.exec(s))) o[m[1]] = xmlUnesc(m[2] !== undefined ? m[2] : m[3]);
  return o;
}
function parseXml(src) {
  const root = { name: '#doc', attrs: {}, children: [], text: '' }, stack = [root];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!DOCTYPE[^>]*>|<\/([A-Za-z_][\w.:-]*)\s*>|<([A-Za-z_][\w.:-]*)((?:\s+[A-Za-z_][\w.:-]*\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  let last = 0, m;
  while ((m = re.exec(src))) {
    if (m.index > last) { const t = src.slice(last, m.index); if (t.trim()) stack[stack.length - 1].text += xmlUnesc(t); }
    last = re.lastIndex; const tok = m[0];
    if (m[1] !== undefined) { if (stack.length > 1) stack[stack.length - 1].text += m[1]; continue; }
    if (m[2] !== undefined) { if (stack.length > 1) stack.pop(); continue; }
    if (tok.startsWith('<!') || tok.startsWith('<?')) continue;
    const node = { name: m[3], attrs: xmlAttrs(m[4] || ''), children: [], text: '' };
    stack[stack.length - 1].children.push(node);
    if (!m[5]) stack.push(node);
  }
  return root;
}
const PROPS = ['stringProp', 'boolProp', 'intProp'];
function firstEl(node, name, pred) { for (const c of node.children) if (c.name === name && (!pred || pred(c))) return c; return null; }
function allEls(node, name) { return node.children.filter(c => c.name === name); }
function deepEl(node, name) { if (node.name === name) return node; for (const c of node.children) { const r = deepEl(c, name); if (r) return r; } return null; }
function prop(node, name) { if (!node) return ''; const c = node.children.find(x => PROPS.includes(x.name) && x.attrs.name === name); return c ? c.text.trim() : ''; }
function deepProp(node, name) { if (!node) return ''; const d = prop(node, name); if (d !== '') return d; for (const c of node.children) { const v = deepProp(c, name); if (v !== '') return v; } return ''; }
function childPairs(tree) { const out = []; if (!tree) return out; const ch = tree.children;
  for (let i = 0; i < ch.length; i++) { const n = ch[i]; if (n.name === 'hashTree') continue; const sub = ch[i + 1] && ch[i + 1].name === 'hashTree' ? ch[i + 1] : null; out.push({ node: n, sub }); if (sub) i++; } return out; }
const toNum = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
// JMeter functions -> PerfPilot built-ins (the inverse of the export mapping), for round-tripping.
const JM_BACK = [
  [/\$\{__urlencode\(([^)}]+)\)\}/g, '${__urlencode:$1}'],
  [/\$\{__threadNum\}/g, '${__userId}'],
  [/\$\{__Random\(1,1000000,\)\}/g, '${__random}'],
  [/\$\{__UUID\(\)\}/g, '${__uuid}'],
  [/\$\{__time\(\)\}/g, '${__timestamp}'],
  [/\$\{__counter\(FALSE,\)\}/g, '${__loop}']
];
const jmBack = s => JM_BACK.reduce((t, [re, rep]) => t.replace(re, rep), String(s ?? ''));

// Reads an Apache JMeter .jmx string back into a PerfPilot plan (pure function).
function parseJmx(xml) {
  const doc = parseXml(xml);
  const out = { name: 'Imported plan', threads: 10, rampUp: 5, think: 0, thinkMax: 0, cookies: true, mode: 'duration', loops: 10, duration: 30, vars: '', data: '', requests: [] };
  const tp = deepEl(doc, 'TestPlan');
  if (tp && tp.attrs.testname) out.name = tp.attrs.testname;
  const udv = tp && firstEl(tp, 'elementProp', e => e.attrs.name === 'TestPlan.user_defined_variables');
  const ucol = udv && firstEl(udv, 'collectionProp');
  if (ucol) out.vars = allEls(ucol, 'elementProp').map(e => { const k = prop(e, 'Argument.name'); return k ? `${k}=${jmBack(prop(e, 'Argument.value'))}` : null; }).filter(Boolean).join('\n');
  const planPair = childPairs(deepEl(doc, 'hashTree')).find(p => p.node.name === 'TestPlan');
  const tgPair = planPair && planPair.sub ? childPairs(planPair.sub).find(p => p.node.name === 'ThreadGroup') : null;
  const tg = tgPair && tgPair.node, pairs = childPairs(tgPair && tgPair.sub);
  if (tg) {
    out.threads = Math.max(1, Math.round(toNum(prop(tg, 'ThreadGroup.num_threads'), 10)));
    out.rampUp = Math.max(0, toNum(prop(tg, 'ThreadGroup.ramp_time'), 0));
    out.duration = Math.max(1, toNum(prop(tg, 'ThreadGroup.duration'), 30));
    const sched = /^true$/i.test(prop(tg, 'ThreadGroup.scheduler')), loops = toNum(deepProp(tg, 'LoopController.loops'), NaN);
    if (sched || !(loops > 0)) out.mode = 'duration'; else { out.mode = 'loops'; out.loops = Math.max(1, Math.round(loops)); }
  }
  const nodes = pairs.map(p => p.node);
  const ut = nodes.find(n => n.name === 'UniformRandomTimer'), ct = ut || nodes.find(n => n.name === 'ConstantTimer');
  if (ct) { const d = Math.max(0, toNum(prop(ct, 'ConstantTimer.delay'), 0)); out.think = d; out.thinkMax = ut ? d + Math.max(0, toNum(prop(ut, 'RandomTimer.range'), 0)) : d; }
  out.requests = pairs.filter(p => p.node.name === 'HTTPSamplerProxy').map(({ node: s, sub }, i) => {
    const method = (prop(s, 'HTTPSampler.method') || 'GET').toUpperCase();
    const proto = prop(s, 'HTTPSampler.protocol') || 'http', domain = prop(s, 'HTTPSampler.domain'), port = prop(s, 'HTTPSampler.port');
    let path = prop(s, 'HTTPSampler.path') || '/';
    const argsEl = firstEl(s, 'elementProp', e => e.attrs.name === 'HTTPsampler.Arguments');
    const aCol = argsEl && firstEl(argsEl, 'collectionProp');
    const aItems = aCol ? allEls(aCol, 'elementProp') : [];
    let body = '';
    if (/^true$/i.test(prop(s, 'HTTPSampler.postBodyRaw'))) { body = aItems.length ? prop(aItems[0], 'Argument.value') : ''; }
    else { const qs = aItems.map(a => { const n = prop(a, 'Argument.name'); return n ? `${n}=${prop(a, 'Argument.value')}` : null; }).filter(Boolean); if (qs.length) path += (path.includes('?') ? '&' : '?') + qs.join('&'); }
    const url = domain ? `${proto}://${domain}${port ? ':' + port : ''}${path}` : path;
    const hm = sub && firstEl(sub, 'HeaderManager'), hc = hm && firstEl(hm, 'collectionProp');
    const headers = hc ? allEls(hc, 'elementProp').map(e => { const n = prop(e, 'Header.name'); return n ? `${n}: ${prop(e, 'Header.value')}` : null; }).filter(Boolean).join('\n') : '';
    let status = '', contains = '', maxMs = '', extract = '';
    if (sub) {
      for (const ra of allEls(sub, 'ResponseAssertion')) {
        const field = prop(ra, 'Assertion.test_field'), col = firstEl(ra, 'collectionProp');
        const vals = col ? allEls(col, 'stringProp').map(x => x.text.trim()) : [];
        if (field === 'Assertion.response_code' && !status) status = vals[0] || '';
        else if (field === 'Assertion.response_data' && !contains) contains = vals[0] || '';
      }
      const da = firstEl(sub, 'DurationAssertion'); if (da) maxMs = prop(da, 'DurationAssertion.duration');
      const rules = [];
      for (const jp of allEls(sub, 'JSONPostProcessor')) {
        const rn = prop(jp, 'JSONPostProcessor.referenceNames'), jx = prop(jp, 'JSONPostProcessor.jsonPathExprs');
        if (rn && jx) rules.push(`${rn} = json:${jx.replace(/^\$\.?/, '')}`);
      }
      for (const rx of allEls(sub, 'RegexExtractor')) {
        const rn = prop(rx, 'RegexExtractor.refname'), rg = prop(rx, 'RegexExtractor.regex');
        if (rn && rg && !/^true$/i.test(prop(rx, 'RegexExtractor.useHeaders'))) rules.push(`${rn} = regex:${rg}`);
      }
      extract = rules.join('\n');
    }
    return { name: jmBack(s.attrs.testname || `Request ${i + 1}`), method, url: jmBack(url), headers: jmBack(headers), body: jmBack(body), status, contains, maxMs, extract };
  });
  return out;
}
if (typeof module !== 'undefined') module.exports = { buildJmx, parseJmx };
