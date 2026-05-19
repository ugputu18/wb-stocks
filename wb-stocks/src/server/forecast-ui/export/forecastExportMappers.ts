import type { SupplierSkuReplenishmentReadModel } from "../../../domain/multiLevelInventory.js";
import type {
  RegionalStocksReportRow,
  RegionalStocksScope,
} from "../../../application/buildRegionalStocksReport.js";
import type {
  SystemTotalBySkuReportRow,
  WbForecastSnapshotReportRow,
  WbTotalBySkuReportRow,
} from "../../../infra/wbForecastSnapshotRepository.js";
import type {
  DonorMacroRegionRecommendation,
  DonorWarehouseRecommendation,
  RedistributionRow,
} from "../../../application/redistribution/redistributionModel.js";
import type { RedistributionRankingMode } from "../parse/exportQuery.js";

/**
 * Колонки и мапперы экспортных отчётов прогноза.
 *
 * Раньше выгружали CSV, но оказалось, что Excel при открытии CSV ломал
 * числа с дробной частью (`0.5` vs `0,5`) и склеивал большие
 * `nm_id`/телефоны в экспоненциальные представления — оператору
 * приходилось каждый раз вручную чинить локаль. Теперь рендерим XLSX
 * (см. `toXlsxBuffer`), числа уходят как числа, шапка работает в любой
 * локали. Структура колонок и порядок сохранены 1:1 с прежней CSV-выгрузкой,
 * чтобы аналитические шаблоны на стороне аналитиков не пришлось переписывать.
 */

export const WB_EXPORT_COLUMNS = [
  "warehouse_key",
  "vendor_code",
  "nm_id",
  "tech_size",
  "local_available",
  "wb_available",
  "system_available",
  "units7",
  "units30",
  "units90",
  "avg_daily_7",
  "avg_daily_30",
  "avg_daily_90",
  "forecast_daily_demand",
  "days_of_stock",
  "stockout_date",
  "recommended_to_wb",
  "risk_bucket",
] as const;

export const WB_TOTAL_EXPORT_COLUMNS = [
  "risk_bucket",
  "vendor_code",
  "nm_id",
  "tech_size",
  "wb_start_stock_total",
  "wb_incoming_units_total",
  "wb_available_total",
  "own_stock",
  "system_available",
  "days_of_stock_wb",
  "forecast_daily_demand_total",
  "recommended_to_wb",
  "recommended_from_supplier",
  "stockout_date_wb",
  "stock_snapshot_at_wb",
] as const;

export const SYSTEM_TOTAL_EXPORT_COLUMNS = [
  "risk_bucket",
  "vendor_code",
  "nm_id",
  "tech_size",
  "wb_start_stock_total",
  "wb_incoming_units_total",
  "wb_available_total",
  "own_stock",
  "system_available",
  "days_of_stock_system",
  "forecast_daily_demand_total",
  "recommended_to_wb",
  "recommended_from_supplier",
  "recommended_order_qty",
  "system_stockout_date_estimate",
  "stock_snapshot_at_system",
  "wb_risk",
  "system_risk",
] as const;

export const SUPPLIER_EXPORT_COLUMNS = [
  "vendor_code",
  "nm_id",
  "tech_size",
  "wb_start_stock_total",
  "wb_incoming_units_total",
  "wb_available_total",
  "own_stock",
  "system_available",
  "target_coverage_days",
  "target_demand_system",
  "recommended_from_supplier",
  "units_per_box",
  "lead_time_days",
  "order_coverage_days",
  "safety_days",
  "stock_at_arrival",
  "recommended_order_qty",
  "will_stockout_before_arrival",
  "days_until_stockout",
] as const;

/**
 * Колонки XLSX-выгрузки страницы «Запасы WB по региону».
 *
 * Имена колонок и их порядок умышленно совпадают 1:1 с заголовками таблицы
 * на странице (`RegionalStocksPage.tsx`) — оператор открывает файл в Excel
 * и видит ровно ту же шапку, что и в UI. Любое расхождение между UI и
 * выгрузкой в этом списке будет восприниматься как баг.
 */
export const REGIONAL_STOCKS_EXPORT_COLUMNS = [
  "Риск",
  "vendor",
  "nm_id",
  "Размер",
  "Доступно",
  "Спрос/день",
  "Дней запаса",
  "OOS",
  "Нужно",
  "Квант",
  "Склад",
  "Заказ",
] as const;

export const REDISTRIBUTION_REGIONAL_EXPORT_COLUMNS = [
  "Ранг",
  "nm_id",
  "Размер",
  "vendor",
  "Донор",
  "Донор local",
  "Резерв (шт.)",
  "Можно забрать",
  "Регион назначения",
  "Σ regional / день",
  "Σ в регионе",
  "Дн. в регионе",
  "Нехватка",
  "Σ На WB (регион)",
  "Прим. склад",
  "Прим. склад key",
  "Перевести",
  "Score",
] as const;

export const REDISTRIBUTION_FULFILLMENT_EXPORT_COLUMNS = [
  "Ранг",
  "nm_id",
  "Размер",
  "vendor",
  "Донор",
  "Донор local",
  "Резерв (шт.)",
  "Можно забрать",
  "Куда (склад)",
  "Куда key",
  "Спрос/день",
  "Дн. запаса",
  "На WB",
  "Перевести",
  "Score",
] as const;

export function forecastWbXlsxFilename(
  snapshotDate: string,
  horizonDays: number,
): string {
  return `wb-replenishment-${snapshotDate}-h${horizonDays}.xlsx`;
}

export function forecastSupplierXlsxFilename(
  snapshotDate: string,
  horizonDays: number,
): string {
  return `supplier-replenishment-${snapshotDate}-h${horizonDays}.xlsx`;
}

/**
 * Файл экспорта по странице "Запасы WB по региону".
 * Кодируем макрорегион в имени, чтобы аналитик не перепутал выгрузки по
 * разным регионам (имя кириллическое — браузер сохранит как есть благодаря
 * RFC 5987 `filename*` в Content-Disposition).
 */
export function regionalStocksXlsxFilename(
  snapshotDate: string,
  horizonDays: number,
  macroRegion: string,
  stockScope: RegionalStocksScope = "region",
): string {
  const safeScope =
    stockScope === "region"
      ? macroRegion.replace(/[\\/:*?"<>|\s]+/g, "_")
      : stockScope === "wb"
        ? "WB"
        : "WB_plus_sklad";
  return `stocks-${safeScope}-${snapshotDate}-h${horizonDays}.xlsx`;
}

export function redistributionXlsxFilename(
  snapshotDate: string,
  horizonDays: number,
  donorWarehouseKey: string,
  rankingMode: RedistributionRankingMode,
): string {
  const safeDonor =
    donorWarehouseKey.trim().replace(/[\\/:*?"<>|\s]+/g, "_") || "donor";
  return `redistribution-${rankingMode}-${safeDonor}-${snapshotDate}-h${horizonDays}.xlsx`;
}

/**
 * Маппинг строк отчёта в формат для записи XLSX. Имена ключей в точности
 * совпадают с заголовками таблицы UI (см. `REGIONAL_STOCKS_EXPORT_COLUMNS`).
 *
 * Экспортируется ВСЁ что приходит — фильтрация «Заказ > 0» делается на
 * стороне роута (см. `exportRoutes.ts`).
 */
export function regionalStocksRowsToExportObjects(
  rows: readonly RegionalStocksReportRow[],
): Record<string, unknown>[] {
  return rows.map((row) => ({
    "Риск": row.risk,
    vendor: row.vendorCode ?? "",
    nm_id: row.nmId,
    "Размер": row.techSize,
    "Доступно": row.regionalAvailable,
    "Спрос/день": row.regionalForecastDailyDemand,
    "Дней запаса": row.daysOfStockRegional,
    OOS: row.stockoutDateEstimate ?? "",
    "Нужно": row.recommendedToRegion,
    "Квант": row.unitsPerBox,
    "Склад": row.ownWarehouseStock,
    "Заказ": row.recommendedOrderQty,
  }));
}

function preferredWarehouseLabel(row: DonorMacroRegionRecommendation): string {
  if (!row.preferredWarehouseKey) return "";
  const idx = row.candidateWarehouseKeys.indexOf(row.preferredWarehouseKey);
  return idx >= 0
    ? row.candidateWarehouseLabels[idx] ?? row.preferredWarehouseKey
    : row.preferredWarehouseKey;
}

function redistributionRegionalRowToExportObject(
  row: DonorMacroRegionRecommendation,
): Record<string, unknown> {
  return {
    "Ранг": row.priorityRank,
    nm_id: row.nmId,
    "Размер": row.techSize,
    vendor: row.vendorCode,
    "Донор": row.donorWarehouseKey,
    "Донор local": row.donorLocalAvailable,
    "Резерв (шт.)": row.donorReserveUnits,
    "Можно забрать": row.donorTransferableUnits,
    "Регион назначения": row.targetMacroRegion,
    "Σ regional / день": row.targetRegionalDemand,
    "Σ в регионе": row.regionalAvailableUnits,
    "Дн. в регионе": row.regionalDaysOfStock,
    "Нехватка": row.regionalNeedUnits,
    "Σ На WB (регион)": row.sumRecommendedToWBInRegion,
    "Прим. склад": preferredWarehouseLabel(row),
    "Прим. склад key": row.preferredWarehouseKey ?? "",
    "Перевести": row.recommendedTransferUnitsToRegion,
    Score: row.transferScore,
  };
}

function redistributionFulfillmentRowToExportObject(
  row: DonorWarehouseRecommendation,
): Record<string, unknown> {
  return {
    "Ранг": row.priorityRank,
    nm_id: row.nmId,
    "Размер": row.techSize,
    vendor: row.vendorCode,
    "Донор": row.donorWarehouseKey,
    "Донор local": row.donorLocalAvailable,
    "Резерв (шт.)": row.donorReserveUnits,
    "Можно забрать": row.donorTransferableUnits,
    "Куда (склад)": row.targetWarehouseNameRaw,
    "Куда key": row.targetWarehouseKey,
    "Спрос/день": row.targetForecastDailyDemand,
    "Дн. запаса": row.targetDaysOfStock,
    "На WB": row.targetRecommendedToWB,
    "Перевести": row.recommendedTransferUnits,
    Score: row.transferScore,
  };
}

export function redistributionRowsToExportObjects(
  rows: readonly RedistributionRow[],
  rankingMode: RedistributionRankingMode,
): Record<string, unknown>[] {
  if (rankingMode === "regional") {
    return rows
      .filter((row): row is DonorMacroRegionRecommendation => row.kind === "macro")
      .map(redistributionRegionalRowToExportObject);
  }
  return rows
    .filter((row): row is DonorWarehouseRecommendation => row.kind === "warehouse")
    .map(redistributionFulfillmentRowToExportObject);
}

export function wbTotalRowsToExportObjects(
  rows: WbTotalBySkuReportRow[],
): Record<string, unknown>[] {
  return rows.map((row) => ({
    risk_bucket: row.risk,
    vendor_code: row.vendorCode ?? "",
    nm_id: row.nmId,
    tech_size: row.techSize,
    wb_start_stock_total: row.wbStartStockTotal,
    wb_incoming_units_total: row.wbIncomingUnitsTotal,
    wb_available_total: row.wbAvailableTotal,
    own_stock: row.ownStock,
    system_available: row.inventoryLevels.systemAvailable,
    days_of_stock_wb: row.daysOfStockWB,
    forecast_daily_demand_total: row.forecastDailyDemandTotal,
    recommended_to_wb: row.replenishment?.recommendedToWB ?? "",
    recommended_from_supplier: row.recommendedFromSupplier,
    stockout_date_wb: row.stockoutDateWB ?? "",
    stock_snapshot_at_wb: row.stockSnapshotAtWB,
  }));
}

export function systemTotalRowsToExportObjects(
  rows: SystemTotalBySkuReportRow[],
): Record<string, unknown>[] {
  return rows.map((row) => ({
    risk_bucket: row.risk,
    vendor_code: row.vendorCode ?? "",
    nm_id: row.nmId,
    tech_size: row.techSize,
    wb_start_stock_total: row.wbStartStockTotal,
    wb_incoming_units_total: row.wbIncomingUnitsTotal,
    wb_available_total: row.wbAvailableTotal,
    own_stock: row.ownStock,
    system_available: row.inventoryLevels.systemAvailable,
    days_of_stock_system: row.daysOfStockSystem,
    forecast_daily_demand_total: row.forecastDailyDemandTotal,
    recommended_to_wb: row.replenishment?.recommendedToWB ?? "",
    recommended_from_supplier: row.recommendedFromSupplier,
    recommended_order_qty: row.recommendedOrderQty,
    system_stockout_date_estimate: row.systemStockoutDateEstimate ?? "",
    stock_snapshot_at_system: row.stockSnapshotAtSystem,
    wb_risk: row.inventoryLevels.wbRisk,
    system_risk: row.inventoryLevels.systemRisk,
  }));
}

export function wbReportRowsToExportObjects(
  rows: WbForecastSnapshotReportRow[],
): Record<string, unknown>[] {
  return rows.map((row) => ({
    warehouse_key: row.warehouseKey,
    vendor_code: row.vendorCode ?? "",
    nm_id: row.nmId,
    tech_size: row.techSize,
    local_available: row.inventoryLevels.localAvailable,
    wb_available: row.inventoryLevels.wbAvailable,
    system_available: row.inventoryLevels.systemAvailable,
    units7: row.units7,
    units30: row.units30,
    units90: row.units90,
    avg_daily_7: row.avgDaily7,
    avg_daily_30: row.avgDaily30,
    avg_daily_90: row.avgDaily90,
    forecast_daily_demand: row.forecastDailyDemand,
    days_of_stock: row.daysOfStock,
    stockout_date: row.stockoutDate ?? "",
    recommended_to_wb: row.replenishment?.recommendedToWB ?? "",
    risk_bucket: row.risk,
  }));
}

export function supplierRowsToExportObjects(
  rows: SupplierSkuReplenishmentReadModel[],
  targetCoverageDays: number,
): Record<string, unknown>[] {
  return rows.map((r) => ({
    vendor_code: r.vendorCode ?? "",
    nm_id: r.nmId,
    tech_size: r.techSize,
    wb_start_stock_total: r.wbStartStockTotal,
    wb_incoming_units_total: r.wbIncomingUnitsTotal,
    wb_available_total: r.wbAvailableTotal,
    own_stock: r.ownStock,
    system_available: r.systemAvailable,
    target_coverage_days: targetCoverageDays,
    target_demand_system: r.targetDemandSystem,
    recommended_from_supplier: r.recommendedFromSupplier,
    units_per_box: r.unitsPerBox,
    lead_time_days: r.leadTimeDays,
    order_coverage_days: r.orderCoverageDays,
    safety_days: r.safetyDays,
    stock_at_arrival: r.stockAtArrival,
    recommended_order_qty: r.recommendedOrderQty,
    // Булев флаг в Excel смотрится естественно как TRUE/FALSE; оставляем
    // прежний строковый сериализованный вариант, чтобы аналитические
    // фильтры по точному совпадению строки не сломались.
    will_stockout_before_arrival: r.willStockoutBeforeArrival ? "true" : "false",
    days_until_stockout:
      r.daysUntilStockout === null || r.daysUntilStockout === undefined
        ? ""
        : r.daysUntilStockout,
  }));
}
