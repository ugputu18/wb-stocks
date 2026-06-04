import { riskBucketFromDaysOfStock } from "../domain/forecastRiskBucket.js";
import {
  daysOfStockWbFromNetworkTotals,
  systemStockoutDateEstimateFromSnapshot,
} from "../domain/multiLevelInventory.js";
import {
  roundRegionalShipmentToBoxes,
  roundUpToBoxUnits,
  unitsPerBoxForVendor,
} from "../domain/productQuant.js";
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
import type { WbProductCatalogRecord } from "../domain/stockSnapshot.js";
import type { RiskStockoutFilter } from "./forecast-report/forecastReportTypes.js";
import {
  aggregatedRiskStockoutMatches,
  skuKey,
} from "./forecast-report/forecastReportQueryHelpers.js";

export type RegionalStocksScope = "region" | "wb" | "wbWithOwn";

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
  category: string | null;
  subject: string | null;
  brand: string | null;
  productName: string | null;
  risk: ForecastRiskBucket;
  regionalStartStock: number;
  regionalIncomingUnits: number;
  regionalAvailable: number;
  regionalForecastDailyDemand: number;
  daysOfStockRegional: number;
  stockoutDateEstimate: string | null;
  /**
   * Suggested missing quantity for this SKU under the regional plan, rounded
   * up to full boxes.
   */
  recommendedToRegion: number;
  /** Кол-во единиц товара в коробе. `1` означает "нет округления". */
  unitsPerBox: number;
  /**
   * Quantity at our own (default "main") warehouse, looked up by `vendorCode`
   * from the latest own-stock snapshot. `0` if the SKU is missing from the
   * snapshot or has no vendor code.
   */
  ownWarehouseStock: number;
  /**
   * Suggested ship-to-WB quantity for this SKU under the regional plan.
   *
   * Defined as full boxes only:
   * `min(ceil(recommendedToRegion / unitsPerBox),
   * floor(ownWarehouseStock / unitsPerBox)) * unitsPerBox`.
   */
  recommendedOrderQty: number;
  salePrice: number | null;
  projectedRevenue: number;
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
  wbAvailableTotal: number;
  wbProjectedConsumptionTotal: number;
  recommendedToRegionTotal: number;
  ownWarehouseStockTotal: number;
  recommendedOrderQtyTotal: number;
  salePriceWeightedAvg: number | null;
  projectedRevenueTotal: number;
}

export interface RegionalStocksReport {
  snapshotDate: string;
  horizonDays: number;
  stockScope: RegionalStocksScope;
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
  stockScope?: RegionalStocksScope;
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
  /** vendorCode → units per box. Missing or invalid values are treated as 1. */
  unitsPerBoxByVendor?: ReadonlyMap<string, number>;
  /** skuKey(nmId, techSize) → product metadata from the latest WB stocks payload. */
  productCatalogBySku?: ReadonlyMap<string, WbProductCatalogRecord>;
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
    (row.vendorCode ?? "").toLocaleLowerCase("ru").includes(needle) ||
    (row.brand ?? "").toLocaleLowerCase("ru").includes(needle) ||
    (row.subject ?? "").toLocaleLowerCase("ru").includes(needle) ||
    (row.category ?? "").toLocaleLowerCase("ru").includes(needle) ||
    (row.productName ?? "").toLocaleLowerCase("ru").includes(needle)
  );
}

function buildSummary(
  rows: readonly RegionalStocksReportRow[],
  consumptionDays: number,
): RegionalStocksReportSummary {
  const summary: RegionalStocksReportSummary = {
    totalRows: rows.length,
    risk: { critical: 0, warning: 0, attention: 0, ok: 0 },
    wbAvailableTotal: 0,
    wbProjectedConsumptionTotal: 0,
    recommendedToRegionTotal: 0,
    ownWarehouseStockTotal: 0,
    recommendedOrderQtyTotal: 0,
    salePriceWeightedAvg: null,
    projectedRevenueTotal: 0,
  };
  let pricedProjectedConsumptionTotal = 0;
  for (const r of rows) {
    const projectedConsumption = r.regionalForecastDailyDemand * consumptionDays;
    summary.risk[r.risk] += 1;
    summary.wbAvailableTotal += r.regionalStartStock + r.regionalIncomingUnits;
    summary.wbProjectedConsumptionTotal += projectedConsumption;
    summary.recommendedToRegionTotal += r.recommendedToRegion;
    summary.ownWarehouseStockTotal += r.ownWarehouseStock;
    summary.recommendedOrderQtyTotal += r.recommendedOrderQty;
    summary.projectedRevenueTotal += r.projectedRevenue;
    if (r.salePrice !== null && projectedConsumption > 0) {
      pricedProjectedConsumptionTotal += projectedConsumption;
    }
  }
  if (pricedProjectedConsumptionTotal > 0) {
    summary.salePriceWeightedAvg =
      summary.projectedRevenueTotal / pricedProjectedConsumptionTotal;
  }
  return summary;
}

function productNameFor(catalog: WbProductCatalogRecord | undefined): string | null {
  return catalog?.subject ?? catalog?.category ?? null;
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

function stockRowMatchesScope(
  row: RegionalStocksStockInputRow,
  scope: RegionalStocksScope,
  macroRegion: string,
): boolean {
  const normalizedWarehouseKey = normalizeWarehouseName(row.warehouseKey);
  if (
    !warehouseContributesToRegionalAvailabilityStock(
      getWarehouseRegistryEntry(row.warehouseKey),
      normalizedWarehouseKey,
    )
  ) {
    return false;
  }
  if (scope !== "region") return true;
  return getWarehouseMacroRegion(row.warehouseKey) === macroRegion;
}

function demandRowMatchesScope(
  row: RegionalStocksDemandInputRow,
  scope: RegionalStocksScope,
  macroRegion: string,
  regionMacroLookup: ReadonlyMap<string, string>,
): boolean {
  if (scope !== "region") return true;
  return getMacroRegionByRegionKey(row.regionKey, regionMacroLookup) === macroRegion;
}

export function buildRegionalStocksReport(
  input: BuildRegionalStocksReportInput,
): RegionalStocksReport {
  const stockScope = input.stockScope ?? "region";
  const stockBySku = new Map<string, RegionalStockAccumulator>();
  for (const row of input.stockRows) {
    if (!stockRowMatchesScope(row, stockScope, input.macroRegion)) continue;

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
    if (
      !demandRowMatchesScope(
        row,
        stockScope,
        input.macroRegion,
        input.regionMacroLookup,
      )
    ) {
      continue;
    }
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
    const regionalForecastDailyDemand = d?.regionalForecastDailyDemand ?? 0;
    const vendorCode = betterVendorCode(
      d?.vendorCode ?? null,
      s?.vendorCode ?? null,
    );
    const ownWarehouseStock = ownWarehouseStockForVendor(
      vendorCode,
      input.ownStockByVendor,
    );
    const catalog = input.productCatalogBySku?.get(key);
    const salePrice =
      catalog?.salePrice !== undefined &&
      catalog.salePrice !== null &&
      Number.isFinite(catalog.salePrice)
        ? catalog.salePrice
        : null;
    const projectedConsumption =
      regionalForecastDailyDemand * input.targetCoverageDays;
    const projectedRevenue =
      salePrice === null ? 0 : projectedConsumption * salePrice;
    const unitsPerBox = unitsPerBoxForVendor(
      vendorCode,
      input.unitsPerBoxByVendor,
    );
    const wbAvailable = regionalStartStock + regionalIncomingUnits;
    const regionalAvailable =
      stockScope === "wbWithOwn" ? wbAvailable + ownWarehouseStock : wbAvailable;
    if (regionalAvailable <= 0 && regionalForecastDailyDemand <= 0) {
      continue;
    }
    const daysOfStockRegional = daysOfStockWbFromNetworkTotals(
      regionalAvailable,
      regionalForecastDailyDemand,
    );
    const rawRecommendedToRegion = Math.max(
      0,
      input.targetCoverageDays * regionalForecastDailyDemand - regionalAvailable,
    );
    const recommendedToRegion = roundUpToBoxUnits(
      rawRecommendedToRegion,
      unitsPerBox,
    );
    const risk = riskBucketFromDaysOfStock(
      Math.min(999_999, Math.floor(daysOfStockRegional)),
    );
    const recommendedOrderQty = roundRegionalShipmentToBoxes(
      recommendedToRegion,
      ownWarehouseStock,
      unitsPerBox,
    );
    allRows.push({
      nmId,
      techSize,
      vendorCode,
      category: catalog?.category ?? null,
      subject: catalog?.subject ?? null,
      brand: catalog?.brand ?? null,
      productName: productNameFor(catalog),
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
      unitsPerBox,
      ownWarehouseStock,
      recommendedOrderQty,
      salePrice,
      projectedRevenue,
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
    stockScope,
    macroRegion: input.macroRegion,
    targetCoverageDays: input.targetCoverageDays,
    ownWarehouseCode: input.ownWarehouseCode?.trim() || "main",
    summary: buildSummary(filtered, input.targetCoverageDays),
    rows: limited,
  };
}
