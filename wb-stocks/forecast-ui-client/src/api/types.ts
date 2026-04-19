/** Minimal shapes for phase 0–1; align with server JSON. */

export type ForecastViewMode = "wbTotal" | "wbWarehouses" | "systemTotal";

export type SystemQuickFilter =
  | "all"
  | "systemRisk"
  | "supplierOrder"
  | "wbReplenish";

export interface ForecastSummaryReplenishment {
  replenishmentMode?: string;
  replenishmentTargetCoverageDays?: number;
  recommendedToWBTotal?: number;
  recommendedFromSupplierTotal?: number;
  recommendedOrderQtyTotal?: number;
  ownWarehouseCode?: string;
}

export interface ForecastSummaryResponse {
  snapshotDate?: string;
  horizonDays?: number;
  viewMode?: string;
  totalRows?: number;
  risk?: {
    critical: number;
    warning: number;
    attention: number;
    ok: number;
  };
  staleStockRowCount?: number;
  oldestStockSnapshotAt?: string | null;
  newestStockSnapshotAt?: string | null;
  replenishment?: ForecastSummaryReplenishment;
  [key: string]: unknown;
}

export interface ForecastRowsResponse {
  snapshotDate?: string;
  horizonDays?: number;
  viewMode?: string;
  limit?: number;
  rows?: unknown[];
  [key: string]: unknown;
}

export interface SupplierReplenishmentResponse {
  rows?: unknown[];
  targetCoverageDays?: number;
  [key: string]: unknown;
}

export interface WarehouseKeysResponse {
  warehouseKeys: string[];
}

/** POST /api/forecast/regional-demand — снимок спроса по регионам заказа + явный mapping регион заказа → регион (кластер). */
export interface RegionalDemandResponse {
  snapshotDate?: string;
  rows?: Array<{
    regionKey: string;
    regionNameRaw?: string | null;
    nmId: number;
    techSize: string;
    regionalForecastDailyDemand: number;
  }>;
  regionMacroMap?: Record<string, string>;
}

/** GET /api/forecast/warehouse-region-audit */
export interface WarehouseRegionAuditResponse {
  snapshotDate: string;
  horizonDays: number;
  totals: {
    warehouseCount: number;
    mappedWarehouseCount: number;
    unmappedWarehouseCount: number;
    rowCount: number;
    mappedRowCount: number;
    unmappedRowCount: number;
    sumForecastDailyDemand: number;
    mappedSumForecastDailyDemand: number;
    unmappedSumForecastDailyDemand: number;
    sumStartStock: number;
    mappedSumStartStock: number;
    unmappedSumStartStock: number;
    unmappedForecastShare: number;
    unmappedRowShare: number;
  };
  warehouses: Array<{
    warehouseKey: string;
    warehouseNameRaw: string | null;
    rowCount: number;
    sumForecastDailyDemand: number;
    sumStartStock: number;
    sumIncomingUnits: number;
    macroRegion: string | null;
    mapped: boolean;
  }>;
  unmappedSortedByForecast: Array<{
    warehouseKey: string;
    warehouseNameRaw: string | null;
    rowCount: number;
    sumForecastDailyDemand: number;
    sumStartStock: number;
    sumIncomingUnits: number;
    macroRegion: string | null;
    mapped: boolean;
  }>;
  macroRegionTotals: Array<{
    macroRegion: string;
    warehouseCount: number;
    rowCount: number;
    sumForecastDailyDemand: number;
    sumStartStock: number;
  }>;
  clusterTotals: Array<{
    clusterId: string;
    clusterLabel: string;
    warehouseCount: number;
    rowCount: number;
    sumForecastDailyDemand: number;
    sumStartStock: number;
  }>;
}

/** GET /api/forecast/regional-vs-warehouse-summary */
export interface RegionalVsWarehouseSummaryResponse {
  snapshotDate: string;
  horizonDays: number;
  regionalTotals: Array<{
    regionKey: string;
    regionNameRaw: string | null;
    regionalForecastDailyDemand: number;
    shareOfRegionalTotal: number;
  }>;
  warehouseMacroRegionTotals: Array<{
    macroRegion: string;
    fulfillmentForecastDailyDemand: number;
    shareOfFulfillmentTotal: number;
  }>;
  comparisonByMacroRegion: Array<{
    macroRegion: string;
    regionalDemand: number;
    fulfillmentDemand: number;
    regionalShare: number;
    fulfillmentShare: number;
    gap: number;
    gapShare: number;
  }>;
  totals: {
    regionalTotalDemand: number;
    fulfillmentTotalDemand: number;
    regionalMappedDemand: number;
    regionalMappedShareOfRegional: number;
    regionalUnmappedDemand: number;
    regionalUnmappedShareOfRegional: number;
  };
  unmappedRegionalTotals: Array<{
    regionKey: string;
    regionNameRaw: string | null;
    regionalForecastDailyDemand: number;
    shareOfRegionalTotal: number;
    status: "Не сопоставлен";
  }>;
}
