import { riskBucketFromDaysOfStock } from "../domain/forecastRiskBucket.js";
import {
  daysOfStockWbFromNetworkTotals,
  systemStockoutDateEstimateFromSnapshot,
} from "../domain/multiLevelInventory.js";
import {
  getMacroRegionByRegionKey,
} from "../domain/wbRegionMacroRegion.js";
import {
  getWarehouseMacroRegion,
  getWarehouseRegistryEntry,
  warehouseContributesToRegionalAvailabilityStock,
} from "../domain/wbWarehouseMacroRegion.js";
import { normalizeWarehouseName } from "../domain/warehouseName.js";
import type { ForecastRiskBucket } from "../domain/forecastRiskBucket.js";
import type { RiskStockoutFilter } from "./forecast-report/forecastReportTypes.js";
import {
  aggregatedRiskStockoutMatches,
  skuKey,
} from "./forecast-report/forecastReportQueryHelpers.js";

export interface RegionalStocksStockInputRow {
  warehouseKey: string;
  nmId: number;
  techSize: string;
  vendorCode: string | null;
  startStock: number;
  incomingUnits: number;
  stockSnapshotAt: string | null;
}

export interface RegionalStocksDemandInputRow {
  regionKey: string;
  nmId: number;
  techSize: string;
  vendorCode: string | null;
  regionalForecastDailyDemand: number;
}

export interface RegionalStocksReportRow {
  nmId: number;
  techSize: string;
  vendorCode: string | null;
  risk: ForecastRiskBucket;
  regionalStartStock: number;
  regionalIncomingUnits: number;
  regionalAvailable: number;
  regionalForecastDailyDemand: number;
  daysOfStockRegional: number;
  stockoutDateEstimate: string | null;
  recommendedToRegion: number;
  /**
   * Quantity at our own (default "main") warehouse, looked up by `vendorCode`
   * from the latest own-stock snapshot. `0` if the SKU is missing from the
   * snapshot or has no vendor code.
   */
  ownWarehouseStock: number;
  /**
   * Suggested ship-to-WB quantity for this SKU under the regional plan.
   *
   * Defined as `min(recommendedToRegion, ownWarehouseStock)` per product
   * decision: мы не можем отгрузить в регион больше, чем лежит у нас на
   * собственном складе, и одновременно не хотим отгружать больше, чем
   * реально нужно региону (`recommendedToRegion`). Минимум — это то
   * количество, которое одновременно «закрывает» регион и реально доступно
   * к отгрузке прямо сейчас.
   */
  recommendedOrderQty: number;
  stockSnapshotAtMin: string | null;
}

export interface RegionalStocksReportSummary {
  totalRows: number;
  risk: {
    critical: number;
    warning: number;
    attention: number;
    ok: number;
  };
  recommendedToRegionTotal: number;
  ownWarehouseStockTotal: number;
  recommendedOrderQtyTotal: number;
}

export interface RegionalStocksReport {
  snapshotDate: string;
  horizonDays: number;
  macroRegion: string;
  targetCoverageDays: number;
  ownWarehouseCode: string;
  summary: RegionalStocksReportSummary;
  rows: RegionalStocksReportRow[];
}

export interface BuildRegionalStocksReportInput {
  snapshotDate: string;
  horizonDays: number;
  macroRegion: string;
  targetCoverageDays: number;
  riskStockout?: RiskStockoutFilter;
  q?: string | null;
  limit?: number;
  stockRows: readonly RegionalStocksStockInputRow[];
  demandRows: readonly RegionalStocksDemandInputRow[];
  regionMacroLookup: ReadonlyMap<string, string>;
  /**
   * vendorCode → quantity at our own warehouse for the relevant snapshot.
   * Defaults to an empty map (i.e. ownWarehouseStock is 0 everywhere).
   */
  ownStockByVendor?: ReadonlyMap<string, number>;
  /**
   * Identifier of the own warehouse that {@link ownStockByVendor} was
   * loaded for. Echoed into the report so that consumers (UI, CSV) can
   * label the column. Defaults to "main".
   */
  ownWarehouseCode?: string;
}

interface RegionalStockAccumulator {
  nmId: number;
  techSize: string;
  vendorCode: string | null;
  regionalStartStock: number;
  regionalIncomingUnits: number;
  stockSnapshotAtMin: string | null;
}

interface RegionalDemandAccumulator {
  nmId: number;
  techSize: string;
  vendorCode: string | null;
  regionalForecastDailyDemand: number;
}

function betterVendorCode(
  current: string | null,
  next: string | null,
): string | null {
  const c = current?.trim() ?? "";
  if (c) return current;
  const n = next?.trim() ?? "";
  return n ? next : current;
}

function matchesSearch(row: RegionalStocksReportRow, q: string | null | undefined): boolean {
  const needle = q?.trim().toLocaleLowerCase("ru") ?? "";
  if (!needle) return true;
  return (
    String(row.nmId).includes(needle) ||
    (row.vendorCode ?? "").toLocaleLowerCase("ru").includes(needle)
  );
}

function buildSummary(rows: readonly RegionalStocksReportRow[]): RegionalStocksReportSummary {
  const summary: RegionalStocksReportSummary = {
    totalRows: rows.length,
    risk: { critical: 0, warning: 0, attention: 0, ok: 0 },
    recommendedToRegionTotal: 0,
    ownWarehouseStockTotal: 0,
    recommendedOrderQtyTotal: 0,
  };
  for (const r of rows) {
    summary.risk[r.risk] += 1;
    summary.recommendedToRegionTotal += r.recommendedToRegion;
    summary.ownWarehouseStockTotal += r.ownWarehouseStock;
    summary.recommendedOrderQtyTotal += r.recommendedOrderQty;
  }
  return summary;
}

function ownWarehouseStockForVendor(
  vendorCode: string | null,
  ownStockByVendor: ReadonlyMap<string, number> | undefined,
): number {
  if (!ownStockByVendor || ownStockByVendor.size === 0) return 0;
  const v = vendorCode?.trim();
  if (!v) return 0;
  const q = ownStockByVendor.get(v);
  return Number.isFinite(q) ? Math.max(0, Math.trunc(Number(q))) : 0;
}

export function buildRegionalStocksReport(
  input: BuildRegionalStocksReportInput,
): RegionalStocksReport {
  const stockBySku = new Map<string, RegionalStockAccumulator>();
  for (const row of input.stockRows) {
    const macro = getWarehouseMacroRegion(row.warehouseKey);
    if (macro !== input.macroRegion) continue;
    const normalizedWarehouseKey = normalizeWarehouseName(row.warehouseKey);
    if (
      !warehouseContributesToRegionalAvailabilityStock(
        getWarehouseRegistryEntry(row.warehouseKey),
        normalizedWarehouseKey,
      )
    ) {
      continue;
    }

    const key = skuKey(row.nmId, row.techSize);
    let acc = stockBySku.get(key);
    if (!acc) {
      acc = {
        nmId: row.nmId,
        techSize: row.techSize,
        vendorCode: row.vendorCode,
        regionalStartStock: 0,
        regionalIncomingUnits: 0,
        stockSnapshotAtMin: row.stockSnapshotAt,
      };
      stockBySku.set(key, acc);
    }
    acc.vendorCode = betterVendorCode(acc.vendorCode, row.vendorCode);
    acc.regionalStartStock += Number(row.startStock ?? 0);
    acc.regionalIncomingUnits += Number(row.incomingUnits ?? 0);
    const sn = row.stockSnapshotAt?.trim() || null;
    if (sn && (acc.stockSnapshotAtMin === null || sn < acc.stockSnapshotAtMin)) {
      acc.stockSnapshotAtMin = sn;
    }
  }

  const demandBySku = new Map<string, RegionalDemandAccumulator>();
  for (const row of input.demandRows) {
    const macro = getMacroRegionByRegionKey(row.regionKey, input.regionMacroLookup);
    if (macro !== input.macroRegion) continue;
    const key = skuKey(row.nmId, row.techSize);
    let acc = demandBySku.get(key);
    if (!acc) {
      acc = {
        nmId: row.nmId,
        techSize: row.techSize,
        vendorCode: row.vendorCode,
        regionalForecastDailyDemand: 0,
      };
      demandBySku.set(key, acc);
    }
    acc.vendorCode = betterVendorCode(acc.vendorCode, row.vendorCode);
    acc.regionalForecastDailyDemand += Number(row.regionalForecastDailyDemand ?? 0);
  }

  const keys = new Set<string>([...stockBySku.keys(), ...demandBySku.keys()]);
  const allRows: RegionalStocksReportRow[] = [];
  for (const key of keys) {
    const s = stockBySku.get(key);
    const d = demandBySku.get(key);
    const nmId = d?.nmId ?? s?.nmId;
    if (nmId === undefined) continue;
    const techSize = d?.techSize ?? s?.techSize ?? "";
    const regionalStartStock = s?.regionalStartStock ?? 0;
    const regionalIncomingUnits = s?.regionalIncomingUnits ?? 0;
    const regionalAvailable = regionalStartStock + regionalIncomingUnits;
    const regionalForecastDailyDemand = d?.regionalForecastDailyDemand ?? 0;
    if (regionalAvailable <= 0 && regionalForecastDailyDemand <= 0) {
      continue;
    }
    const daysOfStockRegional = daysOfStockWbFromNetworkTotals(
      regionalAvailable,
      regionalForecastDailyDemand,
    );
    const recommendedToRegion = Math.max(
      0,
      Math.ceil(input.targetCoverageDays * regionalForecastDailyDemand - regionalAvailable),
    );
    const risk = riskBucketFromDaysOfStock(
      Math.min(999_999, Math.floor(daysOfStockRegional)),
    );
    const vendorCode = betterVendorCode(
      d?.vendorCode ?? null,
      s?.vendorCode ?? null,
    );
    const ownWarehouseStock = ownWarehouseStockForVendor(
      vendorCode,
      input.ownStockByVendor,
    );
    const recommendedOrderQty = Math.min(recommendedToRegion, ownWarehouseStock);
    allRows.push({
      nmId,
      techSize,
      vendorCode,
      risk,
      regionalStartStock,
      regionalIncomingUnits,
      regionalAvailable,
      regionalForecastDailyDemand,
      daysOfStockRegional,
      stockoutDateEstimate: systemStockoutDateEstimateFromSnapshot(
        input.snapshotDate,
        daysOfStockRegional,
        regionalForecastDailyDemand,
      ),
      recommendedToRegion,
      ownWarehouseStock,
      recommendedOrderQty,
      stockSnapshotAtMin: s?.stockSnapshotAtMin ?? null,
    });
  }

  const riskFilter = input.riskStockout ?? "all";
  const filtered = allRows
    .filter((r) => aggregatedRiskStockoutMatches(r.daysOfStockRegional, riskFilter))
    .filter((r) => matchesSearch(r, input.q))
    .sort((a, b) => {
      const days = a.daysOfStockRegional - b.daysOfStockRegional;
      if (days !== 0) return days;
      const demand = b.regionalForecastDailyDemand - a.regionalForecastDailyDemand;
      if (demand !== 0) return demand;
      const vendor = (a.vendorCode ?? "").localeCompare(b.vendorCode ?? "", "ru");
      if (vendor !== 0) return vendor;
      const nm = a.nmId - b.nmId;
      if (nm !== 0) return nm;
      return a.techSize.localeCompare(b.techSize, "ru");
    });

  const limited =
    input.limit !== undefined && input.limit > 0
      ? filtered.slice(0, input.limit)
      : filtered;

  return {
    snapshotDate: input.snapshotDate,
    horizonDays: input.horizonDays,
    macroRegion: input.macroRegion,
    targetCoverageDays: input.targetCoverageDays,
    ownWarehouseCode: input.ownWarehouseCode?.trim() || "main",
    summary: buildSummary(filtered),
    rows: limited,
  };
}
