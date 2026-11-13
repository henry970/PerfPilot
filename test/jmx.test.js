'use strict';
// Unit tests for the pure .jmx builder (jmx.js). Run with: node --test test/
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildJmx } = require('../jmx.js');

function req(over = {}) {
  return Object.assign({ name: 'Home', method: 'GET', url: 'https://example.com/path?a=1', headers: '', body: '', status: '', contains: '', maxMs: '', extract: '' }, over);
}
function plan(over = {}) {
  return Object.assign({ name: 'My plan', threads: 10, rampUp: 5, think: 0, thinkMax: 0, mode: 'duration', loops: 10, duration: 30, vars: '', data: '', cookies: true, requests: [req()] }, over);
}

test('emits a JMeter 5.6 test plan envelope', () => {
  const xml = buildJmx(plan());
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.match(xml, /<jmeterTestPlan version="1.2"[^>]*jmeter="5\.6\.3">/);
  assert.match(xml, /<TestPlan [^>]*testname="My plan"/);
  assert.ok(xml.trimEnd().endsWith('</jmeterTestPlan>'));
  assert.equal((xml.match(/<hashTree>/g) || []).length, (xml.match(/<\/hashTree>/g) || []).length);
});

test('escapes XML metacharacters in names and urls', () => {
  const xml = buildJmx(plan({ name: 'A & B <c> "d"', requests: [req({ name: 'q&a', url: 'https://example.com/?a=1&b=2' })] }));
  assert.ok(xml.includes('testname="A &amp; B &lt;c&gt; &quot;d&quot;"'));
  assert.ok(xml.includes('testname="q&amp;a"'));
  assert.ok(xml.includes('HTTPSampler.path">/?a=1&amp;b=2</stringProp>'));
  assert.ok(!xml.includes('A & B'));
});

test('duration mode schedules on time with -1 loops', () => {
  const xml = buildJmx(plan({ mode: 'duration', duration: 45 }));
  assert.ok(xml.includes('<boolProp name="ThreadGroup.scheduler">true</boolProp>'));
  assert.ok(xml.includes('<stringProp name="LoopController.loops">-1</stringProp>'));
  assert.ok(xml.includes('<stringProp name="ThreadGroup.duration">45</stringProp>'));
});

test('loops mode sets the loop count and disables scheduling', () => {
  const xml = buildJmx(plan({ mode: 'loops', loops: 7 }));
  assert.ok(xml.includes('<boolProp name="ThreadGroup.scheduler">false</boolProp>'));
  assert.ok(xml.includes('<stringProp name="LoopController.loops">7</stringProp>'));
  assert.ok(xml.includes('<stringProp name="ThreadGroup.duration"></stringProp>'));
});

test('maps thread group numbers and each request to an HTTPSamplerProxy', () => {
  const xml = buildJmx(plan({ threads: 3, rampUp: 2, requests: [req({ name: 'One', url: 'https://api.example.com:8443/v1/items?q=x' })] }));
  assert.ok(xml.includes('<stringProp name="ThreadGroup.num_threads">3</stringProp>'));
  assert.ok(xml.includes('<stringProp name="ThreadGroup.ramp_time">2</stringProp>'));
  assert.ok(xml.includes('<HTTPSamplerProxy '));
  assert.ok(xml.includes('<stringProp name="HTTPSampler.domain">api.example.com</stringProp>'));
  assert.ok(xml.includes('<stringProp name="HTTPSampler.port">8443</stringProp>'));
  assert.ok(xml.includes('<stringProp name="HTTPSampler.protocol">https</stringProp>'));
  assert.ok(xml.includes('<stringProp name="HTTPSampler.path">/v1/items?q=x</stringProp>'));
  assert.ok(xml.includes('<stringProp name="HTTPSampler.method">GET</stringProp>'));
});

test('renders exactly one sampler per request', () => {
  const xml = buildJmx(plan({ requests: [req({ name: 'A' }), req({ name: 'B' }), req({ name: 'C' })] }));
  assert.equal((xml.match(/<HTTPSamplerProxy /g) || []).length, 3);
});

test('adds a HeaderManager only when headers are present', () => {
  const withHeaders = buildJmx(plan({ requests: [req({ headers: 'Accept: application/json\nX-Trace: yes' })] }));
  assert.ok(withHeaders.includes('<HeaderManager '));
  assert.ok(withHeaders.includes('<stringProp name="Header.name">Accept</stringProp>'));
  assert.ok(withHeaders.includes('<stringProp name="Header.value">application/json</stringProp>'));
  assert.ok(withHeaders.includes('<stringProp name="Header.name">X-Trace</stringProp>'));
  assert.ok(!buildJmx(plan()).includes('<HeaderManager'));
});

test('sends a raw body for non-GET requests only', () => {
  const post = buildJmx(plan({ requests: [req({ method: 'POST', body: '{"a":1}' })] }));
  assert.ok(post.includes('<boolProp name="HTTPSampler.postBodyRaw">true</boolProp>'));
  assert.ok(post.includes('<stringProp name="Argument.value">{&quot;a&quot;:1}</stringProp>'));
  const get = buildJmx(plan({ requests: [req({ method: 'GET', body: '{"a":1}' })] }));
  assert.ok(!get.includes('postBodyRaw'));
});

test('emits response code, response data and duration assertions', () => {
  const xml = buildJmx(plan({ requests: [req({ status: '201', contains: 'created', maxMs: '2000' })] }));
  assert.ok(xml.includes('<stringProp name="Assertion.test_field">Assertion.response_code</stringProp>'));
  assert.ok(xml.includes('<intProp name="Assertion.test_type">8</intProp>'));
  assert.ok(xml.includes('<stringProp name="1000">201</stringProp>'));
  assert.ok(xml.includes('<stringProp name="Assertion.test_field">Assertion.response_data</stringProp>'));
  assert.ok(xml.includes('<intProp name="Assertion.test_type">2</intProp>'));
  assert.ok(xml.includes('<stringProp name="1500">created</stringProp>'));
  assert.ok(xml.includes('<DurationAssertion '));
  assert.ok(xml.includes('<stringProp name="DurationAssertion.duration">2000</stringProp>'));
});

test('omits assertions for a bare request', () => {
  const xml = buildJmx(plan());
  assert.ok(!xml.includes('<ResponseAssertion'));
  assert.ok(!xml.includes('<DurationAssertion'));
  assert.ok(xml.includes('<collectionProp name="Arguments.arguments"/>'));
});

test('think time emits a constant timer', () => {
  const xml = buildJmx(plan({ think: 500, thinkMax: 0 }));
  assert.ok(xml.includes('<ConstantTimer '));
  assert.ok(xml.includes('<stringProp name="ConstantTimer.delay">500</stringProp>'));
  assert.ok(!xml.includes('<UniformRandomTimer'));
});

test('think time emits a uniform random timer when a range is set', () => {
  const xml = buildJmx(plan({ think: 100, thinkMax: 400 }));
  assert.ok(xml.includes('<UniformRandomTimer '));
  assert.ok(xml.includes('<stringProp name="RandomTimer.range">300</stringProp>'));
  assert.ok(xml.includes('<stringProp name="ConstantTimer.delay">100</stringProp>'));
});

test('emits no timer when think time is zero', () => {
  const xml = buildJmx(plan({ think: 0, thinkMax: 0 }));
  assert.ok(!xml.includes('<ConstantTimer'));
  assert.ok(!xml.includes('<UniformRandomTimer'));
});

test('declares user defined variables, ignoring malformed lines', () => {
  const xml = buildJmx(plan({ vars: 'host=https://api.example.com\ntoken=abc-123\nnonsense\n=blank' }));
  assert.ok(xml.includes('<stringProp name="Argument.name">host</stringProp>'));
  assert.ok(xml.includes('<stringProp name="Argument.value">https://api.example.com</stringProp>'));
  assert.ok(xml.includes('<stringProp name="Argument.name">token</stringProp>'));
  assert.ok(xml.includes('<stringProp name="Argument.value">abc-123</stringProp>'));
  assert.ok(!xml.includes('nonsense'));
});

test('falls back gracefully for a malformed URL', () => {
  const xml = buildJmx(plan({ requests: [req({ url: 'not a url' })] }));
  assert.ok(xml.includes('<stringProp name="HTTPSampler.domain"></stringProp>'));
  assert.ok(xml.includes('<stringProp name="HTTPSampler.protocol">http</stringProp>'));
  assert.ok(xml.includes('<stringProp name="HTTPSampler.path">not a url</stringProp>'));
});

test('exports a Cookie Manager only when cookies are enabled', () => {
  assert.ok(buildJmx(plan({ cookies: true })).includes('<CookieManager '));
  assert.ok(!buildJmx(plan({ cookies: false })).includes('<CookieManager'));
});

test('exports a results listener that writes a JTL file', () => {
  const xml = buildJmx(plan({ name: 'My plan' }));
  assert.ok(xml.includes('testclass="ResultCollector"'));
  assert.ok(xml.includes('<stringProp name="filename">My_plan.jtl</stringProp>'));
});

test('exports a CSV Data Set Config when test data is supplied', () => {
  const xml = buildJmx(plan({ data: 'user,password\nalice,pw1\nbob,pw2' }));
  assert.ok(xml.includes('<CSVDataSet '));
  assert.ok(xml.includes('<stringProp name="variableNames">user,password</stringProp>'));
  assert.ok(xml.includes('<boolProp name="ignoreFirstLine">true</boolProp>'));
  assert.ok(xml.includes('<stringProp name="shareMode">shareMode.all</stringProp>'));
  assert.ok(xml.includes('<stringProp name="filename">My_plan.csv</stringProp>'));
  assert.ok(!buildJmx(plan({ data: '' })).includes('<CSVDataSet'));
});

test('exports a JSON extractor as a JMeter JSON post-processor', () => {
  const xml = buildJmx(plan({ requests: [req({ extract: 'token = json:data.token' })] }));
  assert.ok(xml.includes('<JSONPostProcessor '));
  assert.ok(xml.includes('<stringProp name="JSONPostProcessor.referenceNames">token</stringProp>'));
  assert.ok(xml.includes('<stringProp name="JSONPostProcessor.jsonPathExprs">$.data.token</stringProp>'));
  assert.ok(!buildJmx(plan()).includes('<JSONPostProcessor'));
});

test('exports regex and header extractors as JMeter Regular Expression extractors', () => {
  const rx = buildJmx(plan({ requests: [req({ extract: 'csrf = regex:name="([^"]+)"' })] }));
  assert.ok(rx.includes('<RegexExtractor '));
  assert.ok(rx.includes('<stringProp name="RegexExtractor.refname">csrf</stringProp>'));
  assert.ok(rx.includes('<stringProp name="RegexExtractor.template">$1$</stringProp>'));
  assert.ok(rx.includes('<stringProp name="RegexExtractor.useHeaders">false</stringProp>'));
  const hd = buildJmx(plan({ requests: [req({ extract: 'auth = header:X-Auth-Token' })] }));
  assert.ok(hd.includes('<stringProp name="RegexExtractor.useHeaders">true</stringProp>'));
});

test('maps PerfPilot built-ins to equivalent JMeter functions', () => {
  const xml = buildJmx(plan({
    vars: 'u=${__userId}',
    requests: [req({ headers: 'X-A: ${__random}\nX-B: ${__uuid}\nX-C: ${__timestamp}\nX-D: ${__loop}\nX-E: ${__urlencode:token}' })]
  }));
  assert.ok(xml.includes('${__threadNum}'));
  assert.ok(xml.includes('${__Random(1,1000000,)}'));
  assert.ok(xml.includes('${__time()}'));
  assert.ok(xml.includes('${__UUID()}'));
  assert.ok(xml.includes('${__counter(FALSE,)}'));
  assert.ok(xml.includes('${__urlencode(token)}'));
  assert.ok(!xml.includes('${__userId}'));
});