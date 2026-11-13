'use strict';
// Builds the Chrome Web Store upload: dist/perfpilot-<version>.zip with manifest.json at the zip root.
// Only files the extension actually loads are included (found from manifest.json and panel.html),
// plus assets/ and LICENSE. No dependencies: the zip is written with Node's zlib.
// Usage: npm run pack
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.resolve(__dirname, '..');

function walk(dir) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap(e => {
    const rel = dir + '/' + e.name;
    return e.isDirectory() ? walk(rel) : [rel];
  });
}

// Every file the extension needs at runtime, as forward-slash paths relative to the project root.
function collectFiles(root = ROOT) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const files = new Set(['manifest.json']);
  const add = p => { if (p && !/^(https?:|data:|#)/.test(p)) files.add(p.replace(/^\.?\//, '')); };
  add(manifest.background && manifest.background.service_worker);
  Object.values(manifest.icons || {}).forEach(add);
  Object.values((manifest.action && manifest.action.default_icon) || {}).forEach(add);
  const pages = [manifest.side_panel && manifest.side_panel.default_path, manifest.action && manifest.action.default_popup].filter(Boolean);
  for (const page of pages) {
    add(page);
    const html = fs.readFileSync(path.join(root, page), 'utf8');
    for (const m of html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/g)) add(m[1]);
  }
  walk('assets').forEach(add);
  if (fs.existsSync(path.join(root, 'LICENSE'))) add('LICENSE');
  const missing = [...files].filter(f => !fs.existsSync(path.join(root, f)));
  if (missing.length) throw new Error('Referenced but missing: ' + missing.join(', '));
  return [...files].sort((a, b) => (a === 'manifest.json' ? -1 : b === 'manifest.json' ? 1 : a.localeCompare(b)));
}

const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc32(buf) { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; }

// Minimal ZIP writer (deflate, no zip64). entries: [{ name, data: Buffer }]
function buildZip(entries) {
  const locals = [], centrals = []; let offset = 0;
  const DOS_TIME = 0, DOS_DATE = (1 << 5) | 1; // 1980-01-01: fixed so builds are reproducible
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8'), comp = zlib.deflateRawSync(data, { level: 9 }), crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(DOS_TIME, 10); local.writeUInt16LE(DOS_DATE, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(8, 10);
    central.writeUInt16LE(DOS_TIME, 12); central.writeUInt16LE(DOS_DATE, 14); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comp.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, comp); centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

// Reads entry names back from a zip's central directory (used by the tests).
function listZip(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let p = buf.readUInt32LE(eocd + 16); const n = buf.readUInt16LE(eocd + 10), names = [];
  for (let i = 0; i < n; i++) {
    const len = buf.readUInt16LE(p + 28), extra = buf.readUInt16LE(p + 30), comment = buf.readUInt16LE(p + 32);
    names.push(buf.toString('utf8', p + 46, p + 46 + len)); p += 46 + len + extra + comment;
  }
  return names;
}

function pack(outDir = path.join(ROOT, 'dist')) {
  const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  const files = collectFiles();
  const zip = buildZip(files.map(name => ({ name, data: fs.readFileSync(path.join(ROOT, name)) })));
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `perfpilot-${version}.zip`);
  fs.writeFileSync(out, zip);
  return { out, files, bytes: zip.length };
}

if (require.main === module) {
  const { out, files, bytes } = pack();
  console.log(files.map(f => '  ' + f).join('\n'));
  console.log(`\nWrote ${path.relative(ROOT, out)} (${files.length} files, ${(bytes / 1024).toFixed(0)} KB). Upload this file to the Chrome Web Store.`);
  console.log('Remember: the store rejects a version it has already seen - bump "version" in manifest.json before each upload.');
}

module.exports = { collectFiles, buildZip, listZip, crc32, pack };
