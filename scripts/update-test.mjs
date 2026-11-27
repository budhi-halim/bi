import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { validDate, validRow, todayInJakarta, parseBiXml, mergeRows, annualWindows, missingWindows, incrementalStart, fetchWindow, run } from './update.mjs';

const table = ({ date = '2026-02-06', sell = '16910.13', buy = '16741.87', unit = '1.00', currency = 'USD  ' } = {}) => `<Table diffgr:id="Table1" msdata:rowOrder="0"><nil_subkurslokal>${unit}</nil_subkurslokal><beli_subkurslokal>${buy}</beli_subkurslokal><jual_subkurslokal>${sell}</jual_subkurslokal><tgl_subkurslokal>${date}T00:00:00+07:00</tgl_subkurslokal><mts_subkurslokal>${currency}</mts_subkurslokal></Table>`;
const xml = body => `<DataSet xmlns="http://tempuri.org/"><diffgr:diffgram><NewDataSet>${body}</NewDataSet></diffgr:diffgram></DataSet>`;
assert(validDate('2024-02-29'));
assert(!validDate('2026-02-29'));
assert(validRow(['2026-02-06', 16910.13, 16741.87]));
assert(!validRow(['2026-02-06', '16910.13', 16741.87]));
assert(!validRow(['2026-02-06', 16000, 17000]));
assert(!validRow(['2026-02-06', Infinity, 17000]));
assert.equal(todayInJakarta(new Date('2026-10-31T18:00:00Z')), '2026-11-01');
assert.deepEqual(parseBiXml(xml(table())), [['2026-02-06', 16910.13, 16741.87]]);
assert.equal((parseBiXml(xml(table()))[0][1] + parseBiXml(xml(table()))[0][2]) / 2, 16826);
for (const invalid of [table({ date: '2026-02-30' }), table({ unit: '100' }), table({ currency: 'EUR' }), table({ sell: '16.910,13' }), table({ sell: '16910.13oops' }), table({ buy: '19000' }), table({ buy: '' })]) {
  assert.throws(() => parseBiXml(xml(invalid)));
}
assert.throws(() => parseBiXml('<html>Service unavailable</html>'));
assert.throws(() => parseBiXml(xml(table()).replace('</Table>', '')));
assert.throws(() => parseBiXml(xml(table()), { start: '2026-03-01', end: '2026-03-31' }));
assert.throws(() => parseBiXml(xml(table() + table({ sell: '16920.13' }))));
assert.equal(parseBiXml(xml(table() + table())).length, 1);

const merged = mergeRows([['2026-02-06', 16910.13, 16741.87], ['2026-02-05', 16900.1, 16730.2]], [['2026-02-06', 16910.15, 16741.87], ['2026-02-09', 17000, 16800]]);
assert.equal(merged.added, 1);
assert.equal(merged.revised, 1);
assert.deepEqual(merged.rows.map(row => row[0]), ['2026-02-05', '2026-02-06', '2026-02-09']);
assert.equal(merged.rows[1][1], 16910.15);
assert.deepEqual(annualWindows('2025-12-30', '2026-01-02'), [{ start: '2025-12-30', end: '2025-12-31' }, { start: '2026-01-01', end: '2026-01-02' }]);
assert.deepEqual(missingWindows('2025-01-01', '2026-02-28', [{ start: '2025-01-01', end: '2025-12-31' }, { start: '2026-02-01', end: '2026-02-28' }]), [{ start: '2026-01-01', end: '2026-01-31' }]);
assert.equal(incrementalStart([['2026-02-06', 16910.13, 16741.87]], '2026-11-27'), '2026-01-30');

const attempts = [];
const response = body => ({ ok: true, text: async () => body });
const fallbackRows = await fetchWindow({ start: '2026-02-06', end: '2026-02-06' }, async (url, options) => {
  attempts.push([String(url), options]);
  if (options.method === 'POST') return { ok: false, status: 503 };
  return response(xml(table()));
});
assert.equal(attempts.length, 2);
assert.equal(attempts[0][1].body.get('startdate'), '2026-02-06');
assert.equal(attempts[0][1].body.has('startDate'), false);
assert(attempts[1][0].includes('enddate=2026-02-06'));
assert.deepEqual(fallbackRows, [['2026-02-06', 16910.13, 16741.87]]);
await assert.rejects(fetchWindow({ start: '2026-01-01', end: '2026-11-27' }, async () => response(xml(table()))), /does not span/);

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bi-update-test-'));
const file = pathToFileURL(path.join(directory, 'bi.json'));
const quiet = { log() {}, warn() {} };
try {
  const prior = {
    schema: 1, rows: [['2026-11-26', 18481.95, 18298.05]], last_bi_sync: '2026-11-26T03:00:00.000Z',
    coverage: { requested_end: '2026-11-26', complete: true, completed_windows: [{ start: '2013-01-01', end: '2026-11-26', observations: 1, fetched_at: '2026-11-26T03:00:00.000Z' }] },
  };
  await fs.writeFile(file, JSON.stringify(prior));
  const retained = await run({ file, now: new Date('2026-11-27T03:00:00Z'), fetchImpl: async () => { throw new Error('Network unavailable'); }, logger: quiet });
  assert.deepEqual(retained.rows, prior.rows);
  assert.equal(retained.last_bi_sync, prior.last_bi_sync);
  assert.equal(retained.last_source, 'snapshot');
  assert.match(retained.last_error, /Network unavailable/);
  assert.equal(retained.last_attempt, '2026-11-27T03:00:00.000Z');
  const retainedAgain = await run({ file, now: new Date('2026-11-28T03:00:00Z'), fetchImpl: async () => { throw new Error('Still unavailable'); }, logger: quiet });
  assert.deepEqual(retainedAgain.rows, prior.rows);
  assert.equal(retainedAgain.history_initialized, true);
  prior.coverage.complete = false;
  prior.coverage.requested_end = '2026-11-27';
  prior.coverage.completed_windows = [{ start: '2013-01-01', end: '2026-11-26', observations: 1 }];
  await fs.writeFile(file, JSON.stringify(prior));
  const called = [];
  const resumed = await run({ file, now: new Date('2026-11-27T03:00:00Z'), fetchImpl: async (url, options) => {
    called.push(options.body.get('startdate'));
    return response(xml(table({ date: '2026-11-27', sell: '18500.25', buy: '18315.75' })));
  }, logger: quiet });
  assert.deepEqual(called, ['2026-11-27']);
  assert.equal(resumed.rows.length, 2);
  assert.equal(resumed.coverage.complete, true);
  assert.equal(resumed.last_error, null);
  await fs.unlink(file);
  await assert.rejects(run({ file, now: new Date('2026-11-27T03:00:00Z'), fetchImpl: async () => { throw new Error('Unavailable'); }, logger: quiet }), /Initial BI history is incomplete/);
  const failedBootstrap = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(failedBootstrap.rows.length, 0);
  assert.equal(failedBootstrap.coverage.complete, false);
  assert(failedBootstrap.last_error);
} finally { await fs.rm(directory, { recursive: true, force: true }); }
console.log('BI ingestion checks passed: XML validation, WIB dates, numeric precision, corrections, bounded fallback, coverage/resume, and outage preservation.');
