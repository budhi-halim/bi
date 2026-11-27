#!/usr/bin/env node
// Fetch the published transaction rates themselves; never reconstruct them from JISDOR.
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const BI_URL = 'https://www.bi.go.id/biwebservice/wskursbi.asmx/getSubKursLokal3';
export const SOURCE_URL = 'https://www.bi.go.id/id/statistik/informasi-kurs/transaksi-bi/Default.aspx';
export const HISTORY_START = '2013-01-01';
const FILE = new URL('../docs/data/bi.json', import.meta.url);
const DAY = 86400000;

export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function validRow(row) {
  return Array.isArray(row) && row.length === 3 && validDate(row[0]) &&
    typeof row[1] === 'number' && typeof row[2] === 'number' &&
    Number.isFinite(row[1]) && Number.isFinite(row[2]) && row[1] >= row[2] && row[2] > 0;
}
export function todayInJakarta(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const part = key => parts.find(item => item.type === key).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function addDays(date, days) {
  if (!validDate(date)) throw new Error(`Invalid date: ${date}`);
  return new Date(new Date(`${date}T12:00:00Z`).getTime() + days * DAY).toISOString().slice(0, 10);
}
function decimal(value, label) {
  if (typeof value !== 'string' || !/^[+]?\d+(?:\.\d+)?$/.test(value)) throw new Error(`Invalid numeric ${label} in BI response`);
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`Invalid ${label} in BI response`);
  return number;
}

export function parseBiXml(xml, { start, end } = {}) {
  if (typeof xml !== 'string' || !/<(?:\w+:)?DataSet\b/i.test(xml) ||
      !/<\/(?:\w+:)?DataSet\s*>/i.test(xml) || /<!DOCTYPE|<!ENTITY|<(?:\w+:)?Fault\b/i.test(xml)) {
    throw new Error('BI returned an invalid or incomplete XML DataSet');
  }
  const tables = [...xml.matchAll(/<(?:\w+:)?Table\b[^>]*>([\s\S]*?)<\/(?:\w+:)?Table\s*>/gi)];
  const openCount = [...xml.matchAll(/<(?:\w+:)?Table\b[^>]*>/gi)].length;
  if (openCount !== tables.length) throw new Error('BI returned an incomplete observation');
  const byDate = new Map();
  for (const match of tables) {
    const field = name => match[1].match(new RegExp(`<(?:\\w+:)?${name}\\b[^>]*>([^<]*)<\\/(?:\\w+:)?${name}\\s*>`, 'i'))?.[1].trim();
    const currency = field('mts_subkurslokal');
    if (currency !== 'USD') throw new Error(`Unexpected currency in USD response: ${currency || 'missing'}`);
    const unit = decimal(field('nil_subkurslokal'), 'currency unit');
    if (unit !== 1) throw new Error(`Expected USD nominal unit 1, received ${unit}`);
    const published = field('tgl_subkurslokal');
    if (!published || !/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(published)) throw new Error('Missing or invalid BI observation date');
    // Keep the WIB publication date: converting midnight +07:00 to UTC would change its day.
    const date = published.slice(0, 10);
    const row = [date, decimal(field('jual_subkurslokal'), 'selling rate'), decimal(field('beli_subkurslokal'), 'buying rate')];
    if (!validRow(row)) throw new Error(`Invalid BI observation on ${date}`);
    if ((start && date < start) || (end && date > end)) throw new Error(`BI returned ${date} outside the requested interval`);
    const duplicate = byDate.get(date);
    if (duplicate && (duplicate[1] !== row[1] || duplicate[2] !== row[2])) throw new Error(`Conflicting BI observations on ${date}`);
    byDate.set(date, row);
  }
  return [...byDate.values()].sort((a, b) => a[0].localeCompare(b[0]));
}

export function mergeRows(existing, incoming) {
  if (![...existing, ...incoming].every(validRow)) throw new Error('Cannot merge invalid observations');
  const byDate = new Map();
  for (const row of existing) {
    if (byDate.has(row[0])) throw new Error(`Stored data contains duplicate date ${row[0]}`);
    byDate.set(row[0], [...row]);
  }
  let added = 0, revised = 0;
  for (const row of incoming) {
    const previous = byDate.get(row[0]);
    if (!previous) added++;
    else if (previous[1] !== row[1] || previous[2] !== row[2]) revised++;
    byDate.set(row[0], [...row]);
  }
  return { rows: [...byDate.values()].sort((a, b) => a[0].localeCompare(b[0])), added, revised };
}
export function annualWindows(start, end) {
  if (!validDate(start) || !validDate(end) || start > end) throw new Error('Invalid history interval');
  const result = [];
  for (let cursor = start; cursor <= end;) {
    const yearEnd = `${cursor.slice(0, 4)}-12-31`;
    const last = yearEnd < end ? yearEnd : end;
    result.push({ start: cursor, end: last });
    cursor = addDays(last, 1);
  }
  return result;
}
export function missingWindows(start, end, completed = []) {
  const ranges = completed.filter(item => validDate(item.start) && validDate(item.end) && item.start <= item.end)
    .sort((a, b) => a.start.localeCompare(b.start));
  const missing = [];
  let cursor = start;
  for (const range of ranges) {
    if (range.end < cursor || range.start > end) continue;
    if (range.start > cursor) missing.push(...annualWindows(cursor, addDays(range.start, -1)));
    if (range.end >= cursor) cursor = addDays(range.end, 1);
    if (cursor > end) break;
  }
  if (cursor <= end) missing.push(...annualWindows(cursor, end));
  return missing;
}
export function incrementalStart(rows, today) {
  const latest = rows.at(-1)?.[0];
  if (!latest) return HISTORY_START;
  const recent = addDays(today, -95);
  const catchUp = addDays(latest, -7);
  return [HISTORY_START, recent < catchUp ? recent : catchUp].sort().at(-1);
}

async function fetchText(url, options, fetchImpl) {
  const response = await fetchImpl(url, {
    ...options,
    headers: {
      'User-Agent': 'Mozilla/5.0 BITransactionDashboard/1.0',
      Accept: 'application/xml,text/xml;q=0.9,*/*;q=0.5',
      'Accept-Language': 'id-ID,id;q=0.9,en;q=0.8',
      ...options.headers,
    },
    signal: AbortSignal.timeout(25000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} from www.bi.go.id`);
  const text = await response.text();
  if (text.length > 15000000) throw new Error('BI response exceeded the expected size');
  return text;
}
export async function fetchWindow(window, fetchImpl = fetch) {
  const params = new URLSearchParams({ mts: 'USD', startdate: window.start, enddate: window.end });
  const errors = [];
  // Both protocols are documented by BI. One fallback avoids hammering an unavailable service.
  for (const method of ['POST', 'GET']) {
    try {
      const url = method === 'GET' ? `${BI_URL}?${params}` : BI_URL;
      const options = method === 'POST'
        ? { method, body: params, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        : { method };
      const rows = parseBiXml(await fetchText(url, options, fetchImpl), window);
      const days = (new Date(window.end) - new Date(window.start)) / DAY + 1;
      if (!rows.length && days > 14) throw new Error('BI returned no observations for a historical interval');
      // Detect a visibly truncated year without assuming which individual weekdays were holidays.
      if (days > 62 && (!rows.length || rows[0][0] > addDays(window.start, 31) || rows.at(-1)[0] < addDays(window.end, -31))) {
        throw new Error('BI response does not span the requested historical interval');
      }
      return rows;
    } catch (error) { errors.push(`${method}: ${error.message}`); }
  }
  throw new Error(errors.join('; '));
}

async function save(file, data) {
  await fs.mkdir(new URL('.', file), { recursive: true });
  const temporary = new URL(`${file.href}.tmp`);
  await fs.writeFile(temporary, JSON.stringify(data) + '\n');
  await fs.rename(temporary, file);
}
export async function run({ file = FILE, now = new Date(), fetchImpl = fetch, logger = console } = {}) {
  let data;
  try { data = JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    data = { schema: 1, rows: [] };
  }
  if (data.schema !== 1 || !Array.isArray(data.rows) || !data.rows.every(validRow)) throw new Error('Stored BI transaction dataset failed validation; leaving it unchanged');
  const today = todayInJakarta(now);
  const timestamp = now.toISOString();
  if (data.rows.some(row => row[0] > today)) throw new Error('Stored dataset contains future observations');
  data.rows = mergeRows(data.rows, []).rows;
  const completed = Array.isArray(data.coverage?.completed_windows) ? data.coverage.completed_windows : [];
  const priorCoverageEnd = data.coverage?.requested_end;
  const wasComplete = Boolean(data.rows.length && (data.history_initialized === true ||
    (data.coverage?.complete && validDate(priorCoverageEnd) && missingWindows(HISTORY_START, priorCoverageEnd, completed).length === 0)));
  Object.assign(data, {
    pair: 'USD/IDR', currency: 'USD', unit: 1, source: 'Bank Indonesia',
    source_url: SOURCE_URL, api: BI_URL, last_attempt: timestamp,
    last_bi_sync: data.last_bi_sync || null, last_source: 'snapshot', last_error: null,
    history_initialized: wasComplete,
    coverage: { requested_start: HISTORY_START, requested_end: today, complete: false, completed_windows: completed },
  });
  const windows = wasComplete ? annualWindows(incrementalStart(data.rows, today), today) : missingWindows(HISTORY_START, today, completed);
  let added = 0, revised = 0, failure = null;
  for (const window of windows) {
    try {
      const incoming = await fetchWindow(window, fetchImpl);
      const merged = mergeRows(data.rows, incoming);
      data.rows = merged.rows; added += merged.added; revised += merged.revised;
      data.coverage.completed_windows = data.coverage.completed_windows.filter(item => item.start !== window.start || item.end !== window.end);
      data.coverage.completed_windows.push({ ...window, observations: incoming.length, fetched_at: timestamp });
      data.coverage.completed_windows.sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
      data.coverage.complete = data.rows.length > 0 && missingWindows(HISTORY_START, today, data.coverage.completed_windows).length === 0;
      if (data.coverage.complete) data.history_initialized = true;
      data.last_bi_sync = timestamp; data.last_source = 'BI';
      await save(file, data); // Checkpoint complete successful responses so bootstrap can resume.
      logger.log(`BI ${window.start} to ${window.end}: ${incoming.length} published observations.`);
    } catch (error) {
      failure = error;
      data.last_error = `Could not refresh ${window.start} to ${window.end}: ${error.message}`;
      data.last_source = 'snapshot';
      logger.warn(data.last_error);
      break;
    }
  }
  data.coverage.complete = data.rows.length > 0 && missingWindows(HISTORY_START, today, data.coverage.completed_windows).length === 0;
  if (data.coverage.complete) data.history_initialized = true;
  if (!windows.length && data.coverage.complete) data.last_source = 'BI';
  await save(file, data);
  logger.log(`BI transaction data: ${data.rows.length} observations; ${added} added, ${revised} revised; latest ${data.rows.at(-1)?.[0] || 'none'}.`);
  if (!data.rows.length || (!wasComplete && !data.coverage.complete)) {
    throw new Error(`Initial BI history is incomplete. Successful windows were saved for the next run.${failure ? ` ${failure.message}` : ''}`);
  }
  // Existing history remains available on outages; last_error exposes the refresh problem.
  return data;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch(error => { console.error(error.message); process.exitCode = 1; });
}
