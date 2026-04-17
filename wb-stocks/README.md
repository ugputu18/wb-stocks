# wb-stocks

TypeScript module that stores historical stock snapshots in a local SQLite
database. Three independent sources live here:

- **WB warehouses** — loaded via the WB Statistics API
  (`pnpm import:stocks`).
- **Our own warehouse** — imported from project CSV files like
  `store/our<MMDD>.csv` (`pnpm import:own-stocks`).
- **WB FBW supplies (поставки)** — loaded via the WB FBW Supplies API
  (`pnpm update:wb-supplies`).

The folder name `wb-stocks` is historical (WB came first); both flows now
share one DB, one migration set, one logger, one CLI convention.

For the full design notes (architecture, idempotency models, snapshot model,
own-warehouse import semantics, migration plan) see [`ReadmeAI.md`](./ReadmeAI.md).
For a focused WB-API reference (endpoints, fields, rate limits, deprecations,
gotchas) see [`docs/wb-api.md`](./docs/wb-api.md).

## Requirements

- Node.js **20.6+** (tested on 22). The CLI uses the built-in
  `node --env-file=.env` flag for loading `.env`, no dotenv dependency.
- `pnpm`.

A `.nvmrc` pointing at `22` is included; `nvm use` inside the module picks
the correct version.

## Quick start

```bash
nvm use                                 # -> Node 22 (per .nvmrc)
pnpm install
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

# Sales forecast MVP happy path:
pnpm forecast:sales-mvp
pnpm forecast:sales-mvp --date=2026-04-17 --horizons=30,60 --dry-run
pnpm forecast:sales-mvp --sku=SKU-1 --warehouse=Коледино

# Semantics:
# - Imports WB orders for [snapshotDate-30 .. snapshotDate-1], then recomputes demand for snapshotDate, then forecast per horizon.
# - --sku / --warehouse only scope the forecast DB write (wb_forecast_snapshots), not orders or demand.
# - Stock snapshot for forecast uses UTC cutoff (last wb_stock_snapshots.snapshot_at <= snapshotDate end-of-day UTC); see ReadmeAI §12.

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

## Troubleshooting

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
  infra/db.ts                        # SQLite open + migrations
  infra/stockSnapshotRepository.ts   # saveBatch (INSERT OR IGNORE)
  infra/ownStockSnapshotRepository.ts# replaceForDate() — idempotent per date
  infra/wbSupplyRepository.ts        # upsert / replace items / status history
  application/mapWbStockRow.ts       # WB stock row → internal record
  application/mapWbSupply.ts         # WB supplies row/details/goods → records
  application/importWbStocks.ts      # use case "load current WB stocks"
  application/importOwnWarehouseState.ts # use case "snapshot own warehouse on a date"
  application/importWbSupplies.ts    # use case "sync WB supplies + items + history"
  application/parseOwnStockCsv.ts    # CSV → normalized rows
  cli/importStocks.ts                # WB stocks manual entry point
scripts/
  import-own-warehouse-state.ts      # own-warehouse manual entry point
  update-wb-supplies.ts              # WB supplies manual entry point
docs/
  wb-api.md                          # focused WB API reference (used endpoints)
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
