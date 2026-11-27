#!/usr/bin/env node
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const calc = require('../docs/calculations.js');
const make = rows => ({ schema: 1, currency: 'USD', unit: 1, rows });
const nearly = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, message || `${actual} ≈ ${expected}`);
let checks = 0;
function check(name, run) { run(); checks++; console.log(`PASS: ${name}`); }

const rows = calc.normalize(make([
  ['2020-10-02', 20200, 19800],
  ['2020-09-30', 16200, 15800],
  ['2020-10-01', 17200, 16800],
]), '2020-10-31');
check('Selling and buying remain separate; daily middle is their arithmetic mean', () => {
  assert.deepEqual(rows.map(({ date, sell, buy, mid }) => ({ date, sell, buy, mid })), [
    { date: '2020-09-30', sell: 16200, buy: 15800, mid: 16000 },
    { date: '2020-10-01', sell: 17200, buy: 16800, mid: 17000 },
    { date: '2020-10-02', sell: 20200, buy: 19800, mid: 20000 },
  ]);
  assert.deepEqual(rows.map(row => row.delta), [null, 1000, 3000]);
  const [fractional] = calc.normalize(make([['2020-10-01', 100.02, 100.01]]));
  nearly(fractional.mid, 100.015, 'Do not round the middle rate before averaging');
});
check('Multi-month means weight every published day equally for all three categories', () => {
  const combined = calc.averages(rows);
  nearly(combined.sell, 17866.666666666668);
  nearly(combined.buy, 17466.666666666668);
  nearly(combined.mid, 17666.666666666668);
  nearly(combined.mid, (combined.sell + combined.buy) / 2);
  const months = calc.monthly(rows, '2020-09', '2020-10');
  assert.deepEqual(months, [
    { month: '2020-09', count: 1, sell: 16200, buy: 15800, mid: 16000 },
    { month: '2020-10', count: 2, sell: 18700, buy: 18300, mid: 18500 },
  ]);
  for (const key of ['sell', 'buy', 'mid']) {
    assert.notEqual(combined[key], (months[0][key] + months[1][key]) / 2, 'Unequal month counts must not receive equal weights');
    nearly(combined[key], (months[0][key] + months[1][key] * 2) / 3);
  }
});
check('Month selection includes both endpoints and does not fill non-publication days', () => {
  assert.equal(calc.select(rows, '2020-09', '2020-10').length, 3);
  assert.equal(calc.select(rows, '2020-10', '2020-10').length, 2);
  assert.deepEqual(calc.select(rows, '2020-11', '2020-11'), []);
  assert.deepEqual(calc.months('2020-12', '2021-02'), ['2020-12', '2021-01', '2021-02']);
  assert.deepEqual(calc.months('2020-13', '2021-02'), []);
  assert.deepEqual(calc.months('2021-02', '2021-01'), []);
  assert.equal(calc.monthShift('2021-01', -1), '2020-12');
});
check('Empty periods yield unavailable values instead of zero or fabricated rates', () => {
  for (const key of ['sell', 'buy', 'mid']) assert.ok(Number.isNaN(calc.averages([])[key]));
  const [month] = calc.monthly(rows, '2020-11', '2020-11');
  assert.equal(month.count, 0);
  for (const key of ['sell', 'buy', 'mid']) assert.ok(Number.isNaN(month[key]));
});
check('Data validation rejects text rates, invalid dates, duplicate dates and reversed spreads', () => {
  for (const bad of [
    ['2020-10-01', '18000', 17000], ['2020-10-01', 18000, '17000'],
    ['2020-10-01', NaN, 17000], ['2020-10-01', 18000, Infinity],
    ['2020-10-01', -1, -2], ['2020-10-01', 18000, 0],
    ['2020-10-01', 17000, 18000], ['2020-02-30', 18000, 17000],
    ['2019-02-29', 18000, 17000], ['2020-2-01', 18000, 17000],
    ['2020-10-01', 18000],
  ]) assert.throws(() => calc.normalize(make([bad])));
  assert.throws(() => calc.normalize(make([['2020-10-01', 18000, 17000], ['2020-10-01', 18000, 17000]])), /Duplicate/);
  assert.throws(() => calc.normalize(make([])), /No published/);
  assert.throws(() => calc.normalize({ ...make([['2020-10-01', 18000, 17000]]), currency: 'JPY' }));
  assert.throws(() => calc.normalize({ ...make([['2020-10-01', 18000, 17000]]), unit: 100 }));
  assert.ok(calc.validDate('2020-02-29'));
});
check('Future observations are excluded using the explicit Jakarta calendar date', () => {
  const filtered = calc.normalize(make([['2020-10-01', 18000, 17000], ['2020-10-02', 19000, 18000]]), '2020-10-01');
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].date, '2020-10-01');
});

let dataset;
try { dataset = JSON.parse(await fs.readFile(new URL('../docs/data/bi.json', import.meta.url), 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (dataset) {
  check('Stored official transaction history has valid, unique, chronological numeric rates and completed retrieval', () => {
    assert.equal(dataset.pair, 'USD/IDR');
    assert.equal(dataset.currency, 'USD');
    assert.equal(dataset.unit, 1);
    assert.equal(dataset.history_initialized, true, 'The historical bootstrap must finish before publication; later outages may retain that snapshot');
    assert.ok(dataset.rows.length > 0);
    const normalized = calc.normalize(dataset);
    assert.equal(normalized.length, dataset.rows.length);
    for (let i = 1; i < dataset.rows.length; i++) assert.ok(dataset.rows[i][0] > dataset.rows[i - 1][0], 'Stored dates must be strictly ascending');
    assert.match(dataset.api, /^https:\/\/www\.bi\.go\.id\/biwebservice\/wskursbi\.asmx\/getSubKursLokal3$/);
    console.log(`  ${dataset.rows.length} official observations, ${dataset.rows[0][0]} through ${dataset.rows.at(-1)[0]}`);
  });
} else console.log('NOTE: No local data snapshot yet; calculation tests completed. CI will validate the downloaded snapshot.');
console.log(`PASS: ${checks} calculation/data regression checks.`);
