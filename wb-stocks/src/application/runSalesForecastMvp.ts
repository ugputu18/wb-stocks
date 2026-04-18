import type { Logger } from "pino";
import type { DbHandle } from "../infra/db.js";
import type { WbStatsClient } from "../infra/wbStatsClient.js";
import type { WbOrdersDailyRepository } from "../infra/wbOrdersDailyRepository.js";
import type { WbOrdersDailyByRegionRepository } from "../infra/wbOrdersDailyByRegionRepository.js";
import type { WbDemandSnapshotRepository } from "../infra/wbDemandSnapshotRepository.js";
import type { WbRegionDemandSnapshotRepository } from "../infra/wbRegionDemandSnapshotRepository.js";
import type { StockSnapshotRepository } from "../infra/stockSnapshotRepository.js";
import type { WbSupplyRepository } from "../infra/wbSupplyRepository.js";
import type { WbForecastSnapshotRepository } from "../infra/wbForecastSnapshotRepository.js";
import {
  importWbOrders,
  type ImportWbOrdersResult,
} from "./importWbOrders.js";
import {
  computeDemandSnapshot,
  type ComputeDemandSnapshotResult,
} from "./computeDemandSnapshot.js";
import {
  computeRegionDemandSnapshot,
  type ComputeRegionDemandSnapshotResult,
} from "./computeRegionDemandSnapshot.js";
import {
  buildForecastSnapshot,
  type BuildForecastSnapshotResult,
} from "./buildForecastSnapshot.js";

export interface RunSalesForecastMvpDeps {
  db: DbHandle;
  wbClient: WbStatsClient;
  ordersRepository: WbOrdersDailyRepository;
  ordersByRegionRepository: WbOrdersDailyByRegionRepository;
  demandRepository: WbDemandSnapshotRepository;
  regionDemandRepository: WbRegionDemandSnapshotRepository;
  stockRepository: StockSnapshotRepository;
  supplyRepository: WbSupplyRepository;
  forecastRepository: WbForecastSnapshotRepository;
  logger: Logger;
  now?: () => Date;
}

export interface RunSalesForecastMvpOptions {
  snapshotDate?: string;
  horizons?: readonly number[];
  dryRun?: boolean;
  sku?: string;
  warehouse?: string;
}

export interface RunSalesForecastMvpResult {
  snapshotDate: string;
  horizons: number[];
  dryRun: boolean;
  sku: string | null;
  warehouse: string | null;
  ordersWindowFrom: string;
  ordersWindowTo: string;
  ordersImport: ImportWbOrdersResult;
  demandSnapshot: ComputeDemandSnapshotResult;
  regionDemandSnapshot: ComputeRegionDemandSnapshotResult;
  forecasts: BuildForecastSnapshotResult[];
  durationMs: number;
}

const DEFAULT_HORIZONS = [30, 60, 90];
const DRY_RUN_SAVEPOINT = "sales_forecast_mvp_dry_run";

/**
 * End-to-end happy path used by the CLI:
 * 1. pull the exact orders window needed for the demand snapshot
 * 2. recompute the demand snapshot for `snapshotDate`
 * 3. recompute forecast slices for all requested horizons
 *
 * The CLI itself only parses arguments and bootstraps dependencies.
 * All business sequencing lives here.
 *
 * Dry-run is implemented via a SQLite savepoint + `ROLLBACK TO SAVEPOINT`
 * on the **same** DB connection **after** all steps complete successfully.
 * That rolls back writes to:
 * - `wb_orders_daily` / `wb_orders_daily_by_region` (order import replace-by-day)
 * - `wb_demand_snapshots` / `wb_region_demand_snapshots` (demand replace-by-date)
 * - `wb_forecast_snapshots` (forecast replace per horizon/scope)
 *
 * Rows written **before** the savepoint (e.g. a prior `pnpm import:stocks`
 * in the same file) are unaffected. This gives truthful row counts in the
 * JSON output while leaving the on-disk DB unchanged for this run.
 */
export async function runSalesForecastMvp(
  deps: RunSalesForecastMvpDeps,
  options: RunSalesForecastMvpOptions = {},
): Promise<RunSalesForecastMvpResult> {
  const {
    db,
    wbClient,
    ordersRepository,
    ordersByRegionRepository,
    demandRepository,
    regionDemandRepository,
    stockRepository,
    supplyRepository,
    forecastRepository,
    logger,
  } = deps;
  const now = deps.now ?? (() => new Date());
  const t0 = Date.now();

  const snapshotDate = options.snapshotDate ?? toUtcYmd(now());
  const horizons = normalizeHorizons(options.horizons);
  const dryRun = options.dryRun === true;
  const sku = normalizeOptionalArg(options.sku);
  const warehouse = normalizeOptionalArg(options.warehouse);
  const ordersWindowFrom = addDays(snapshotDate, -30);
  const ordersWindowTo = addDays(snapshotDate, -1);

  logger.info(
    {
      snapshotDate,
      horizons,
      dryRun,
      sku,
      warehouse,
      ordersWindowFrom,
      ordersWindowTo,
    },
    "WB sales forecast MVP: start",
  );

  if (dryRun) {
    db.exec(`SAVEPOINT ${DRY_RUN_SAVEPOINT}`);
  }

  try {
    const ordersImport = await importWbOrders(
      {
        wbClient,
        repository: ordersRepository,
        ordersByRegionRepository,
        logger,
        now,
      },
      {
        dateFrom: ordersWindowFrom,
        dateTo: ordersWindowTo,
        dryRun: false,
      },
    );

    logger.info(
      {
        dateFrom: ordersImport.dateFrom,
        dateTo: ordersImport.dateTo,
        pages: ordersImport.pages,
        fetchedRows: ordersImport.fetchedRows,
        validRows: ordersImport.validRows,
        rowsInserted: ordersImport.rowsInserted,
        rowsDeleted: ordersImport.rowsDeleted,
        daysReplaced: ordersImport.daysReplaced,
      },
      "WB sales forecast MVP: orders imported",
    );

    const demandSnapshot = await computeDemandSnapshot(
      {
        ordersRepository,
        demandRepository,
        logger,
        now,
      },
      {
        snapshotDate,
        dryRun: false,
      },
    );

    logger.info(
      {
        snapshotDate: demandSnapshot.snapshotDate,
        windowFrom: demandSnapshot.windowFrom,
        windowTo: demandSnapshot.windowTo,
        demandRows: demandSnapshot.demandRows,
        rowsInserted: demandSnapshot.rowsInserted,
        rowsDeleted: demandSnapshot.rowsDeleted,
      },
      "WB sales forecast MVP: demand snapshot computed",
    );

    const regionDemandSnapshot = await computeRegionDemandSnapshot(
      {
        ordersByRegionRepository,
        regionDemandRepository,
        logger,
        now,
      },
      { snapshotDate, dryRun: false },
    );

    logger.info(
      {
        snapshotDate: regionDemandSnapshot.snapshotDate,
        windowFrom: regionDemandSnapshot.windowFrom,
        windowTo: regionDemandSnapshot.windowTo,
        demandRows: regionDemandSnapshot.demandRows,
        rowsInserted: regionDemandSnapshot.rowsInserted,
        rowsDeleted: regionDemandSnapshot.rowsDeleted,
      },
      "WB sales forecast MVP: region demand snapshot computed",
    );

    const forecasts: BuildForecastSnapshotResult[] = [];
    for (const horizonDays of horizons) {
      const forecast = await buildForecastSnapshot(
        {
          stockRepository,
          demandRepository,
          supplyRepository,
          forecastRepository,
          logger,
          now,
        },
        {
          snapshotDate,
          horizonDays,
          sku: sku ?? undefined,
          warehouse: warehouse ?? undefined,
          dryRun: false,
        },
      );
      forecasts.push(forecast);
      logger.info(
        {
          horizonDays,
          demandRows: forecast.demandRows,
          forecastRows: forecast.forecastRows,
          rowsInserted: forecast.rowsInserted,
          rowsDeleted: forecast.rowsDeleted,
          skipped: forecast.skipped,
          stockSnapshotAt: forecast.stockSnapshotAt,
        },
        "WB sales forecast MVP: forecast snapshot computed",
      );
    }

    const result: RunSalesForecastMvpResult = {
      snapshotDate,
      horizons,
      dryRun,
      sku,
      warehouse,
      ordersWindowFrom,
      ordersWindowTo,
      ordersImport: patchDryRunFlag(ordersImport, dryRun),
      demandSnapshot: patchDryRunFlag(demandSnapshot, dryRun),
      regionDemandSnapshot: patchDryRunFlag(regionDemandSnapshot, dryRun),
      forecasts: forecasts.map((forecast) => patchDryRunFlag(forecast, dryRun)),
      durationMs: Date.now() - t0,
    };

    logger.info(result, "WB sales forecast MVP: done");
    return result;
  } finally {
    if (dryRun) {
      db.exec(`ROLLBACK TO SAVEPOINT ${DRY_RUN_SAVEPOINT}`);
      db.exec(`RELEASE SAVEPOINT ${DRY_RUN_SAVEPOINT}`);
    }
  }
}

function normalizeHorizons(horizons: readonly number[] | undefined): number[] {
  const raw = horizons ?? DEFAULT_HORIZONS;
  const normalized = Array.from(
    new Set(
      raw.map((h) => {
        if (!Number.isInteger(h) || h <= 0) {
          throw new Error(
            `runSalesForecastMvp: horizon must be a positive integer, got ${h}`,
          );
        }
        return h;
      }),
    ),
  );
  normalized.sort((a, b) => a - b);
  return normalized;
}

function normalizeOptionalArg(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

function patchDryRunFlag<T extends { dryRun: boolean }>(value: T, dryRun: boolean): T {
  return { ...value, dryRun };
}

function toUtcYmd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  const t = Date.UTC(y, m - 1, d) + days * 24 * 60 * 60 * 1000;
  return toUtcYmd(new Date(t));
}
