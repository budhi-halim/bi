import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const sandbox = { window: {}, TextEncoder, Uint8Array, Uint32Array, DataView };
vm.runInNewContext(await fs.readFile(path.join(root, 'docs/xlsx.js'), 'utf8'), sandbox);
const { build } = sandbox.window.BiXlsx;

function unzipStored(bytes) {
  const buffer = Buffer.from(bytes);
  const files = new Map();
  let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    assert.equal(buffer.readUInt16LE(offset + 8), 0, 'Workbook uses supported ZIP stored entries');
    const size = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
    const dataOffset = offset + 30 + nameLength + extraLength;
    files.set(name, buffer.subarray(dataOffset, dataOffset + size).toString('utf8'));
    offset = dataOffset + size;
  }
  assert.equal(buffer.readUInt32LE(offset), 0x02014b50, 'ZIP central directory exists');
  return files;
}

function cell(xml, ref) {
  const match = xml.match(new RegExp(`<c r="${ref}"([^>]*)>([\\s\\S]*?)</c>`));
  assert.ok(match, `Cell ${ref} exists`);
  return { attributes: match[1], contents: match[2], value: Number(match[2].match(/<v>(.*?)<\/v>/)?.[1]) };
}
function close(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) < 1e-8, `${label}: ${actual} equals ${expected}`);
}
const input = {
  from: '2026-09', to: '2026-10', latest: '2026-11-27', incomplete: false,
  // Deliberately unsorted. The exporter must establish chronological references itself.
  daily: [
    { date: '2026-10-02', sell: 18200.30, buy: 18000.20, mid: 0 },
    { date: '2026-09-30', sell: 16000.01, buy: 15900.00, mid: 0 },
    { date: '2026-10-01', sell: 18000.20, buy: 17800.10, mid: 0 },
  ],
  averages: { sell: 0, buy: 0, mid: 0 }, monthly: [],
  source: 'Bank Indonesia',
  sourceUrl: 'https://www.bi.go.id/id/statistik/informasi-kurs/transaksi-bi/Default.aspx',
  lastSync: '2026-11-27T02:00:00.000Z',
};
const bytes = build(input);
const files = unzipStored(bytes);
assert.equal(files.size, 8, 'Three-sheet OOXML package contains its required parts');
const summary = files.get('xl/worksheets/sheet1.xml');
const daily = files.get('xl/worksheets/sheet2.xml');
const monthly = files.get('xl/worksheets/sheet3.xml');
assert.match(files.get('xl/workbook.xml'), /name="Summary".*name="Daily Rates".*name="Monthly Averages"/);
assert.match(files.get('xl/styles.xml'), /formatCode="#,##0\.00##"/);
assert.match(files.get('xl/styles.xml'), /formatCode="dd mmm yyyy"/);
assert.match(files.get('xl/styles.xml'), /formatCode="mmm yyyy"/);

for (const row of [2, 3, 4]) {
  const dateCell = cell(daily, `A${row}`);
  assert.match(dateCell.attributes, /t="n"/, 'Dates are numeric Excel serials');
  assert.match(dateCell.attributes, /s="2"/, 'Dates have date formatting');
  assert.ok(Number.isInteger(dateCell.value) && dateCell.value > 40000);
  for (const column of ['B', 'C', 'D']) assert.match(cell(daily, `${column}${row}`).attributes, /t="n"/, 'Rates and formula results are numeric');
  assert.match(cell(daily, `D${row}`).contents, new RegExp(`<f>AVERAGE\\(B${row}:C${row}\\)</f>`));
}
close(cell(daily, 'B2').value, 16000.01, 'Selling source precision');
close(cell(daily, 'C2').value, 15900, 'Buying source precision');
close(cell(daily, 'D2').value, 15950.005, 'Daily midpoint retains half-cent precision');

const expected = { B9: 17400.17, B10: 51700.30 / 3, B11: (15950.005 + 17900.15 + 18100.25) / 3 };
for (const [ref, value] of Object.entries(expected)) {
  close(cell(summary, ref).value, value, `Selected-period ${ref}`);
  assert.match(cell(summary, ref).attributes, /t="n"/);
}
assert.match(cell(summary, 'B9').contents, /AVERAGE\(&apos;Daily Rates&apos;!B2:B4\)/);
assert.match(cell(summary, 'B10').contents, /AVERAGE\(&apos;Daily Rates&apos;!C2:C4\)/);
assert.match(cell(summary, 'B11').contents, /AVERAGE\(&apos;Daily Rates&apos;!D2:D4\)/);
assert.match(cell(monthly, 'A2').attributes, /s="7" t="n"/, 'Month columns contain real dates');
close(cell(monthly, 'B2').value, 16000.01, 'September selling average');
close(cell(monthly, 'C3').value, 17900.15, 'October buying average');
close(cell(monthly, 'D3').value, 18000.20, 'October middle average');
assert.equal(cell(monthly, 'E2').value, 1);
assert.equal(cell(monthly, 'E3').value, 2);
assert.match(cell(monthly, 'B3').contents, /AVERAGE\(&apos;Daily Rates&apos;!B3:B4\)/);
assert.notEqual(cell(summary, 'B11').value, (cell(monthly, 'D2').value + cell(monthly, 'D3').value) / 2, 'Multi-month average weights individual days, not months');
assert.match(daily, /<autoFilter ref="A1:D4"\/>/);
assert.match(monthly, /<autoFilter ref="A1:F3"\/>/);
assert.match(daily, /ySplit="1".*state="frozen"/);

const missingMonth = unzipStored(build({ ...input, from: '2026-08' })).get('xl/worksheets/sheet3.xml');
assert.equal(cell(missingMonth, 'E2').value, 0);
assert.ok(!missingMonth.includes('<c r="B2"'), 'Missing monthly rates stay blank rather than becoming zero');
assert.match(missingMonth, /No observations/);
const partial = unzipStored(build({ ...input, incomplete: true }));
assert.match(partial.get('xl/worksheets/sheet1.xml'), /Current-month averages are provisional/);
assert.match(partial.get('xl/worksheets/sheet3.xml'), /In progress/);

assert.throws(() => build({ ...input, daily: [] }), /no published rates/i);
assert.throws(() => build({ ...input, from: '2026-13' }), /valid month range/i);
assert.throws(() => build({ ...input, from: '2026-11' }), /valid month range/i);
assert.throws(() => build({ ...input, daily: [...input.daily, input.daily[0]] }), /duplicate/i);
assert.throws(() => build({ ...input, daily: [{ date: '2026-09-31', sell: 18000, buy: 17000 }] }), /invalid.*dates/i);
assert.throws(() => build({ ...input, daily: [{ date: '2026-09-30', sell: '18000', buy: 17000 }] }), /invalid.*rate/i);
assert.throws(() => build({ ...input, daily: [{ date: '2026-09-30', sell: 17000, buy: 18000 }] }), /invalid.*rate/i);

const fixture = path.join(os.tmpdir(), 'bi-export-test.xlsx');
await fs.writeFile(fixture, bytes);
console.log('XLSX checks passed: all three rates, per-day midpoint, weighted multi-month means, formula caches, numeric types, real dates, missing months, and input validation.');
console.log(`Verification workbook: ${fixture}`);
