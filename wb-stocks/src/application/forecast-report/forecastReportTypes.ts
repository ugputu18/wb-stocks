import type { WbForecastSnapshotRecord } from "../../domain/wbForecastSnapshot.js";
import type { ForecastRiskBucket } from "../../domain/forecastRiskBucket.js";
import type {
  InventoryLevelsReadModel,
  ReplenishmentMode,
  WbRowReplenishmentReadModel,
} from "../../domain/multiLevelInventory.js";

/** Scope for partial replace of forecast rows (CLI / recompute by SKU or warehouse). */
export interface ForecastSnapshotScope {
  warehouseKey?: string;
  nmId?: number;
  vendorCode?: string;
}

export type { ReplenishmentMode };

export type RiskStockoutFilter =
  | "all"
  | "lt7"
  | "lt14"
  | "lt30"
  | "lt45"
  | "lt60";

export interface ForecastReportFilter {
  warehouseKey?: string | null;
  /** Vendor fragment or nmId digits — see `buildReportWhere`. */
  q?: string | null;
  /**
   * Узкий фильтр по `tech_size`, если **`q` — только цифры (nm_id)**.
   * Используется для drilldown «WB в целом» → строки по складам по одному SKU.
   */
  techSize?: string | null;
  /**
   * Narrow rows by `days_of_stock` (операционный «риск окончания»):
   * - lt7: &lt; 7 — совпадает с bucket critical
   * - lt14: &lt; 14 — critical + warning
   * - lt30: &lt; 30 — critical + warning + attention
   * - lt45 / lt60: &lt; 45 / &lt; 60 — расширенный узкий фильтр (read-side)
   */
  riskStockout?: RiskStockoutFilter | null;
  /** Если задан — в строках и в aggregate добавляется read-side replenishment. */
  replenishmentTargetCoverageDays?: number;
  /** Какой KPI суммарно подсвечивать в UI (оба значения всегда считаются). */
  replenishmentMode?: ReplenishmentMode | null;
  /** Код нашего склада в `own_stock_snapshots` (default `main`). */
  ownWarehouseCode?: string | null;
  /** Lead time для плана заказа у поставщика (дней), query `leadTimeDays`. Default 45. */
  supplierLeadTimeDays?: number;
  /** Покрытие после прихода для плана заказа (дней), query `coverageDays`. Default 90. */
  supplierOrderCoverageDays?: number;
  /** Страховые дни в целевом покрытии после прихода, query `safetyDays`. Default 0. */
  supplierSafetyDays?: number;
  /**
   * Вид основной таблицы: `systemTotal` — default в forecast UI / parse (пустой query);
   * `wbTotal` — одна строка на SKU, риск по WB; `wbWarehouses` — строки `warehouse × sku`.
   */
  viewMode?: ForecastViewMode | null;
  /**
   * Только для `viewMode=systemTotal`: быстрый read-side фильтр строк после полного расчёта SKU.
   * Не в SQL — те же строки, что и KPI при `aggregateReportMetrics`.
   */
  systemTotalQuickFilter?:
    | "all"
    | "systemRisk"
    | "supplierOrder"
    | "wbReplenish"
    | null;
}

export interface WbForecastSnapshotReportRow extends WbForecastSnapshotRecord {
  risk: ForecastRiskBucket;
  inventoryLevels: InventoryLevelsReadModel;
  replenishment?: WbRowReplenishmentReadModel;
}

/** Режим основной таблицы forecast UI. */
export type ForecastViewMode = "wbTotal" | "wbWarehouses" | "systemTotal";

/**
 * Одна строка = SKU по всей сети WB (read-side GROUP BY `nm_id`, `tech_size`).
 * `daysOfStockWB` = `wbAvailableTotal / forecastDailyDemandTotal` (при нулевом спросе — см. домен).
 */
export interface WbTotalBySkuReportRow {
  viewKind: "wbTotal";
  nmId: number;
  techSize: string;
  vendorCode: string | null;
  daysOfStockWB: number;
  stockoutDateWB: string | null;
  /** Минимум `stock_snapshot_at` по складам для SKU. */
  stockSnapshotAtWB: string;
  forecastDailyDemandTotal: number;
  wbAvailableTotal: number;
  /** Σ start_stock по складам WB для SKU. */
  wbStartStockTotal: number;
  /** Σ incoming_units (горизонт) по складам WB для SKU. */
  wbIncomingUnitsTotal: number;
  ownStock: number;
  risk: ForecastRiskBucket;
  inventoryLevels: InventoryLevelsReadModel;
  replenishment?: WbRowReplenishmentReadModel;
  /** Согласовано с supplier-level `recommendedFromSupplier` для того же SKU и `targetCoverageDays`. */
  recommendedFromSupplier: number;
}

/**
 * Одна строка = SKU: риск и дни запаса по **системному** пулу (WB∑ + own), read-side.
 * `recommendedToWB` / `recommendedFromSupplier` / `recommendedOrderQty` — те же величины, что в режимах WB total и supplier-витрине (без двойного суммирования).
 */
export interface SystemTotalBySkuReportRow {
  viewKind: "systemTotal";
  nmId: number;
  techSize: string;
  vendorCode: string | null;
  /** `systemAvailable / Σ спрос` (см. `daysOfStockSystemFromNetworkTotals`). */
  daysOfStockSystem: number;
  /**
   * Оценка даты OOS по пулу system: `snapshot_date` + `floor(daysOfStockSystem)` календарных дней
   * при `forecastDailyDemandTotal > 0`; согласована с **Дн. system**. Не `MIN(stockout_date)` по WB.
   */
  systemStockoutDateEstimate: string | null;
  stockSnapshotAtSystem: string;
  forecastDailyDemandTotal: number;
  wbAvailableTotal: number;
  /** Σ start_stock по складам WB для SKU. */
  wbStartStockTotal: number;
  /** Σ incoming_units (горизонт) по складам WB для SKU. */
  wbIncomingUnitsTotal: number;
  ownStock: number;
  risk: ForecastRiskBucket;
  inventoryLevels: InventoryLevelsReadModel;
  replenishment?: WbRowReplenishmentReadModel;
  recommendedFromSupplier: number;
  /** Из той же строки supplier-plan, что `/supplier-replenishment` для SKU. */
  recommendedOrderQty: number;
  willStockoutBeforeArrival: boolean;
}

export interface ForecastReportAggregate {
  totalRows: number;
  risk: {
    critical: number;
    warning: number;
    attention: number;
    ok: number;
  };
  staleStockRowCount: number;
  oldestStockSnapshotAt: string | null;
  newestStockSnapshotAt: string | null;
  replenishment?: {
    targetCoverageDays: number;
    replenishmentMode: ReplenishmentMode;
    ownWarehouseCode: string;
    recommendedToWBTotal: number;
    recommendedFromSupplierTotal: number;
    recommendedOrderQtyTotal: number;
    leadTimeDays: number;
    orderCoverageDays: number;
    safetyDays: number;
  };
}
