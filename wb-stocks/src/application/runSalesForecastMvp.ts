import type { Logger } from "pino";
import type { DbHandle } from "../infra/db.js";
import type { WbStatsClient } from "../infra/wbStatsClient.js";
import type { WbOrdersDailyRepository } from "../infra/wbOrdersDailyRepository.js";
import type { WbOrdersDailyByRegionRepository } from "../infra/wbOrdersDailyByRegionRepository.js";
import type { WbDemandSnapshotRepository } from "../infra/wbDemandSnapshotRepository.js";
import type { WbRegionDemandSnapshotRepository } from "../infra/wbRegionDemandSnapshotRepository.js";
import type { StockSnapshotRepository } from "../infra/stockSnapshotRepository.js";
import type { WbProductCatalogRepository } from "../infra/wbProductCatalogRepository.js";
import type { OwnStockSnapshotRepository } from "../infra/ownStockSnapshotRepository.js";
import type { WbSupplyRepository } from "../infra/wbSupplyRepository.js";
import type { WbForecastSnapshotRepository } from "../infra/wbForecastSnapshotRepository.js";
import type { OpticoreReportsClient } from "../infra/opticoreReportsClient.js";
import {
  importWbOrders,
  type ImportWbOrdersResult,
} from "./importWbOrders.js";
import {
  importWbStocks,
  type ImportWbStocksResult,
} from "./importWbStocks.js";
import {
  importOpticoreStock,
  type ImportOpticoreStockOptions,
  type ImportOpticoreStockResult,
} from "./importOpticoreStock.js";
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
  productCatalogRepository?: WbProductCatalogRepository;
  ownStockRepository?: OwnStockSnapshotRepository;
  supplyRepository: WbSupplyRepository;
  forecastRepository: WbForecastSnapshotRepository;
  opticoreClient?: OpticoreReportsClient;
  opticoreStockOptions?: Omit<ImportOpticoreStockOptions, "date">;
  opticoreStockFailureMode?: "warn" | "fail";
  logger: Logger;
  now?: () => Date;
}

export interface RunSalesForecastMvpOptions {
  snapshotDate?: string;
  horizons?: readonly number[];
  dryRun?: boolean;
  sku?: string;
  warehouse?: string;
  /**
   * Подтягивать ли свежие остатки WB перед пересчётом demand/forecast.
   * `true` (по умолчанию) — добавляет в pipeline вызов `importWbStocks`,
   * чтобы forecast пинил свежий `wb_stock_snapshots.snapshot_at`.
   *
   * Работает идемпотентно: импорт стоков — append-only по `snapshot_at`
   * (≈ now()), история сохраняется. Forecast выберет новый снэпшот
   * только если `snapshotDate` >= даты импорта (по UTC end-of-day),
   * поэтому для прошлых дат свежий импорт не повлияет на forecast,
   * но будет лежать в БД.
   */
  refreshStocks?: boolean;
  /**
   * Подтягивать ли свежий остаток собственного склада из OptiCore.
   * Шаг выполняется только когда OptiCore-клиент и репозиторий склада
   * переданы в deps; иначе считается отключённым.
   */
  refreshOwnStock?: boolean;
}

export interface RunSalesForecastMvpResult {
  snapshotDate: string;
  horizons: number[];
  dryRun: boolean;
  sku: string | null;
  warehouse: string | null;
  ordersWindowFrom: string;
  ordersWindowTo: string;
  /** `null`, если `refreshStocks=false`. */
  stockImport: ImportWbStocksResult | null;
  /** `null`, если OptiCore не настроен или `refreshOwnStock=false`. */
  ownStockImport: ImportOpticoreStockResult | null;
  /** Заполняется при `opticoreStockFailureMode=warn`, чтобы общий апдейт не падал из-за склада. */
  ownStockImportError: string | null;
  ordersImport: ImportWbOrdersResult;
  demandSnapshot: ComputeDemandSnapshotResult;
  regionDemandSnapshot: ComputeRegionDemandSnapshotResult;
  forecasts: BuildForecastSnapshotResult[];
  durationMs: number;
}

const DEFAULT_HORIZONS = [30, 60, 90];
const DRY_RUN_SAVEPOINT = "sales_forecast_mvp_dry_run";
const DEMAND_LOOKBACK_DAYS = 90;
const ORDERS_IMPORT_MAX_PAGES = 30;

/**
 * End-to-end happy path used by the CLI и UI «Обновить данные WB»:
 * 0. (опц.) подтянуть свежий снэпшот остатков WB (`importWbStocks`),
 *    чтобы forecast мог пиниться от свежего `wb_stock_snapshots.snapshot_at`
 * 0b. (опц.) подтянуть свежий снэпшот собственного склада из OptiCore
 *     в `own_stock_snapshots`, чтобы supplier/складская витрина видела
 *     актуальный `ownStock` сразу после общего обновления
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
 * - `wb_stock_snapshots` (новый append-only snapshot, созданный шагом 0)
 * - `own_stock_snapshots` (OptiCore replace-by-date snapshot, созданный шагом 0b)
 * - `wb_orders_daily` / `wb_orders_daily_by_region` (order import replace-by-day)
 * - `wb_demand_snapshots` / `wb_region_demand_snapshots` (demand replace-by-date)
 * - `wb_forecast_snapshots` (forecast replace per horizon/scope)
 *
 * Rows written **before** the savepoint (например, более ранний
 * `pnpm import:stocks` или существующие исторические снэпшоты) не
 * затрагиваются. Это даёт честные row counts в JSON-ответе, а на диске
 * после dry-run БД остаётся в исходном виде.
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
    productCatalogRepository,
    ownStockRepository,
    supplyRepository,
    forecastRepository,
    opticoreClient,
    opticoreStockOptions,
    opticoreStockFailureMode = "warn",
    logger,
  } = deps;
  const now = deps.now ?? (() => new Date());
  const t0 = Date.now();

  const snapshotDate = options.snapshotDate ?? toUtcYmd(now());
  const horizons = normalizeHorizons(options.horizons);
  const dryRun = options.dryRun === true;
  const sku = normalizeOptionalArg(options.sku);
  const warehouse = normalizeOptionalArg(options.warehouse);
  const refreshStocks = options.refreshStocks !== false;
  const refreshOwnStockRequested = options.refreshOwnStock !== false;
  const refreshOwnStock =
    refreshOwnStockRequested && opticoreClient !== undefined && ownStockRepository !== undefined;
  const ordersWindowFrom = addDays(snapshotDate, -DEMAND_LOOKBACK_DAYS);
  const ordersWindowTo = addDays(snapshotDate, -1);

  logger.info(
    {
      snapshotDate,
      horizons,
      dryRun,
      sku,
      warehouse,
      refreshStocks,
      refreshOwnStock,
      ordersWindowFrom,
      ordersWindowTo,
    },
    "WB sales forecast MVP: start",
  );

  if (dryRun) {
    db.exec(`SAVEPOINT ${DRY_RUN_SAVEPOINT}`);
  }

  try {
    let stockImport: ImportWbStocksResult | null = null;
    if (refreshStocks) {
      stockImport = await importWbStocks(
        {
          wbClient,
          repository: stockRepository,
          productCatalogRepository,
          logger,
          now,
        },
        {},
      );
      logger.info(
        {
          snapshotAt: stockImport.snapshotAt,
          fetched: stockImport.fetched,
          inserted: stockImport.inserted,
          skipped: stockImport.skipped,
        },
        "WB sales forecast MVP: stocks refreshed",
      );
    }

    let ownStockImport: ImportOpticoreStockResult | null = null;
    let ownStockImportError: string | null = null;
    if (refreshOwnStockRequested && !refreshOwnStock) {
      ownStockImportError =
        "OptiCore stock refresh is not configured: set OPTICORE_REPORTS_URL (or OPTICORE_BASE_URL), OPTICORE_USER and OPTICORE_PASSWORD in the server environment.";
      logger.warn(
        {
          hasOpticoreClient: opticoreClient !== undefined,
          hasOwnStockRepository: ownStockRepository !== undefined,
        },
        "WB sales forecast MVP: OptiCore own stock refresh skipped",
      );
    }
    if (refreshOwnStock && opticoreClient && ownStockRepository) {
      try {
        ownStockImport = await importOpticoreStock(
          {
            client: opticoreClient,
            repository: ownStockRepository,
            logger,
            now,
          },
          {
            ...opticoreStockOptions,
            date: snapshotDate,
          },
        );
        logger.info(
          {
            snapshotDate: ownStockImport.snapshotDate,
            warehouseCode: ownStockImport.warehouseCode,
            fetched: ownStockImport.fetched,
            filteredOut: ownStockImport.filteredOut,
            inserted: ownStockImport.inserted,
            skipped: ownStockImport.skipped,
          },
          "WB sales forecast MVP: own warehouse stock refreshed from OptiCore",
        );
      } catch (err) {
        ownStockImportError = err instanceof Error ? err.message : String(err);
        logger.warn(
          { err, failureMode: opticoreStockFailureMode },
          "WB sales forecast MVP: OptiCore own stock refresh failed",
        );
        if (opticoreStockFailureMode === "fail") throw err;
      }
    }

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
        maxPages: ORDERS_IMPORT_MAX_PAGES,
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
        stockRepository,
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
        stockRepository,
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
      stockImport,
      ownStockImport,
      ownStockImportError,
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
