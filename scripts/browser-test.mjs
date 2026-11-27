#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { chromium } from 'playwright';

// CI-only integration tests. Local visual review uses the managed preview browser.
const output = path.resolve('qa-results');
await fs.mkdir(output, { recursive: true });
const root = path.resolve('docs');
const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const filename = path.resolve(root, '.' + (pathname.endsWith('/') ? pathname + 'index.html' : pathname));
    if (!filename.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
    const content = await fs.readFile(filename);
    const type = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml' }[path.extname(filename)] || 'application/octet-stream';
    response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    response.end(content);
  } catch { response.writeHead(404).end('Not found'); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(4173, '127.0.0.1', resolve); });
const report = { generated_at: new Date().toISOString(), checks: [], failures: [] };
const check = async (name, operation) => {
  try { const result = await operation(); report.checks.push({ name, result: result ?? 'pass' }); console.log('PASS:', name, result ?? ''); }
  catch (error) { report.failures.push({ name, message: error.message }); console.error('FAIL:', name, error.message); }
};
const format = new Intl.NumberFormat('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
const field = name => parts.find(p => p.type === name).value;
const today = `${field('year')}-${field('month')}-${field('day')}`;
const current = today.slice(0, 7);
const shift = (month, offset) => { const d = new Date(month + '-01T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() + offset); return d.toISOString().slice(0, 7); };
const previous = shift(current, -1);
const categories = ['Sell', 'Buy', 'Mid'];
const means = rows => rows.length ? [
  rows.reduce((sum, row) => sum + row[1], 0) / rows.length,
  rows.reduce((sum, row) => sum + row[2], 0) / rows.length,
  rows.reduce((sum, row) => sum + (row[1] + row[2]) / 2, 0) / rows.length,
] : [NaN, NaN, NaN];
const formatted = value => Number.isFinite(value) ? format.format(value) : '—';
async function ready(page) {
  await page.locator('#latestMid').waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForFunction(() => {
    const value = document.querySelector('#latestMid')?.textContent;
    return value && value !== '—' && document.querySelector('#loadingBanner')?.classList.contains('hidden');
  }, null, { timeout: 30000 });
}
async function chartSettled(page) {
  await page.waitForFunction(() => {
    const svg = document.querySelector('#trendChart');
    return svg && Math.abs(Number(svg.getAttribute('viewBox')?.split(/\s+/)[2]) - Math.max(240, svg.clientWidth)) < 1.1;
  }, null, { timeout: 5000 });
}
async function setRange(page, from, to) {
  await page.locator('#fromMonth').fill(from);
  await page.locator('#fromMonth').dispatchEvent('change');
  await page.locator('#toMonth').fill(to);
  await page.locator('#toMonth').dispatchEvent('change');
  await chartSettled(page);
}
async function assertAverages(page, rows) {
  const expected = means(rows);
  for (let i = 0; i < categories.length; i++) assert.equal(await page.locator('#avg' + categories[i]).innerText(), formatted(expected[i]));
  return { observations: rows.length, sell: expected[0], buy: expected[1], mid: expected[2] };
}
function zipEntries(bytes) {
  const entries = new Map(); let cursor = 0;
  while (cursor + 30 < bytes.length && bytes.readUInt32LE(cursor) === 0x04034b50) {
    const flags = bytes.readUInt16LE(cursor + 6), method = bytes.readUInt16LE(cursor + 8);
    assert.equal(flags & 8, 0, 'Expected explicit entry lengths');
    const length = bytes.readUInt32LE(cursor + 18), nameLength = bytes.readUInt16LE(cursor + 26), extraLength = bytes.readUInt16LE(cursor + 28);
    const name = bytes.subarray(cursor + 30, cursor + 30 + nameLength).toString('utf8');
    const start = cursor + 30 + nameLength + extraLength;
    const content = bytes.subarray(start, start + length);
    assert.ok(method === 0 || method === 8, 'Supported ZIP compression');
    entries.set(name, (method === 8 ? inflateRawSync(content) : content).toString('utf8'));
    cursor = start + length;
  }
  return entries;
}
function inspectWorkbook(bytes, count) {
  assert.equal(bytes.readUInt32LE(0), 0x04034b50);
  const entries = zipEntries(bytes);
  const book = entries.get('xl/workbook.xml');
  for (const name of ['Summary', 'Daily Rates', 'Monthly Averages']) assert.ok(book?.includes(`name="${name}"`));
  const daily = entries.get('xl/worksheets/sheet2.xml');
  assert.ok(daily, 'Daily sheet exists');
  const rows = [...daily.matchAll(/<row\b[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)].filter(row => Number(row[1]) > 1);
  assert.equal(rows.length, count);
  for (const [, rowNumber, xml] of rows) {
    const values = {};
    for (const column of ['A', 'B', 'C', 'D']) {
      const cell = xml.match(new RegExp(`<c\\b([^>]*\\br="${column}${rowNumber}"[^>]*)>([\\s\\S]*?)<\\/c>`));
      assert.ok(cell, `Cell ${column}${rowNumber} exists`);
      assert.ok(!/\bt="(?:inlineStr|s|str)"/.test(cell[1]), `Cell ${column}${rowNumber} is numeric`);
      const value = cell[2].match(/<v>([^<]+)<\/v>/);
      assert.ok(value && Number.isFinite(Number(value[1])), 'Numeric cached value');
      values[column] = Number(value[1]);
      if (column === 'A') assert.match(cell[1], /\bs="2"/, 'Real Excel date formatting');
      if (column === 'D') assert.match(cell[2], /<f>AVERAGE\(B\d+:C\d+\)<\/f>/, 'Middle is a recalculating Excel formula');
    }
    assert.ok(Math.abs(values.D - (values.B + values.C) / 2) < 1e-8, 'Cached middle matches selling and buying');
    assert.ok(values.A > 40000 && values.A < 100000, 'Date stored as Excel serial');
  }
  return { dailyRows: rows.length, numericRateCells: rows.length * 3, realDateCells: rows.length };
}

let browser;
try {
  const data = JSON.parse(await fs.readFile('docs/data/bi.json', 'utf8'));
  const published = data.rows.filter(row => row[0] <= today);
  assert.ok(published.length, 'A real BI snapshot is required');
  report.latest = published.at(-1);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Jakarta', acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });
  await ready(page);
  await chartSettled(page);
  await check('Latest publication shows distinct selling, buying and calculated middle rates', async () => {
    const last = published.at(-1);
    const expected = [last[1], last[2], (last[1] + last[2]) / 2];
    for (let i = 0; i < categories.length; i++) assert.equal(await page.locator('#latest' + categories[i]).innerText(), format.format(expected[i]));
    assert.equal(await page.locator('#rateTable tr').first().locator('td').count(), 4);
    return { date: last[0], sell: expected[0], buy: expected[1], mid: expected[2] };
  });
  await check('Both month selectors default to the previous Jakarta month', async () => {
    assert.equal(await page.locator('#fromMonth').inputValue(), previous);
    assert.equal(await page.locator('#toMonth').inputValue(), previous);
    assert.equal(await page.locator('#periodWarning').isVisible(), false);
  });
  await check('Single-month summary and monthly breakdown show all three correct averages', async () => {
    const rows = published.filter(row => row[0].startsWith(previous));
    const result = await assertAverages(page, rows);
    const monthly = page.locator('#monthList .month-row');
    assert.equal(await monthly.count(), 1);
    for (let i = 0; i < categories.length; i++) assert.equal(await monthly.locator('.month-' + categories[i].toLowerCase()).innerText(), formatted(means(rows)[i]));
    return { month: previous, ...result };
  });
  for (const [label, width, height] of [['desktop', 1440, 1000], ['tablet', 768, 1024], ['mobile', 393, 873], ['small-mobile', 320, 740], ['landscape', 873, 393]]) {
    await page.setViewportSize({ width, height });
    await chartSettled(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await check(label + ': no horizontal overflow and all rate summaries remain visible', async () => {
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Document overflows the viewport');
      for (const id of ['latestSell', 'latestBuy', 'latestMid', 'avgSell', 'avgBuy', 'avgMid']) {
        assert.ok(await page.locator('#' + id).isVisible(), id + ' visible');
        assert.ok(await page.locator('#' + id).evaluate(el => el.scrollWidth <= el.clientWidth + 1), id + ' does not clip its value');
      }
      await page.screenshot({ path: path.join(output, label + '.png'), fullPage: true });
      return { width, height };
    });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await chartSettled(page);
  await check('Chart draws three series and its keyboard tooltip reports all three values', async () => {
    for (const key of ['sell', 'buy', 'mid']) assert.equal(await page.locator(`#trendChart path[data-series="${key}"]`).count(), 1);
    const target = page.locator('#trendChart rect[role="slider"]');
    await target.focus();
    await target.press('End');
    assert.equal(await page.locator('#chartTooltip').isVisible(), true);
    const tooltip = await page.locator('#chartTooltip').innerText();
    for (const label of ['Selling', 'Buying', 'Middle']) assert.ok(tooltip.includes(label));
    assert.equal(await page.locator('#chartTooltip b').count(), 3);
    assert.ok(await page.locator('#chartTooltip b').evaluateAll(elements => elements.every(el => el.namespaceURI === 'http://www.w3.org/1999/xhtml')));
    const last = published.at(-1);
    for (const value of [last[1], last[2], (last[1] + last[2]) / 2]) assert.ok(tooltip.includes(format.format(value)));
    const lastIndex = Number(await target.getAttribute('aria-valuenow'));
    await target.press('ArrowLeft');
    assert.equal(Number(await target.getAttribute('aria-valuenow')), Math.max(1, lastIndex - 1));
  });
  await page.locator('[data-preset="current"]').click();
  await check('Current-month warning persists and all three provisional averages match published dates', async () => {
    assert.ok(await page.locator('#periodWarning').isVisible());
    assert.match(await page.locator('#periodWarningDetail').innerText(), /not complete/i);
    return assertAverages(page, published.filter(row => row[0].startsWith(current)));
  });
  const multiFrom = shift(current, -3);
  await setRange(page, multiFrom, previous);
  const multiRows = published.filter(row => row[0].slice(0, 7) >= multiFrom && row[0].slice(0, 7) <= previous);
  await check('Multi-month summary pools published days and each month exposes all three averages', async () => {
    assert.equal(await page.locator('#periodWarning').isVisible(), false);
    const result = await assertAverages(page, multiRows);
    assert.equal(await page.locator('#monthList .month-row').count(), 3);
    for (let i = 0; i < 3; i++) {
      const month = shift(previous, -i), rows = multiRows.filter(row => row[0].startsWith(month));
      const group = page.locator('#monthList .month-row').nth(i);
      for (let k = 0; k < categories.length; k++) assert.equal(await group.locator('.month-' + categories[k].toLowerCase()).innerText(), formatted(means(rows)[k]));
    }
    return { from: multiFrom, to: previous, ...result };
  });
  await check('Real Excel download has numeric selling, buying and middle cells, formulas and Excel dates', async () => {
    assert.ok(multiRows.length > 0, 'The selected historical months have observations');
    const pending = page.waitForEvent('download');
    await page.locator('#exportButton').click();
    const download = await pending;
    assert.match(download.suggestedFilename(), /\.xlsx$/);
    const filename = path.join(output, download.suggestedFilename());
    await download.saveAs(filename);
    const bytes = await fs.readFile(filename);
    return { file: download.suggestedFilename(), bytes: bytes.length, ...inspectWorkbook(bytes, multiRows.length) };
  });
  await setRange(page, current, previous);
  await check('Invalid ranges clear all three summaries, monthly breakdown and table; both exports disable', async () => {
    assert.ok(await page.locator('#rangeError').isVisible());
    for (const id of ['exportButton', 'tableExportButton']) assert.ok(await page.locator('#' + id).isDisabled());
    for (const key of categories) assert.equal(await page.locator('#avg' + key).innerText(), '—');
    assert.equal(await page.locator('#monthList .month-row').count(), 0);
    assert.match(await page.locator('#rateTable').innerText(), /valid month range/i);
    assert.equal(await page.locator('#periodWarning').isVisible(), false);
  });
  await page.locator('[data-preset="previous"]').click();
  await check('Date sorting, daily categories and pagination stay aligned', async () => {
    const previousRows = published.filter(row => row[0].startsWith(previous));
    assert.ok(previousRows.length > 1);
    assert.equal(await page.locator('#rateTable time').first().getAttribute('datetime'), previousRows.at(-1)[0]);
    await page.locator('#sortDateButton').click();
    assert.equal(await page.locator('#rateTable time').first().getAttribute('datetime'), previousRows[0][0]);
    const cells = await page.locator('#rateTable tr').first().locator('td').allTextContents();
    const row = previousRows[0];
    assert.deepEqual(cells.slice(1), [format.format(row[1]), format.format(row[2]), format.format((row[1] + row[2]) / 2)]);
    if (previousRows.length > 15) {
      await page.locator('#nextPage').click();
      assert.equal(await page.locator('#rateTable time').first().getAttribute('datetime'), previousRows[15][0]);
      await page.locator('#prevPage').click();
      assert.equal(await page.locator('#rateTable time').first().getAttribute('datetime'), previousRows[0][0]);
    }
  });
  await check('A selected month without observations shows unavailable values and disables both exports', async () => {
    const emptyContext = await browser.newContext({ viewport: { width: 393, height: 873 }, timezoneId: 'Asia/Jakarta' });
    try {
      const emptyPage = await emptyContext.newPage();
      // A small synthetic transport fixture exercises the real empty-period UI only.
      await emptyPage.route('**/data/bi.json?*', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({
        ...data, rows: [[shift(previous, -2) + '-01', 18000, 17000]],
      }) }));
      await emptyPage.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });
      await ready(emptyPage);
      for (const key of categories) assert.equal(await emptyPage.locator('#avg' + key).innerText(), '—');
      for (const id of ['exportButton', 'tableExportButton']) assert.ok(await emptyPage.locator('#' + id).isDisabled());
      assert.ok(await emptyPage.locator('#missingWarning').isVisible());
      assert.match(await emptyPage.locator('#rateTable').innerText(), /No published rates/);
    } finally { await emptyContext.close(); }
  });
  await check('No uncaught browser JavaScript errors', async () => assert.deepEqual(errors, []));
  await context.close();

  if (process.env.LIVE_URL) {
    await check('Public GitHub Pages serves the working three-rate dashboard', async () => {
      const live = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Jakarta' });
      try {
        const tab = await live.newPage();
        const url = new URL(process.env.LIVE_URL); url.searchParams.set('qa', String(Date.now()));
        const response = await tab.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 60000 });
        assert.equal(response.status(), 200);
        await ready(tab);
        await chartSettled(tab);
        for (const category of categories) assert.notEqual(await tab.locator('#latest' + category).innerText(), '—');
        assert.equal(await tab.locator('#fromMonth').inputValue(), previous);
        assert.equal(await tab.locator('#toMonth').inputValue(), previous);
        assert.equal(await tab.locator('#errorBanner').isVisible(), false);
        await tab.screenshot({ path: path.join(output, 'live-desktop.png'), fullPage: true });
        const result = { url: tab.url(), sell: await tab.locator('#latestSell').innerText(), buy: await tab.locator('#latestBuy').innerText(), mid: await tab.locator('#latestMid').innerText(), date: await tab.locator('#latestDate').innerText() };
        report.live = result;
        return result;
      } finally { await live.close(); }
    });
  }
} catch (error) {
  report.failures.push({ name: 'Browser test setup or interaction', message: error.stack || error.message });
  console.error(error);
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
if (report.failures.length) process.exitCode = 1;
