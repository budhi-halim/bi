(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const calc = window.BiRates;
  const categories = [{ key: 'sell', name: 'Selling', color: '#8069b7', dash: '5 3' }, { key: 'buy', name: 'Buying', color: '#258c8b', dash: '2 3' }, { key: 'mid', name: 'Middle', color: '#3565e8', dash: '' }];
  const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const numberFormat = new Intl.NumberFormat('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const integerFormat = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });
  const state = { rows: [], data: null, from: '', to: '', preset: 'previous', chart: '6M', page: 0, pageSize: 15, newestFirst: true, valid: false };
  const todayParts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const todayField = name => todayParts.find(part => part.type === name).value;
  const today = `${todayField('year')}-${todayField('month')}-${todayField('day')}`;
  const currentMonth = today.slice(0, 7);
  const formatRate = value => Number.isFinite(value) ? numberFormat.format(value) : '—';
  const formatDate = (date, options) => new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC', ...options }).format(new Date(`${date}T12:00:00Z`));
  const formatMonth = month => new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T12:00:00Z`));
  const shortMonth = month => `${MONTHS_SHORT[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
  const monthShift = (month, offset) => { const d = new Date(`${month}-01T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + offset); return d.toISOString().slice(0, 7); };
  const change = value => (value > 0 ? '↑ ' : value < 0 ? '↓ ' : '') + formatRate(Math.abs(value));
  const means = rows => calc.averages(rows);
  const inRange = row => row.date.slice(0, 7) >= state.from && row.date.slice(0, 7) <= state.to;
  const monthSeries = (from, to) => { const result = []; for (let m = from; m <= to; m = monthShift(m, 1)) result.push(m); return result; };
  const previousMonth = monthShift(currentMonth, -1);
  const chosenRows = () => state.valid ? state.rows.filter(inRange) : [];
  const validMonth = month => /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
  function setLoading(value) { $('loadingBanner').classList.toggle('hidden', !value); }
  function setExportEnabled(value) { $('exportButton').disabled = !value; $('tableExportButton').disabled = !value; }
  let toastTimer;
  function toast(message) { const el = $('toast'); el.textContent = message; el.classList.remove('hidden'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.add('hidden'), 4500); }

  function normalize(input) { return calc.normalize(input, today); }

  async function load() {
    setLoading(true);
    setExportEnabled(false);
    $('errorBanner').classList.add('hidden');
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 25000);
      let input;
      try {
        const response = await fetch(`./data/bi.json?v=${Date.now()}`, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error(`Data request returned HTTP ${response.status}.`);
        input = await response.json();
      } finally { clearTimeout(timeout); }
      state.rows = normalize(input);
      state.data = input;
      showLatest();
      render();
      showFreshness();
    } catch (error) {
      $('errorText').textContent = `Unable to load BI transaction rates: ${error.name === 'AbortError' ? 'The data request timed out. Please retry.' : error.message}`;
      $('errorBanner').classList.remove('hidden');
      setExportEnabled(false);
      $('rateTable').innerHTML = '<tr><td colspan="4" class="table-empty">Historical data is unavailable.</td></tr>';
    } finally { setLoading(false); }
  }

  function showFreshness() {
    const latest = state.rows.at(-1).date;
    const age = Math.floor((Date.parse(today + 'T00:00:00Z') - Date.parse(latest + 'T00:00:00Z')) / 86400000);
    $('dataFooter').textContent = `Latest observation: ${formatDate(latest)}`;
    let notice = $('freshnessNotice');
    if (!notice) {
      notice = document.createElement('div'); notice.id = 'freshnessNotice';
      notice.className = 'period-warning hidden'; notice.style.margin = '0 0 20px'; notice.setAttribute('role', 'status');
      document.querySelector('.latest-heading').before(notice);
    }
    const failed = state.data.last_source === 'snapshot' || Boolean(state.data.last_error);
    const partial = state.data.history_initialized !== true;
    notice.classList.toggle('hidden', age <= 5 && !failed && !partial);
    if (partial) notice.textContent = 'Historical coverage is still being retrieved. Averages include the stored publication dates only.';
    else if (failed) notice.textContent = `The latest refresh could not reach Bank Indonesia. Previously downloaded rates are retained. Latest publication: ${formatDate(latest)}.`;
    else if (age > 5) notice.textContent = `Data may be out of date. The latest stored publication is ${formatDate(latest)}. Holidays can explain gaps; check the official publication for more recent rates.`;
  }

  function showLatest() {
    const last = state.rows.at(-1);
    for (const category of categories) $('latest' + category.key[0].toUpperCase() + category.key.slice(1)).textContent = formatRate(last[category.key]);
    $('latestDate').textContent = formatDate(last.date);
    $('dayChange').textContent = last.delta === null ? 'First publication' : change(last.delta);
    if (last.delta !== null) {
      const pct = last.delta / (last.mid - last.delta) * 100;
      $('dayChange').title = `${pct > 0 ? '+' : ''}${numberFormat.format(pct)}% vs. previous publication`;
    }
  }

  function applyPreset(key) {
    state.preset = key;
    if (key === 'previous') state.from = state.to = previousMonth;
    else if (key === '3months') { state.from = monthShift(currentMonth, -3); state.to = previousMonth; }
    else if (key === 'year') { state.from = `${today.slice(0, 4)}-01`; state.to = currentMonth; }
    else if (key === 'current') state.from = state.to = currentMonth;
    $('fromMonth').value = state.from;
    $('toMonth').value = state.to;
    updatePresets();
    state.page = 0;
    state.chart = 'range';
    render();
  }
  function updatePresets() {
    document.querySelectorAll('.preset').forEach(button => {
      const active = button.dataset.preset === state.preset;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }
  function isValidRange() {
    state.valid = validMonth(state.from) && validMonth(state.to) && state.from >= '2013-01' && state.from <= state.to && state.to <= currentMonth;
    $('rangeError').classList.toggle('hidden', state.valid);
    if (!state.valid) $('rangeError').textContent = 'Choose months from January 2013 onward. The start must be on or before the end; future months are not available.';
    $('fromMonth').setAttribute('aria-invalid', String(!state.valid));
    $('toMonth').setAttribute('aria-invalid', String(!state.valid));
    return state.valid;
  }
  function clearPeriod() {
    for (const id of ['avgSell', 'avgBuy', 'avgMid', 'breakdownPeriod']) $(id).textContent = '—';
    $('breakdownObs').textContent = '— published days';
    $('rangeLabel').textContent = 'Invalid date range'; $('rangeSubLabel').textContent = '';
    $('tableDescription').textContent = 'Select a valid month range';
    $('tableCount').textContent = '0 records'; $('paginationLabel').textContent = '0 records';
    $('prevPage').disabled = $('nextPage').disabled = true;
    $('rateTable').innerHTML = '<tr><td colspan="4" class="table-empty">Select a valid month range.</td></tr>';
    $('monthList').innerHTML = '<p class="empty-copy">Select a valid month range.</p>';
    $('periodWarning').classList.add('hidden'); $('missingWarning').classList.add('hidden');
    setExportEnabled(false); renderChart();
  }
  function render() {
    if (!state.rows.length) return;
    if (!isValidRange()) { clearPeriod(); return; }
    const selected = chosenRows();
    const averages = means(selected);
    const months = monthSeries(state.from, state.to);
    setExportEnabled(selected.length > 0);
    for (const category of categories) $('avg' + category.key[0].toUpperCase() + category.key.slice(1)).textContent = formatRate(averages[category.key]);
    const label = state.from === state.to ? formatMonth(state.from) : `${shortMonth(state.from)} – ${shortMonth(state.to)}`;
    $('rangeLabel').textContent = label;
    $('rangeSubLabel').textContent = `${months.length} ${months.length === 1 ? 'month' : 'months'} · ${integerFormat.format(selected.length)} published days`;
    $('breakdownPeriod').textContent = label;
    $('breakdownObs').textContent = `${integerFormat.format(selected.length)} published days`;
    $('periodWarning').classList.toggle('hidden', state.to !== currentMonth);
    if (state.to === currentMonth) {
      const lastCurrent = state.rows.filter(row => row.date.startsWith(currentMonth)).at(-1)?.date;
      $('periodWarningDetail').textContent = `The current month is not complete. ${lastCurrent ? 'Latest recorded rate: ' + formatDate(lastCurrent) + '. ' : 'No rates are recorded for the current month yet. '}All three averages will change as further dates are published.`;
    }
    const missing = months.filter(month => !selected.some(row => row.date.startsWith(month)));
    $('missingWarning').classList.toggle('hidden', missing.length === 0);
    if (missing.length) $('missingWarningDetail').textContent = `No observations are stored for: ${missing.map(shortMonth).join(', ')}. The averages use available dates only; this is not a complete-period result.`;
    renderMonthly(selected);
    renderTable(selected);
    renderChart();
  }
  function renderMonthly(selected) {
    const groups = calc.monthly(selected, state.from, state.to).reverse();
    $('monthList').innerHTML = groups.map(group => `<div class="month-row">
      <div class="month-row-head"><span class="month-name">${shortMonth(group.month)}</span><span class="month-status">${group.count} days${group.month === currentMonth ? ' · In progress' : ''}</span></div>
      <div class="month-rates">${categories.map(category => `<div><span>${category.name}</span><strong class="month-${category.key}">${formatRate(group[category.key])}</strong></div>`).join('')}</div>
    </div>`).join('');
  }
  function renderTable(rows) {
    const ordered = [...rows].sort((a, b) => state.newestFirst ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date));
    const totalPages = Math.max(1, Math.ceil(ordered.length / state.pageSize));
    state.page = Math.max(0, Math.min(state.page, totalPages - 1));
    const start = state.page * state.pageSize;
    const displayed = ordered.slice(start, start + state.pageSize);
    $('rateTable').innerHTML = displayed.length ? displayed.map(row => `<tr><td><time datetime="${row.date}">${row.date.slice(8)} ${MONTHS_SHORT[Number(row.date.slice(5, 7)) - 1]}<span class="table-year"> ${row.date.slice(0, 4)}</span></time></td><td class="align-right">${formatRate(row.sell)}</td><td class="align-right">${formatRate(row.buy)}</td><td class="align-right"><span class="rate-text">${formatRate(row.mid)}</span></td></tr>`).join('') : '<tr><td colspan="4" class="table-empty">No published rates in the selected period.</td></tr>';
    $('tableCount').textContent = `${integerFormat.format(ordered.length)} records`;
    $('tableDescription').textContent = `${shortMonth(state.from)}${state.from === state.to ? '' : ' – ' + shortMonth(state.to)} · IDR per 1 USD · Published days only`;
    $('paginationLabel').textContent = ordered.length ? `Showing ${start + 1}–${Math.min(start + state.pageSize, ordered.length)} of ${integerFormat.format(ordered.length)}` : '0 records';
    $('prevPage').disabled = state.page === 0; $('nextPage').disabled = state.page >= totalPages - 1;
    $('sortIndicator').textContent = state.newestFirst ? '↓' : '↑';
    $('sortDateButton').closest('th').setAttribute('aria-sort', state.newestFirst ? 'descending' : 'ascending');
  }
  function chartRows() {
    if (state.chart === 'range') return chosenRows();
    const threshold = new Date(state.rows.at(-1).date + 'T12:00:00Z');
    const months = { '1M': 1, '3M': 3, '6M': 6, '1Y': 12 }[state.chart] || 6;
    const targetMonth = monthShift(threshold.toISOString().slice(0, 7), -months);
    const day = threshold.getUTCDate();
    const maxDay = new Date(Date.UTC(Number(targetMonth.slice(0, 4)), Number(targetMonth.slice(5)), 0)).getUTCDate();
    const from = targetMonth + '-' + String(Math.min(day, maxDay)).padStart(2, '0');
    return state.rows.filter(row => row.date >= from);
  }
  function svgNode(tag, attrs, text) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attrs || {}).forEach(([name, value]) => el.setAttribute(name, String(value)));
    if (text !== undefined) el.textContent = text;
    return el;
  }
  function htmlNode(tag, text) { const el = document.createElement(tag); el.textContent = text; return el; }
  function renderChart() {
    if (!state.rows.length) return;
    document.querySelectorAll('.chart-period').forEach(button => {
      const active = button.dataset.chart === state.chart;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    const svg = $('trendChart');
    svg.replaceChildren();
    const points = chartRows();
    const tooltip = $('chartTooltip');
    tooltip.classList.add('hidden');
    const W = Math.max(240, svg.clientWidth), H = W < 500 ? 240 : 280;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.style.height = H + 'px';
    svg.style.minHeight = H + 'px';
    if (!points.length) {
      svg.append(svgNode('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', fill: '#97a4b7', 'font-size': 12 }, state.valid ? 'No observations in this period.' : 'Select a valid month range.'));
      $('chartDateSpan').textContent = 'No observations';
      return;
    }
    const left = 5, right = 62, top = 25, bottom = 35;
    const min = Math.min(...points.map(row => row.buy)), max = Math.max(...points.map(row => row.sell));
    const spread = Math.max(max - min, 40), low = min - spread * .17, high = max + spread * .17;
    const dates = points.map(row => Date.parse(row.date + 'T12:00:00Z'));
    const firstTime = dates[0], timeRange = Math.max(1, dates.at(-1) - firstTime);
    const x = index => points.length === 1 ? (W - right + left) / 2 : left + (dates[index] - firstTime) / timeRange * (W - left - right);
    const y = rate => top + (high - rate) / (high - low) * (H - top - bottom);
    const coords = points.map((row, i) => [x(i), y(row.mid)]);
    const line = coords.map(([xx, yy], i) => `${i ? 'L' : 'M'}${xx.toFixed(2)},${yy.toFixed(2)}`).join(' ');
    const defs = svgNode('defs'), gradient = svgNode('linearGradient', { id: 'chartGradient', x1: '0', x2: '0', y1: '0', y2: '1' });
    gradient.append(svgNode('stop', { offset: '0%', 'stop-color': '#457cf1', 'stop-opacity': '.18' }), svgNode('stop', { offset: '100%', 'stop-color': '#457cf1', 'stop-opacity': '.006' }));
    defs.append(gradient); svg.append(defs);
    for (let tick = 0; tick <= 4; tick++) {
      const value = low + (high - low) * tick / 4, yy = y(value);
      svg.append(svgNode('line', { x1: left, x2: W - right, y1: yy, y2: yy, class: 'grid-line' }));
      svg.append(svgNode('text', { x: W - right + 10, y: yy + 4, class: 'axis-label' }, integerFormat.format(value)));
    }
    const tickCount = Math.min(points.length, W < 440 ? 3 : 5);
    for (let tick = 0; tick < tickCount; tick++) {
      const i = tickCount === 1 ? 0 : Math.round((points.length - 1) * tick / (tickCount - 1));
      const row = points[i];
      const label = timeRange < 95 * 86400000 ? row.date.slice(8) + ' ' + MONTHS_SHORT[Number(row.date.slice(5, 7)) - 1] : shortMonth(row.date.slice(0, 7));
      svg.append(svgNode('text', { x: x(i), y: H - 9, 'text-anchor': tick === 0 ? 'start' : tick === tickCount - 1 ? 'end' : 'middle', class: 'axis-label' }, label));
    }
    const sellCoords = points.map((row, i) => `${i ? 'L' : 'M'}${x(i).toFixed(2)},${y(row.sell).toFixed(2)}`).join(' ');
    const buyCoords = points.map((row, i) => [x(i), y(row.buy)]).reverse().map(([xx, yy]) => `L${xx.toFixed(2)},${yy.toFixed(2)}`).join(' ');
    svg.append(svgNode('path', { d: sellCoords + ' ' + buyCoords + ' Z', fill: '#3565e8', opacity: .045 }));
    for (const category of categories) {
      const path = points.map((row, i) => `${i ? 'L' : 'M'}${x(i).toFixed(2)},${y(row[category.key]).toFixed(2)}`).join(' ');
      svg.append(svgNode('path', { d: path, fill: 'none', stroke: category.color, 'stroke-width': category.key === 'mid' ? 2.6 : 1.6, 'stroke-dasharray': category.dash, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'data-series': category.key }));
      if (points.length === 1) svg.append(svgNode('circle', { cx: x(0), cy: y(points[0][category.key]), r: 3.5, fill: category.color }));
    }
    const focusLine = svgNode('line', { class: 'focus-line', y1: top, y2: H - bottom, visibility: 'hidden' });
    const focusDot = svgNode('circle', { class: 'focus-point', r: 4, visibility: 'hidden' });
    svg.append(focusLine, focusDot);
    const overlay = svgNode('rect', { x: left, y: top, width: W - left - right, height: H - top - bottom, fill: 'transparent', 'pointer-events': 'all', tabindex: 0, role: 'slider', 'aria-label': 'Selling, buying and middle rates. Use left and right arrows to inspect daily observations.', 'aria-valuemin': 1, 'aria-valuemax': points.length, 'aria-valuenow': points.length });
    svg.append(overlay);
    let focused = points.length - 1;
    const showPoint = i => {
      focused = i;
      const row = points[i], [xx, yy] = coords[i];
      focusLine.setAttribute('x1', xx); focusLine.setAttribute('x2', xx); focusLine.setAttribute('visibility', 'visible');
      focusDot.setAttribute('cx', xx); focusDot.setAttribute('cy', yy); focusDot.setAttribute('visibility', 'visible');
      overlay.setAttribute('aria-valuenow', i + 1);
      overlay.setAttribute('aria-valuetext', `${formatDate(row.date)}: selling ${formatRate(row.sell)}, buying ${formatRate(row.buy)}, middle ${formatRate(row.mid)} rupiah per US dollar`);
      tooltip.replaceChildren(htmlNode('span', formatDate(row.date)), ...categories.map(category => htmlNode('b', `${category.name}  ${formatRate(row[category.key])}`)));
      tooltip.classList.remove('hidden');
      const bounds = svg.getBoundingClientRect();
      const local = svg.createSVGPoint(); local.x = xx; local.y = yy;
      const screen = local.matrixTransform(svg.getScreenCTM());
      const half = tooltip.offsetWidth / 2 + 3;
      tooltip.style.left = Math.max(half, Math.min(bounds.width - half, screen.x - bounds.left)) + 'px';
      tooltip.style.top = Math.max(tooltip.offsetHeight + 2, screen.y - bounds.top - 10) + 'px';
    };
    const hide = () => { focusLine.setAttribute('visibility', 'hidden'); focusDot.setAttribute('visibility', 'hidden'); tooltip.classList.add('hidden'); };
    overlay.addEventListener('pointermove', event => {
      const cursor = svg.createSVGPoint(); cursor.x = event.clientX; cursor.y = event.clientY;
      const localX = cursor.matrixTransform(svg.getScreenCTM().inverse()).x;
      let nearest = 0;
      for (let i = 1; i < coords.length; i++) if (Math.abs(coords[i][0] - localX) < Math.abs(coords[nearest][0] - localX)) nearest = i;
      showPoint(nearest);
    });
    overlay.addEventListener('pointerleave', hide);
    overlay.addEventListener('blur', hide);
    overlay.addEventListener('focus', () => showPoint(focused));
    overlay.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const i = event.key === 'Home' ? 0 : event.key === 'End' ? points.length - 1 : focused + (event.key === 'ArrowRight' ? 1 : -1);
      showPoint(Math.max(0, Math.min(points.length - 1, i)));
    });
    $('chartDateSpan').textContent = `${formatDate(points[0].date)} — ${formatDate(points.at(-1).date)}`;
    svg.setAttribute('aria-label', `BI selling, buying and calculated middle rates, ${formatDate(points[0].date)} through ${formatDate(points.at(-1).date)}. Vertical scale is not zero-based.`);
  }
  function exportWorkbook() {
    if (!state.valid || !state.rows.length) return;
    const selected = chosenRows();
    if (!selected.length) return toast('The selected period has no observations to export.');
    if (typeof window.BiXlsx?.download !== 'function') return toast('Excel export could not be initialized. Reload the page and try again.');
    try {
      window.BiXlsx.download({ from: state.from, to: state.to, daily: [...selected].reverse(), monthly: calc.monthly(selected, state.from, state.to), averages: means(selected), latest: state.rows.at(-1).date, incomplete: state.to === currentMonth, source: 'Bank Indonesia · USD/IDR transaction rates', sourceUrl: state.data.source_url, lastSync: state.data.last_bi_sync });
      toast(`Exported ${selected.length} dates with numeric selling, buying and middle rates.`);
    } catch (error) { toast(`The workbook could not be created: ${error.message}`); }
  }
  function setup() {
    $('todayLabel').textContent = formatDate(today, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    $('fromMonth').max = $('toMonth').max = currentMonth;
    document.querySelectorAll('.preset').forEach(button => button.addEventListener('click', () => applyPreset(button.dataset.preset)));
    for (const [id, name] of [['fromMonth', 'from'], ['toMonth', 'to']]) $(id).addEventListener('change', event => {
      state[name] = event.target.value; state.preset = 'custom'; updatePresets(); state.page = 0; state.chart = 'range'; render();
    });
    document.querySelectorAll('.chart-period').forEach(button => button.addEventListener('click', () => { state.chart = button.dataset.chart; renderChart(); }));
    $('prevPage').addEventListener('click', () => { if (state.valid) { state.page--; renderTable(chosenRows()); } });
    $('nextPage').addEventListener('click', () => { if (state.valid) { state.page++; renderTable(chosenRows()); } });
    $('sortDateButton').addEventListener('click', () => { if (state.valid) { state.newestFirst = !state.newestFirst; state.page = 0; renderTable(chosenRows()); } });
    $('exportButton').addEventListener('click', exportWorkbook);
    $('tableExportButton').addEventListener('click', exportWorkbook);
    $('retryButton').addEventListener('click', load);
    document.querySelectorAll('.nav-link').forEach(link => link.addEventListener('click', () => { document.querySelectorAll('.nav-link').forEach(x => x.classList.remove('active')); link.classList.add('active'); }));
    state.from = state.to = previousMonth;
    $('fromMonth').value = $('toMonth').value = previousMonth;
    updatePresets();
    let lastWidth = 0, redraw;
    if (window.ResizeObserver) new ResizeObserver(entries => {
      const width = Math.round(entries[0].contentRect.width);
      if (width === lastWidth) return;
      lastWidth = width; clearTimeout(redraw); redraw = setTimeout(renderChart, 80);
    }).observe($('trendChart'));
    load();
  }
  document.addEventListener('DOMContentLoaded', setup);
})();

