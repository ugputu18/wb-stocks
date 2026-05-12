# wb-stocks

TypeScript module that stores historical stock snapshots in a local SQLite
database. Three independent sources live here:

- **WB warehouses** — loaded via the WB Statistics API
  (`pnpm import:stocks`).
- **Our own warehouse** — imported from project CSV files like
  `store/our<MMDD>.csv` (`pnpm import:own-stocks`).
- **WB FBW supplies (поставки)** — loaded via the WB FBW Supplies API
  (`pnpm update:wb-supplies`).
- **WB warehouse tariffs (тарифы по складам)** — loaded via the WB Common
  API (`pnpm update:wb-tariffs`): box, pallet, acceptance coefficients.

The folder name `wb-stocks` is historical (WB came first); both flows now
share one DB, one migration set, one logger, one CLI convention.

For the full design notes (architecture, idempotency models, snapshot model,
own-warehouse import semantics, migration plan) see [`ReadmeAI.md`](./ReadmeAI.md).
For **GCP deployment** (single GCE VM behind HTTPS LB + IAP, systemd timers
for the WB imports, secrets in Secret Manager) see
[`deploy/gcp/README.md`](./deploy/gcp/README.md) and the task note
[`docs/ai-tasks/gcp-deployment.md`](./docs/ai-tasks/gcp-deployment.md).
For a focused WB-API reference (endpoints, fields, rate limits, deprecations,
gotchas) see [`docs/wb-api.md`](./docs/wb-api.md).
For **WB redistribution** in forecast UI (macro vs warehouse execution, registry,
compatibility rules): [`docs/redistribution-product.md`](./docs/redistribution-product.md)
and [`docs/redistribution-read-model.md`](./docs/redistribution-read-model.md).

## Requirements

- Node.js **20.6+** (project pins **22.21.1**). The CLI uses the built-in
  `node --env-file=.env` flag for loading `.env`, no dotenv dependency.
- `pnpm`.

Node version is pinned in **two** places:

- `.nvmrc` (`22`) — for humans / CI using `nvm use`.
- `.npmrc` (`use-node-version=22.21.1`) — pnpm itself downloads and uses
  this exact Node for every `pnpm install` / `pnpm run …` / `pnpm exec …`,
  independently of the system `node` on `PATH`. This avoids the classic
  `NODE_MODULE_VERSION` mismatch on `better-sqlite3` when the shell is not
  running `nvm use 22`.

## Quick start

```bash
pnpm install                            # downloads Node 22.21.1 via pnpm
cp .env.example .env                    # fill in WB_TOKEN (only needed for WB)

# WB warehouses current state:
pnpm import:stocks

# Own warehouse state for a date (CSV snapshot):
pnpm import:own-stocks                  # today, default warehouse
pnpm import:own-stocks --date=2026-04-18

# WB supplies (поставки) — last 30 days by default:
pnpm update:wb-supplies
pnpm update:wb-supplies --from=2026-04-01 --status=4,5,6
pnpm update:wb-supplies --no-details --no-items   # fast list-only sync
pnpm update:wb-supplies --from=2026-04-01 --dry-run

# WB warehouse tariffs (тарифы коробов / паллет / приёмки):
pnpm update:wb-tariffs                            # today (UTC), all three endpoints
pnpm update:wb-tariffs --date=2026-05-12          # tariff snapshot for a specific date
pnpm update:wb-tariffs --skip-box --skip-pallet \
    --warehouses=507,117501                       # only acceptance coefficients
pnpm update:wb-tariffs --dry-run                  # no DB writes

# Warehouse picker report (fuses box tariff + acceptance + current stock):
pnpm report:warehouse-tariffs                     # TTY table, score-sorted, box_type=2 (Короба)
pnpm report:warehouse-tariffs --available-only --limit=15
pnpm report:warehouse-tariffs --macro='Сибирский и Дальневосточный'
pnpm report:warehouse-tariffs --geo='Сибирский' --format=csv > picker.csv
pnpm report:warehouse-tariffs --sort=delivery     # cheapest by ship cost
pnpm report:warehouse-tariffs --sort=stock        # warehouses with most units

# Sales forecast MVP happy path:
pnpm forecast:sales-mvp
pnpm forecast:sales-mvp --date=2026-04-17 --horizons=30,60 --dry-run
pnpm forecast:sales-mvp --sku=SKU-1 --warehouse=Коледино

# Semantics:
# - Pulls a fresh WB stocks snapshot first (importWbStocks), so forecast pinning sees current quantities.
# - Imports WB orders for [snapshotDate-90 .. snapshotDate-1], then recomputes demand for snapshotDate, then forecast per horizon.
# - --sku / --warehouse only scope the forecast DB write (wb_forecast_snapshots), not orders or demand.
# - Stock snapshot for forecast uses UTC cutoff (last wb_stock_snapshots.snapshot_at <= snapshotDate end-of-day UTC); see ReadmeAI §12.
# - The same pipeline backs `POST /api/forecast/recalculate` and the redistribution UI button «Обновить данные WB»;
#   pass `{ "refreshStocks": false }` in the body to skip the stocks call (e.g. for offline runs).

pnpm test                               # run the test suite
```

> **Heads up:** `pnpm` does not forward CLI flags after `--` reliably for
> all scripts; if forwarding misbehaves, run the script directly:
> `node --env-file=.env --import tsx scripts/update-wb-supplies.ts --from=2026-04-01 --dry-run`.
> The same applies to the forecast CLI:
> `node --env-file=.env --import tsx scripts/run-sales-forecast-mvp.ts --dry-run`.

## Own warehouse import recipes

The own-warehouse CLI has two independent inputs that often confuse first-time
users:

- `--date=YYYY-MM-DD` — the **snapshot key** in the DB (idempotency is
  per-`date`+`warehouse`). Defaults to today (local).
- `--file=<path>` — the **CSV to read**. If omitted, resolved by convention:
  `../store/our<MMDD>.csv` derived from `--date`.

They are **not** required to match. Common scenarios:

```bash
# 1) Tomorrow's CSV is already on disk (`store/our0418.csv`),
#    but you want to record it as TODAY's snapshot:
pnpm import:own-stocks --date=$(date +%Y-%m-%d) --file=../store/our0418.csv

# 2) CSV name == date (the default, no flags needed). E.g. on 2026-04-18
#    this auto-loads `../store/our0418.csv`:
pnpm import:own-stocks

# 3) Re-import / fix a past day — fully replaces that day's snapshot:
pnpm import:own-stocks --date=2026-04-15 --file=../store/our0415.csv
# → second run logs `wasUpdate: true`, `inserted` = new row count.

# 4) Different warehouse (default `main`):
pnpm import:own-stocks --warehouse=spb --file=../store/spb_2026-04-18.csv
```

Trailing `warn` lines like
`Own warehouse import: row skipped … reason: missing "Артикул"` are **normal**
— operator CSVs usually end with blank rows and a totals row
(e.g. `43,157 pcs`). They appear in `skipped` and are not errors.

The forecast UI also exposes a one-click **«Загрузить остатки CSV»** button
on the main page (next to **«Скачать WB CSV»** / **«Скачать Supplier CSV»**)
that hits `POST /api/forecast/upload-own-stocks` and reuses the same parser
and `replaceForDate` semantics. Column names may differ — they are
auto-detected by header keyword (`артикул` / `остаток`) and content of the
first rows (a 6–10-digit value classifies the column as the WB article).
See [`docs/ai-tasks/own-stocks-csv-upload.md`](./docs/ai-tasks/own-stocks-csv-upload.md).

## Troubleshooting

- `better_sqlite3.node` / `NODE_MODULE_VERSION` mismatch (e.g. compiled for
  **115** but Node expects **127**) — native addon was built for another Node
  major. After `nvm use` (or any Node version switch), run:
  `pnpm rebuild:native` (alias for `pnpm rebuild better-sqlite3`). Repeat
  whenever you change Node or reinstall deps from a machine that used a
  different version.
- `node: bad option: --env-file=.env` — your shell is on Node < 20.6.
  Run `nvm use` inside `wb-stocks/` (the `.nvmrc` pins Node 22). The pnpm
  scripts rely on Node's built-in `--env-file` flag, there is no `dotenv`.
- `ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND` — you ran `pnpm` from outside the
  `wb-stocks/` directory. `cd wb-stocks` first.
- Import says `wasUpdate: true` when you didn't expect it — a snapshot for
  that `(date, warehouse)` already existed and was fully replaced. This is
  by design (replace-for-date), see `ReadmeAI.md` §3 of the own-warehouse
  section.

## Layout

```
src/
  config/env.ts                      # zod-validated env
  domain/stockSnapshot.ts            # WB stocks row zod schema + record type
  domain/ownStockSnapshot.ts         # own-warehouse record type
  domain/wbSupply.ts                 # WB FBW supplies zod schemas + record types
  infra/wbStatsClient.ts             # GET /api/v1/supplier/stocks (+ retry)
  infra/wbSuppliesClient.ts          # POST /api/v1/supplies + GET .../{ID}[/goods]
  infra/wbCommonClient.ts            # GET /api/v1/tariffs/{box,pallet} + /api/tariffs/v1/acceptance/coefficients
  infra/db.ts                        # SQLite open + migrations
  infra/stockSnapshotRepository.ts   # saveBatch (INSERT OR IGNORE)
  infra/ownStockSnapshotRepository.ts# replaceForDate() — idempotent per date
  infra/wbSupplyRepository.ts        # upsert / replace items / status history
  infra/wbWarehouseTariffRepository.ts # box/pallet (UPSERT по дате+складу), acceptance (история по fetched_at)
  application/mapWbStockRow.ts       # WB stock row → internal record
  application/mapWbSupply.ts         # WB supplies row/details/goods → records
  application/mapWbWarehouseTariff.ts# WB tariff envelope/row → records + decimal parser
  application/importWbStocks.ts      # use case "load current WB stocks"
  application/importOwnWarehouseState.ts # use case "snapshot own warehouse on a date"
  application/importWbSupplies.ts    # use case "sync WB supplies + items + history"
  application/importWbWarehouseTariffs.ts # use case "snapshot WB tariffs (box+pallet+acceptance)"
  application/buildWarehouseTariffReport.ts # pure builder: box tariff × acceptance × stock → ranked rows
  application/parseOwnStockCsv.ts    # CSV → normalized rows
  cli/importStocks.ts                # WB stocks manual entry point
scripts/
  import-own-warehouse-state.ts      # own-warehouse manual entry point
  update-wb-supplies.ts              # WB supplies manual entry point
  update-wb-tariffs.ts               # WB warehouse tariffs manual entry point
  report-warehouse-tariffs.ts        # «выбор оптимального склада»: table/CSV/JSON picker
docs/
  wb-api.md                          # focused WB API reference (used endpoints)
  redistribution-product.md          # redistribution: macro vs execution, compatibility
  redistribution-read-model.md       # redistribution: client pools, flags, ranking
test/
  *.test.ts
```

## Update note

The WB endpoint `GET /api/v1/supplier/stocks` is deprecated and will be
disabled on 2026-06-23. Replacement is
`POST /api/analytics/v1/stocks-report/wb-warehouses`. Migration plan is in
`ReadmeAI.md` §11 — the internal record already has nullable columns so only
a new infra client is needed. Field-level diff between old and new endpoints
is in `docs/wb-api.md` §2.2.
