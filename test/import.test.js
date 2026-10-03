'use strict';
// Unit tests for the .jmx importer + export/import round-trip. Run with: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildJmx, parseJmx } = require('../jmx.js');

function req(over = {}) {
  return Object.assign({ name: 'Home', method: 'GET', url: 'https://example.com/path?a=1', headers: '', body: '', status: '', contains: '', maxMs: '', extract: '' }, over);
}
function plan(over = {}) {
  return Object.assign({ name: 'My plan', threads: 10, rampUp: 5, think: 0, thinkMax: 0, mode: 'duration', loops: 10, duration: 30, vars: '', data: '', cookies: true, requests: [req()] }, over);
}

// A hand-written file shaped like real Apache JMeter output (query args + assertions).
const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<jmeterTestPlan version="1.2" properties="5.0" jmeter="5.6.3">
  <hashTree>
    <TestPlan guiclass="TestPlanGui" testclass="TestPlan" testname="Demo &amp; Co" enabled="true">
      <boolProp name="TestPlan.functional_mode">false</boolProp>
      <elementProp name="TestPlan.user_defined_variables" elementType="Arguments" guiclass="ArgumentsPanel" testclass="Arguments" testname="User Defined Variables" enabled="true">
        <collectionProp name="Arguments.arguments">
          <elementProp name="host" elementType="Argument"><stringProp name="Argument.name">host</stringProp><stringProp name="Argument.value">https://api.example.com</stringProp><stringProp name="Argument.metadata">=</stringProp></elementProp>
        </collectionProp>
      </elementProp>
    </TestPlan>
    <hashTree>
      <ThreadGroup guiclass="ThreadGroupGui" testclass="ThreadGroup" testname="Thread Group" enabled="true">
        <stringProp name="ThreadGroup.on_sample_error">continue</stringProp>
        <elementProp name="ThreadGroup.main_controller" elementType="LoopController" guiclass="LoopControlPanel" testclass="LoopController" testname="Loop Controller" enabled="true">
          <boolProp name="LoopController.continue_forever">false</boolProp>
          <stringProp name="LoopController.loops">25</stringProp>
        </elementProp>
        <stringProp name="ThreadGroup.num_threads">7</stringProp>
        <stringProp name="ThreadGroup.ramp_time">15</stringProp>
        <boolProp name="ThreadGroup.scheduler">false</boolProp>
        <stringProp name="ThreadGroup.duration"></stringProp>
      </ThreadGroup>
      <hashTree>
        <HTTPSamplerProxy guiclass="HttpTestSampleGui" testclass="HTTPSamplerProxy" testname="Get products" enabled="true">
          <elementProp name="HTTPsampler.Arguments" elementType="Arguments" guiclass="HTTPArgumentsPanel" testclass="Arguments" testname="User Defined Variables" enabled="true">
            <collectionProp name="Arguments.arguments">
              <elementProp name="page" elementType="HTTPArgument"><stringProp name="Argument.name">page</stringProp><stringProp name="Argument.value">2</stringProp></elementProp>
            </collectionProp>
          </elementProp>
          <stringProp name="HTTPSampler.domain">api.example.com</stringProp>
          <stringProp name="HTTPSampler.port">8443</stringProp>
          <stringProp name="HTTPSampler.protocol">https</stringProp>
          <stringProp name="HTTPSampler.path">/v1/products</stringProp>
          <stringProp name="HTTPSampler.method">GET</stringProp>
        </HTTPSamplerProxy>
        <hashTree>
          <HeaderManager guiclass="HeaderPanel" testclass="HeaderManager" testname="HTTP Header Manager" enabled="true">
            <collectionProp name="HeaderManager.headers">
              <elementProp name="" elementType="Header"><stringProp name="Header.name">Accept</stringProp><stringProp name="Header.value">application/json</stringProp></elementProp>
            </collectionProp>
          </HeaderManager>
          <hashTree/>
          <ResponseAssertion guiclass="AssertionGui" testclass="ResponseAssertion" testname="Status code" enabled="true">
            <collectionProp name="Asserion.test_strings"><stringProp name="1000">200</stringProp></collectionProp>
            <stringProp name="Assertion.custom_message"></stringProp>
            <stringProp name="Assertion.test_field">Assertion.response_code</stringProp>
            <boolProp name="Assertion.assume_success">false</boolProp>
            <intProp name="Assertion.test_type">8</intProp>
          </ResponseAssertion>
          <hashTree/>
        </hashTree>
        <ConstantTimer guiclass="ConstantTimerGui" testclass="ConstantTimer" testname="Think time" enabled="true">
          <stringProp name="ConstantTimer.delay">750</stringProp>
        </ConstantTimer>
        <hashTree/>
      </hashTree>
    </hashTree>
  </hashTree>
</jmeterTestPlan>`;

test('parses a JMeter-authored file: plan, threads, variables', () => {
  const p = parseJmx(SAMPLE);
  assert.equal(p.name, 'Demo & Co');
  assert.equal(p.threads, 7);
  assert.equal(p.rampUp, 15);
  assert.equal(p.vars, 'host=https://api.example.com');
  assert.equal(p.mode, 'loops');
  assert.equal(p.loops, 25);
});

test('parses the think-time timer', () => {
  const p = parseJmx(SAMPLE);
  assert.equal(p.think, 750);
  assert.equal(p.thinkMax, 750);
});

test('reconstructs a sampler url from domain, port, protocol, path and query args', () => {
  const p = parseJmx(SAMPLE);
  assert.equal(p.requests.length, 1);
  const r = p.requests[0];
  assert.equal(r.name, 'Get products');
  assert.equal(r.method, 'GET');
  assert.equal(r.url, 'https://api.example.com:8443/v1/products?page=2');
  assert.equal(r.headers, 'Accept: application/json');
  assert.equal(r.status, '200');
});

test('round-trips a plan through export and import', () => {
  const p = plan({
    name: 'RT', threads: 4, rampUp: 3, think: 200, thinkMax: 600, mode: 'loops', loops: 5, duration: 30,
    vars: 'host=https://api.example.com\ntoken=abc',
    requests: [
      req({ name: 'A', headers: 'X-A: 1\nAccept: */*', status: '200', contains: 'ok', maxMs: '1500' }),
      req({ name: 'B', method: 'POST', url: 'https://api.example.com/v1/x', body: '{"k":1}', status: '201' })
    ]
  });
  const back = parseJmx(buildJmx(p));
  assert.equal(back.name, 'RT');
  assert.equal(back.threads, 4);
  assert.equal(back.rampUp, 3);
  assert.equal(back.think, 200);
  assert.equal(back.thinkMax, 600);
  assert.equal(back.mode, 'loops');
  assert.equal(back.loops, 5);
  assert.equal(back.vars, 'host=https://api.example.com\ntoken=abc');
  assert.equal(back.requests.length, 2);
  assert.deepEqual(back.requests[0], { name: 'A', method: 'GET', url: 'https://example.com/path?a=1', headers: 'X-A: 1\nAccept: */*', body: '', status: '200', contains: 'ok', maxMs: '1500', extract: '' });
  assert.equal(back.requests[1].method, 'POST');
  assert.equal(back.requests[1].url, 'https://api.example.com/v1/x');
  assert.equal(back.requests[1].body, '{"k":1}');
  assert.equal(back.requests[1].status, '201');
});

test('round-trips duration mode', () => {
  const back = parseJmx(buildJmx(plan({ mode: 'duration', duration: 45 })));
  assert.equal(back.mode, 'duration');
  assert.equal(back.duration, 45);
});

test('round-trips a uniform random think timer back to think/thinkMax', () => {
  const back = parseJmx(buildJmx(plan({ think: 100, thinkMax: 400 })));
  assert.equal(back.think, 100);
  assert.equal(back.thinkMax, 400);
});

test('returns an empty request list when there are no samplers', () => {
  const back = parseJmx(buildJmx(plan({ requests: [] })));
  assert.equal(back.requests.length, 0);
});

test('round-trips XML entities in text', () => {
  const back = parseJmx(buildJmx(plan({ name: 'A & B <c> "d"', requests: [req({ name: 'q&a', contains: '<hi> & "bye"' })] })));
  assert.equal(back.name, 'A & B <c> "d"');
  assert.equal(back.requests[0].name, 'q&a');
  assert.equal(back.requests[0].contains, '<hi> & "bye"');
});

test('round-trips a correlation extractor and built-in functions', () => {
  const back = parseJmx(buildJmx(plan({
    vars: 'u=${__userId}',
    requests: [
      req({ name: 'Login', method: 'POST', url: 'https://api.example.com/login', body: '{"u":"${__uuid}"}', extract: 'token = json:data.token' }),
      req({ name: 'Me', headers: 'Authorization: Bearer ${token}' })
    ]
  })));
  assert.equal(back.vars, 'u=${__userId}');
  assert.equal(back.requests[0].extract, 'token = json:data.token');
  assert.equal(back.requests[0].body, '{"u":"${__uuid}"}');
  assert.equal(back.requests[1].headers, 'Authorization: Bearer ${token}');
});