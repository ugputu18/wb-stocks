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
