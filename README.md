# BI transaction rates

Bank Indonesia USD/IDR transaction-rate dashboard, using the same design as [JISDOR](https://budhi-halim.github.io/jisdor/).

**Website:** https://budhi-halim.github.io/bi/  
**Dashboard:** https://budhi-halim.github.io/bi/docs/

## Rates and averages

The latest publication, chart, daily table, selected-period summary and monthly breakdown each show three categories:

- **Selling / Kurs jual:** the selling rate published by Bank Indonesia.
- **Buying / Kurs beli:** the buying rate published by Bank Indonesia.
- **Middle:** `(selling + buying) / 2` for the same publication date.

The month selectors include both endpoints and default to the previous calendar month in Asia/Jakarta. Each selected-period average is the arithmetic mean of that category's daily observations. A multi-month result uses every published day equally; it is not an unweighted average of monthly means. Weekends and holidays are not filled with zeros or carried-forward rates.

A persistent warning identifies a selection containing the unfinished current month. The latest available date and the number of published days are shown. Empty months and failed source refreshes are disclosed. Invalid ranges and ranges without observations disable downloads.

Displayed rates use Indonesian number formatting and two decimal places. Calculations and workbook values retain the underlying numeric precision.

## Official data

Source publication: [Kurs Transaksi BI](https://www.bi.go.id/id/statistik/informasi-kurs/transaksi-bi/Default.aspx).

History comes directly from the [official `getSubKursLokal3` web service](https://www.bi.go.id/biwebservice/wskursbi.asmx?op=getSubKursLokal3), with `mts=USD`, `startdate`, and `enddate`. The parser reads `jual_subkurslokal` and `beli_subkurslokal`, validates the nominal unit of **1 USD**, and preserves the WIB calendar date in `tgl_subkurslokal`.

The stored dataset starts in January 2013. Selling and buying rates are retrieved from the transaction series itself. The calculated middle rate is distinct from the same-date JISDOR series; BI's [methodology](https://www.bi.go.id/id/fungsi-utama/moneter/informasi-kurs/default.aspx) explains the relationship.

The first import fetches annual windows with resumable checkpoints. Updates re-fetch the latest 95 days and extend backward after an outage. Valid source revisions replace older observations. Failed updates preserve previously downloaded data and display a freshness notice. Bootstrap completeness describes successful requested API coverage, not an assumed number of business days.

## Excel download

The selected date range exports to a genuine `.xlsx` workbook with:

| Sheet | Contents |
| --- | --- |
| Summary | Selling, buying and middle averages for the entire selected period, day count, selected range, source and provisional-month status |
| Daily Rates | Excel dates, numeric selling and buying rates, and a calculated middle-rate formula |
| Monthly Averages | Excel month dates, all three monthly averages, published-day counts and month status |

All rate cells are numbers, and dates are Excel serial values with date formatting. Middle rates and averages contain formulas with cached numeric results for compatible viewers. Number formatting uses `#,##0.00##`; no currency symbols or thousands separators are embedded in the stored values.

## Updating and deployment

`.github/workflows/site.yml` refreshes the official data, validates calculations and exports, checks five responsive browser sizes, saves verification artifacts, and publishes to GitHub Pages.

Scheduled runs are **08:30, 10:30 and 16:30 WIB on weekdays**, plus **10:00 WIB on Saturday**. GitHub may delay scheduled runs. The workflow also runs on pushes to `master` and can be started manually in Actions.

The Pages publishing source must be **GitHub Actions** in repository Settings → Pages. The root address redirects to `docs/`, preserving query strings and anchors. No API key, server or browser-side cross-origin API call is needed.

## Local development

From this repository in a terminal, with Node.js 22 or newer:

```bash
node scripts/test.mjs
node scripts/update-test.mjs
node scripts/xlsx-test.mjs
```

To refresh official data from a network that can reach Bank Indonesia:

```bash
node scripts/update.mjs
```

Serve `docs/` with a static web server. For example, from the repository directory:

```bash
python -m http.server 8000 --directory docs
```

Then open http://localhost:8000/.

The browser suite is intended for CI. It verifies all three latest rates and averages, pooled multi-month results, month breakdowns, keyboard chart interaction, current-month warnings, empty and invalid ranges, pagination, five responsive widths, and a real Excel download's numeric cell types and formulas. Screenshots, the downloaded workbook and `report.json` are saved to `qa-results/`.

This is an independent viewer of Bank Indonesia publications and is not affiliated with Bank Indonesia.
