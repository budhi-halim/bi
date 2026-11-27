/* Shared calculation rules for the dashboard and regression checks. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BiRates = api;
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  const keys = ['sell', 'buy', 'mid'];
  function validDate(date) {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
    const parsed = new Date(date + 'T12:00:00Z');
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
  }
  function normalize(input, today) {
    if (!input || input.schema !== 1 || input.currency !== 'USD' || input.unit !== 1 || !Array.isArray(input.rows)) throw new Error('Invalid BI transaction-rate data.');
    const byDate = new Map();
    for (const item of input.rows) {
      if (!Array.isArray(item) || item.length !== 3) throw new Error('A transaction-rate row is incomplete.');
      const [date, sell, buy] = item;
      if (!validDate(date) || !Number.isFinite(sell) || !Number.isFinite(buy) || sell <= 0 || buy <= 0 || sell < buy) throw new Error('A transaction-rate row is invalid.');
      if (today && date > today) continue;
      if (byDate.has(date)) throw new Error('Duplicate transaction-rate dates.');
      byDate.set(date, { date, sell, buy, mid: (sell + buy) / 2 });
    }
    const rows = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
    if (!rows.length) throw new Error('No published transaction rates are available.');
    return rows.map((row, i) => ({ ...row, delta: i ? row.mid - rows[i - 1].mid : null }));
  }
  function averages(rows) {
    return Object.fromEntries(keys.map(key => [key, rows.length ? rows.reduce((sum, row) => sum + row[key], 0) / rows.length : NaN]));
  }
  function monthShift(month, offset) {
    const d = new Date(month + '-01T12:00:00Z');
    d.setUTCMonth(d.getUTCMonth() + offset);
    return d.toISOString().slice(0, 7);
  }
  const validMonth = month => typeof month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
  function months(from, to) {
    if (!validMonth(from) || !validMonth(to) || from > to) return [];
    const result = [];
    for (let month = from; month <= to; month = monthShift(month, 1)) result.push(month);
    return result;
  }
  function select(rows, from, to) { return rows.filter(row => row.date.slice(0, 7) >= from && row.date.slice(0, 7) <= to); }
  function monthly(rows, from, to) {
    return months(from, to).map(month => { const group = rows.filter(row => row.date.startsWith(month)); return { month, count: group.length, ...averages(group) }; });
  }
  return { keys, validDate, validMonth, normalize, averages, monthShift, months, select, monthly };
});
