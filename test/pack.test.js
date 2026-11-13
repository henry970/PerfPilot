'use strict';
// Tests for the Chrome Web Store packager (scripts/pack.js). Run with: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { collectFiles, buildZip, listZip, crc32, pack } = require('../scripts/pack.js');

test('collectFiles puts manifest.json first and includes every runtime file', () => {
  const files = collectFiles();
  assert.equal(files[0], 'manifest.json');
  for (const f of ['background.js', 'panel.html', 'panel.js', 'style.css', 'importers.js', 'stats.js', 'icons/128.png', 'assets/report-cover.png'])
    assert.ok(files.includes(f), 'missing ' + f);
  assert.ok(!files.some(f => /^(test|scripts|\.git|\.vscode|dist)\//.test(f) || f === 'package.json'), 'dev files leaked: ' + files.join(','));
  assert.ok(files.every(f => !f.includes('\\')), 'paths must use forward slashes');
});

test('crc32 matches the standard check value', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
});

test('buildZip writes readable entries', () => {
  const zip = buildZip([{ name: 'manifest.json', data: Buffer.from('{"a":1}') }, { name: 'icons/x.txt', data: Buffer.from('hello hello hello') }]);
  assert.deepEqual(listZip(zip), ['manifest.json', 'icons/x.txt']);
  // First local header is manifest.json and its data inflates back.
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  const nameLen = zip.readUInt16LE(26), compLen = zip.readUInt32LE(18);
  assert.equal(zip.toString('utf8', 30, 30 + nameLen), 'manifest.json');
  assert.equal(zlib.inflateRawSync(zip.subarray(30 + nameLen, 30 + nameLen + compLen)).toString(), '{"a":1}');
});

test('pack writes a versioned zip with manifest.json at the root', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perfpilot-pack-'));
  try {
    const { out, files } = pack(dir);
    const { version } = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
    assert.equal(path.basename(out), `perfpilot-${version}.zip`);
    const names = listZip(fs.readFileSync(out));
    assert.deepEqual(names, files);
    assert.ok(names.includes('manifest.json'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
