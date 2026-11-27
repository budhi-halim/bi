(() => {
  'use strict';
  // Minimal, dependency-free OOXML spreadsheet writer. Numeric and date cells are typed, not strings.
  const encoder = new TextEncoder();
  const xmlEscape = (input) => String(input).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  const excelDate = (iso) => (Date.parse(iso + 'T00:00:00Z') - Date.UTC(1899, 11, 30)) / 86400000;
  const validNumber = (n) => typeof n === 'number' && Number.isFinite(n);
  const colName = (index) => { let s = ''; for (let n = index; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s; };
  const str = (value, style = 0) => ({ type: 'str', value: String(value), style });
  const num = (value, style = 1, formula) => ({ type: 'num', value, style, formula });
  const date = (value) => ({ type: 'num', value: excelDate(value), style: 2 });
  const monthDate = (value) => ({ type: 'num', value: excelDate(`${value}-01`), style: 7 });

  function cellXml(ref, data) {
    if (!data || data.value === undefined || data.value === null || (data.type === 'num' && !validNumber(data.value))) return '';
    const style = data.style || 0;
    if (data.type === 'str') return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(data.value)}</t></is></c>`;
    if (data.formula) return `<c r="${ref}" s="${style}" t="n"><f>${xmlEscape(data.formula)}</f><v>${data.value}</v></c>`;
    return `<c r="${ref}" s="${style}" t="n"><v>${data.value}</v></c>`;
  }

  function worksheet(rows, widths, filter = false, frozen = 0, options = {}) {
    const dimensions = `A1:${colName(Math.max(1, widths.length))}${Math.max(rows.length, 1)}`;
    const sheetRows = rows.map((row, i) => `<row r="${i + 1}"${options.heights?.[i + 1] ? ` ht="${options.heights[i + 1]}" customHeight="1"` : ''}>${row.map((item, c) => cellXml(`${colName(c + 1)}${i + 1}`, item)).join('')}</row>`).join('');
    const columns = widths.map((width, i) => `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`).join('');
    const freeze = frozen ? `<sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="${frozen}" topLeftCell="A${frozen + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` : '<sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews>';
    const autoFilter = filter && rows.length >= 2 ? `<autoFilter ref="${dimensions}"/>` : '';
    const merges = options.merges?.length ? `<mergeCells count="${options.merges.length}">${options.merges.map((ref) => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells>` : '';
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="${dimensions}"/>${freeze}<sheetFormatPr defaultRowHeight="20"/><cols>${columns}</cols><sheetData>${sheetRows}</sheetData>${autoFilter}${merges}<pageMargins left="0.45" right="0.45" top="0.6" bottom="0.6" header="0.3" footer="0.3"/></worksheet>`;
  }

  function stylesXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <numFmts count="3"><numFmt numFmtId="164" formatCode="#,##0.00##"/><numFmt numFmtId="165" formatCode="dd mmm yyyy"/><numFmt numFmtId="166" formatCode="mmm yyyy"/></numFmts>
      <fonts count="4">
        <font><sz val="11"/><name val="Aptos"/><color rgb="FF26364A"/></font>
        <font><b/><sz val="11"/><name val="Aptos"/><color rgb="FFFFFFFF"/></font>
        <font><b/><sz val="16"/><name val="Aptos Display"/><color rgb="FF1D3557"/></font>
        <font><b/><sz val="11"/><name val="Aptos"/><color rgb="FF2F61D6"/></font>
      </fonts>
      <fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1C3355"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEEF3FF"/><bgColor indexed="64"/></patternFill></fill></fills>
      <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
      <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
      <cellXfs count="11">
        <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
        <xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
        <xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
        <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFill="1" applyFont="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
        <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
        <xf numFmtId="164" fontId="3" fillId="3" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>
        <xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
        <xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
        <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
        <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="left" indent="1"/></xf>
        <xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left" indent="1"/></xf>
      </cellXfs>
      <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
    </styleSheet>`;
  }

  const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) { let c = i; for (let j = 0; j < 8; j++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; table[i] = c >>> 0; }
    return table;
  })();
  function crc32(bytes) {
    let crc = 0xFFFFFFFF;
    for (const b of bytes) crc = crcTable[(crc ^ b) & 255] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  function add16(view, offset, n) { view.setUint16(offset, n, true); }
  function add32(view, offset, n) { view.setUint32(offset, n, true); }
  function concat(parts) { let length = 0; for (const part of parts) length += part.length; const result = new Uint8Array(length); let at = 0; for (const part of parts) { result.set(part, at); at += part.length; } return result; }
  function makeZip(files) {
    const locals = [], central = [];
    let offset = 0;
    for (const [filename, content] of Object.entries(files)) {
      const name = encoder.encode(filename), data = encoder.encode(content), crc = crc32(data);
      const local = new Uint8Array(30 + name.length), l = new DataView(local.buffer);
      add32(l, 0, 0x04034B50); add16(l, 4, 20); add16(l, 6, 0x0800); add16(l, 8, 0);
      add16(l, 10, 0); add16(l, 12, 0x0021); add32(l, 14, crc); add32(l, 18, data.length); add32(l, 22, data.length);
      add16(l, 26, name.length); add16(l, 28, 0); local.set(name, 30);
      locals.push(local, data);
      const cd = new Uint8Array(46 + name.length), c = new DataView(cd.buffer);
      add32(c, 0, 0x02014B50); add16(c, 4, 20); add16(c, 6, 20); add16(c, 8, 0x0800); add16(c, 10, 0);
      add16(c, 12, 0); add16(c, 14, 0x0021); add32(c, 16, crc); add32(c, 20, data.length); add32(c, 24, data.length);
      add16(c, 28, name.length); add16(c, 30, 0); add16(c, 32, 0); add16(c, 34, 0); add16(c, 36, 0);
      add32(c, 38, 0); add32(c, 42, offset); cd.set(name, 46);
      central.push(cd);
      offset += local.length + data.length;
    }
    const directory = concat(central);
    const end = new Uint8Array(22), e = new DataView(end.buffer);
    add32(e, 0, 0x06054B50); add16(e, 4, 0); add16(e, 6, 0); add16(e, 8, central.length); add16(e, 10, central.length);
    add32(e, 12, directory.length); add32(e, 16, offset); add16(e, 20, 0);
    return concat([...locals, directory, end]);
  }

  const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  const validMonth = (value) => typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
  const mean = (rows, key) => rows.reduce((sum, row) => sum + row[key], 0) / rows.length;

  function selectedMonths(from, to) {
    const months = [];
    let [year, month] = from.split('-').map(Number);
    while (`${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}` <= to) {
      months.push(`${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`);
      if (months.length > 1200) throw new Error('Select a period shorter than 100 years.');
      month++;
      if (month > 12) { month = 1; year++; }
    }
    return months;
  }

  function build(info) {
    if (!validMonth(info.from) || !validMonth(info.to) || info.from > info.to) throw new Error('Select a valid month range before exporting.');
    if (!Array.isArray(info.daily) || !info.daily.length) throw new Error('There are no published rates to export for this period.');
    const seen = new Set();
    const daily = info.daily.map((row) => {
      if (!validDate(row.date) || row.date.slice(0, 7) < info.from || row.date.slice(0, 7) > info.to || seen.has(row.date)) throw new Error('The export contains invalid or duplicate publication dates.');
      if (!validNumber(row.sell) || !validNumber(row.buy) || row.buy <= 0 || row.sell < row.buy) throw new Error('The export contains an invalid selling or buying rate.');
      seen.add(row.date);
      // Calculate from the source pair, without trusting a formatted or rounded UI value.
      return { date: row.date, sell: row.sell, buy: row.buy, mid: (row.sell + row.buy) / 2 };
    }).sort((a, b) => a.date.localeCompare(b.date));
    const averages = { sell: mean(daily, 'sell'), buy: mean(daily, 'buy'), mid: mean(daily, 'mid') };
    const latest = validDate(info.latest) ? info.latest : daily[daily.length - 1].date;
    const lastRow = daily.length + 1;
    const summary = [
      [str('BI transaction rates', 4)],
      [str('USD / IDR. All rates are Indonesian rupiah per 1 US dollar.')],
      [],
      [str('From month', 6), monthDate(info.from), str('To month', 10), monthDate(info.to)],
      [str('Published days', 6), num(daily.length, 0), str('Latest publication', 10), date(latest)],
      [str('Current month included', 6), str(info.incomplete ? 'Yes. Current-month averages are provisional.' : 'No.')],
      [],
      [str('SELECTED-PERIOD AVERAGES', 3)],
      [str('Selling', 6), num(averages.sell, 5, `AVERAGE('Daily Rates'!B2:B${lastRow})`), str('IDR per 1 USD', 9)],
      [str('Buying', 6), num(averages.buy, 5, `AVERAGE('Daily Rates'!C2:C${lastRow})`), str('IDR per 1 USD', 9)],
      [str('Middle', 6), num(averages.mid, 5, `AVERAGE('Daily Rates'!D2:D${lastRow})`), str('IDR per 1 USD', 9)],
      [],
      [str('CALCULATION', 3)],
      [str('Daily middle rate = (selling rate + buying rate) / 2.', 8)],
      [str('Period averages use the published daily observations in the selected months.', 8)],
      [str('Every published day has equal weight. Monthly averages are not averaged together.', 8)],
      [str('Dates without a published observation are excluded. No values are estimated or carried forward.', 8)],
      [str(info.incomplete ? 'Current-month data is unfinished. Averages will change as new dates are published.' : 'Selling, buying, and middle averages use the same set of publication dates.', 8)],
      [],
      [str('DATA SOURCE', 3)],
      [str(info.source || 'Bank Indonesia. Kurs Transaksi BI.', 8)],
      [str(info.sourceUrl || 'https://www.bi.go.id/id/statistik/informasi-kurs/transaksi-bi/Default.aspx', 8)],
      [str(`Last source refresh: ${info.lastSync || 'Not recorded'}`, 8)],
    ];
    const dailyRows = [
      [str('Publication date', 3), str('Selling (IDR / USD)', 3), str('Buying (IDR / USD)', 3), str('Middle (IDR / USD)', 3)],
      ...daily.map((row, index) => [date(row.date), num(row.sell), num(row.buy), num(row.mid, 1, `AVERAGE(B${index + 2}:C${index + 2})`)]),
    ];
    const groups = new Map();
    daily.forEach((row, index) => {
      const month = row.date.slice(0, 7);
      if (!groups.has(month)) groups.set(month, { rows: [], start: index + 2, end: index + 2 });
      const group = groups.get(month);
      group.rows.push(row);
      group.end = index + 2;
    });
    const monthlyRows = [
      [str('Month', 3), str('Selling average', 3), str('Buying average', 3), str('Middle average', 3), str('Published days', 3), str('Status', 3)],
      ...selectedMonths(info.from, info.to).map((month) => {
        const group = groups.get(month);
        if (!group) return [monthDate(month), null, null, null, num(0, 0), str('No observations', 9)];
        const { rows, start, end } = group;
        return [monthDate(month),
          num(mean(rows, 'sell'), 1, `AVERAGE('Daily Rates'!B${start}:B${end})`),
          num(mean(rows, 'buy'), 1, `AVERAGE('Daily Rates'!C${start}:C${end})`),
          num(mean(rows, 'mid'), 1, `AVERAGE('Daily Rates'!D${start}:D${end})`),
          num(rows.length, 0, `COUNT('Daily Rates'!B${start}:B${end})`),
          str(info.incomplete && month === info.to ? 'In progress' : 'Published observations', 9)];
      }),
    ];
    const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;
    const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
    const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets><sheet name="Summary" sheetId="1" r:id="rId1"/><sheet name="Daily Rates" sheetId="2" r:id="rId2"/><sheet name="Monthly Averages" sheetId="3" r:id="rId3"/></sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`;
    const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
    return makeZip({
      '[Content_Types].xml': types, '_rels/.rels': rels,
      'xl/workbook.xml': workbook, 'xl/_rels/workbook.xml.rels': workbookRels,
      'xl/styles.xml': stylesXml(),
      'xl/worksheets/sheet1.xml': worksheet(summary, [32, 24, 23, 22], false, 0, {
        merges: ['A1:D1', 'A2:D2', 'B6:D6', 'A8:D8', 'C9:D9', 'C10:D10', 'C11:D11', 'A13:D13', 'A14:D14', 'A15:D15', 'A16:D16', 'A17:D17', 'A18:D18', 'A20:D20', 'A21:D21', 'A22:D22', 'A23:D23'],
        heights: { 1: 29, 8: 25, 9: 25, 10: 25, 11: 25, 13: 25, 17: 31, 18: 31, 20: 25, 22: 30 },
      }),
      'xl/worksheets/sheet2.xml': worksheet(dailyRows, [22, 25, 25, 25], true, 1, { heights: { 1: 30 } }),
      'xl/worksheets/sheet3.xml': worksheet(monthlyRows, [18, 24, 24, 24, 20, 27], true, 1, { heights: { 1: 30 } }),
    });
  }

  function download(info) {
    const bytes = build(info);
    const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `BI_USD-IDR_${info.from}_to_${info.to}.xlsx`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  window.BiXlsx = { download, build };
})();

